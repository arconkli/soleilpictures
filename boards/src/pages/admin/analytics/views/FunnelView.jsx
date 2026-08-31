// FunnelView — "where do we lose people, landing → activation → paid?"
//
// Merges the old Acquisition and Revenue views. They were separate tabs asking
// halves of one question: Acquisition showed the funnel and where traffic came
// from, Revenue showed the same funnel filtered to its pricing branch. Both
// rendered SignupFunnelPanel, from the same RPC, four hundred pixels apart in
// the navigation.
//
// Revenue does not get its own view while zero subscriptions have ever existed
// (AdminCommandCenter's header says it plainly: a structurally empty series
// reads as a measurement rather than an absence). The pricing branch is one
// fork of the funnel here, which is what it actually is.
//
// The hero is the funnel and the biggest leak. Channel mix sits under it.
// Everything else — device, geography, the FB/IG path, referrals, checkout
// signals, upsell behaviour — is real but not what you open this view to see,
// so it lives behind Detail and does not fetch until opened.

import { supabase } from '../../../../lib/supabase.js';
import { useAdminData } from '../../useAdminData.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { formatCount } from '../../../../lib/adminFormat.js';
import { useAnalyticsFilters, useRegisterViewRuntime } from '../AnalyticsFiltersContext.jsx';
import { FunnelSteps } from '../../viz/FunnelSteps.jsx';
import { BarRows } from '../../viz/BarRows.jsx';
import { Detail } from '../../viz/Detail.jsx';
import { RateCell } from '../../SmallN.jsx';
import { LeaksSummary } from '../widgets/LeaksSummary.jsx';
import { AdminReferralsSection } from '../widgets/AdminReferralsSection.jsx';
import { AdminMultiplayerSection } from '../widgets/AdminMultiplayerSection.jsx';
import { GeoBreakdown } from '../widgets/GeoBreakdown.jsx';
import { DeviceBreakdown } from '../widgets/DeviceBreakdown.jsx';
import { UpsellBehaviorPanel } from '../widgets/UpsellBehaviorPanel.jsx';
import { AdminEventBreakdown } from '../../AdminEventBreakdown.jsx';
import { AdminTopUsersList } from '../../AdminTopUsersList.jsx';

const num = (x) => (x == null || Number.isNaN(Number(x)) ? 0 : Number(x));

/**
 * Where signups came from.
 *
 * Was a bare table of numbers with no visual weight; a ranked bar makes the
 * shape of the mix readable at a glance.
 *
 * Ramped rather than flat: the shade is keyed to the VALUE, not to the row's
 * position, so re-sorting or filtering never repaints a channel that has not
 * changed. Colouring by rank would make the colour mean position, which is the
 * anti-pattern; colouring by magnitude just says the same thing twice.
 */
function ChannelMix({ rows, days }) {
  const data = (rows || [])
    .map((r) => ({ label: r.source || 'unknown', value: num(r.signups), converted: num(r.converted) }))
    .sort((a, b) => b.value - a.value);
  const total = data.reduce((a, r) => a + r.value, 0);

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Where they came from</h3>
        <span className="admin-chart-sub t-meta">
          first-touch source · {formatCount(total)} signups · last {days}d
        </span>
      </header>
      <BarRows
        ramp
        rows={data}
        limit={8}
        formatValue={(v) => formatCount(v)}
        secondary={(r) => (r.converted != null && r.value > 0
          ? <RateCell numer={r.converted} denom={r.value} />
          : null)}
        emptyLabel="No attributed signups in this window."
      />
    </section>
  );
}

export function FunnelView() {
  const f = useAnalyticsFilters();

  const q = useAdminData(async () => {
    const [fn, ab] = await Promise.allSettled([
      supabase.rpc('admin_signup_funnel', {
        p_days: f.days,
        p_source: f.source || null,
        p_campaign: f.campaign || null,
        p_content: f.content || null,
        p_exclude_internal: f.excludeInternal,
      }),
      supabase.rpc('admin_acquisition_breakdown', {
        p_days: f.days, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly,
      }),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;
    if (fn.status !== 'fulfilled' || fn.value.error) throw errOf(fn) || new Error('Failed to load funnel');
    return { steps: val(fn) || [], acquisition: val(ab) || [] };
  }, [f.days, f.source, f.campaign, f.content, f.excludeInternal, f.verifiedOnly]);

  useRegisterViewRuntime({ refresh: q.refresh, lastUpdated: q.lastUpdated, refreshing: q.refreshing });

  const segmented = !!(f.source || f.campaign || f.content);

  return (
    <AdminAsync loading={q.loading} error={q.error} onRetry={q.refresh} skeleton={<AdminSkeleton variant="chart" />}>
      <div className={q.refreshing ? 'is-refreshing' : ''}>
        <h2 className="admin-section-title">Landing to paid</h2>
        <div className="admin-section-sub">
          Where sessions fall off between the landing page and a subscription.
          {segmented ? ' Filtered by the selectors above.' : ''}
          {' '}The waitlist fork is not drawn — it has been switched off since 2026-06-13, so it would
          only ever draw a flat zero.
        </div>
        <FunnelSteps steps={q.data?.steps || []} days={f.days} />
        <LeaksSummary steps={q.data?.steps || []} />

        <h2 className="admin-section-title">Channels</h2>
        <ChannelMix rows={q.data?.acquisition} days={f.days} />

        <h2 className="admin-section-title">Detail</h2>
        <div className="admin-section-sub">
          Real, but not what this view is for. Each section fetches only once opened.
        </div>
        <DetailSections days={f.days} f={f} steps={q.data?.steps || []} />
      </div>
    </AdminAsync>
  );
}

/**
 * The long tail, each section owning its own fetch.
 *
 * Splitting these out is the point: the old Acquisition view fired seven RPCs
 * on mount whether or not you looked at the geography table, and Engagement
 * fired twenty-five. Here nothing runs until a section is opened.
 */
function DetailSections({ days, f, steps }) {
  return (
    <>
      <Detail id="funnel.paths" label="Other paths into the product">
        <LazyPaths days={days} f={f} />
      </Detail>
      <Detail id="funnel.who" label="Device and geography">
        <LazyAudience days={days} f={f} />
      </Detail>
      <Detail id="funnel.money" label="Checkout, upsell and the biggest accounts">
        <LazyMoney days={days} f={f} steps={steps} />
      </Detail>
    </>
  );
}

function LazyPaths({ days, f }) {
  const q = useAdminData(async () => {
    const [fb, rf, mp] = await Promise.allSettled([
      supabase.rpc('admin_fb_funnel', { p_days: days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_referral_stats', { p_days: days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_multiplayer_stats', { p_days: days, p_exclude_internal: f.excludeInternal }),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    return { fbSteps: val(fb) || [], referrals: val(rf), multiplayer: val(mp) };
  }, [days, f.excludeInternal]);

  return (
    <AdminAsync loading={q.loading} error={q.error} onRetry={q.refresh} skeleton={<AdminSkeleton variant="chart" />}>
      <FunnelSteps
        steps={q.data?.fbSteps || []}
        days={days}
        title="Facebook / Instagram"
        sub="fbclid traffic skips the waitlist for an instant demo: saw the price, then took the free workspace or bought. Paid and organic together — fbclid cannot separate them."
        branches={['demo', 'buy']}
        forkLabel="Forks at the offer →"
      />
      <AdminMultiplayerSection data={q.data?.multiplayer} days={days} />
      <AdminReferralsSection data={q.data?.referrals} days={days} />
    </AdminAsync>
  );
}

function LazyAudience({ days, f }) {
  const q = useAdminData(async () => {
    const [dv, geo] = await Promise.allSettled([
      supabase.rpc('admin_device_breakdown', { p_days: days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_geo_breakdown', { p_days: days, p_exclude_internal: f.excludeInternal }),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    return { device: val(dv), geo: val(geo) };
  }, [days, f.excludeInternal]);

  return (
    <AdminAsync loading={q.loading} error={q.error} onRetry={q.refresh} skeleton={<AdminSkeleton variant="table" />}>
      <DeviceBreakdown data={q.data?.device} days={days} />
      <GeoBreakdown data={q.data?.geo} days={days} />
    </AdminAsync>
  );
}

function LazyMoney({ days, f, steps }) {
  const q = useAdminData(async () => {
    const [cr, eb, td, tp, us, ux] = await Promise.allSettled([
      supabase.rpc('admin_checkout_reliability', { p_days: days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_event_breakdown', { p_days: days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_top_users', { p_tier: 'demo', p_limit: 20, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_top_users', { p_tier: 'paid', p_limit: 20, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_upsell_scorecard', { p_days: days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_upsell_exposures', { p_days: days, p_limit: 40, p_exclude_internal: f.excludeInternal }),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    return {
      reliability: val(cr), eventBreakdown: val(eb) || [],
      topDemo: val(td) || [], topPaid: val(tp) || [],
      upsell: val(us), upsellExposures: val(ux) || [],
    };
  }, [days, f.excludeInternal, f.verifiedOnly]);

  const paid = Number(f.stats?.tier_counts?.paid) || 0;

  return (
    <AdminAsync loading={q.loading} error={q.error} onRetry={q.refresh} skeleton={<AdminSkeleton variant="table" />}>
      {/* Said once, plainly, instead of drawn as three zero-valued tiles. */}
      <p className="admin-section-sub">
        {paid > 0
          ? `${formatCount(paid)} paying account${paid === 1 ? '' : 's'}.`
          : 'No subscription has ever existed, so every rate below has a zero numerator by absence rather than by measurement.'}
      </p>
      <FunnelSteps
        steps={steps}
        days={days}
        title="Pricing path"
        sub="of those who reached the fork: pricing → checkout → paid"
        branches={['pricing']}
      />
      <UpsellBehaviorPanel scorecard={q.data?.upsell} exposures={q.data?.upsellExposures || []} days={days} />
      <AdminEventBreakdown rows={q.data?.eventBreakdown || []} reliability={q.data?.reliability} days={days} />
      <AdminTopUsersList topDemo={q.data?.topDemo || []} topPaid={q.data?.topPaid || []} />
    </AdminAsync>
  );
}
