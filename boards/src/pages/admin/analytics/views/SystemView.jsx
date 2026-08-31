// SystemView — "is the measurement itself sound?"
//
// The previous SystemView had no fetch of its own: it printed the honesty
// thresholds as a bulleted list, showed Meta CAPI health, and showed storage.
// Its toolbar refresh was wired to the shell's fetch "so the button still does
// something", and its freshness stamp was hardcoded null.
//
// It now owns the things that are about the instruments rather than the
// product: whether the events we rely on are actually being emitted, whether
// the integrations are delivering, what the storage looks like, and where the
// data is known to lie. Instrumentation coverage moved here from Engagement,
// where it sat between two retention panels answering an unrelated question.

import { supabase } from '../../../../lib/supabase.js';
import {
  MIN_RATE_FLAG, MIN_RATE_SHOW, MIN_POINTS, formatCount,
} from '../../../../lib/adminFormat.js';
import { useAdminData } from '../../useAdminData.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { AdminStorageSection } from '../../AdminStorageSection.jsx';
import { MetaCapiHealth } from '../widgets/MetaCapiHealth.jsx';
import { Detail } from '../../viz/Detail.jsx';
import { BarRows } from '../../viz/BarRows.jsx';
import { VAR } from '../../viz/palette.js';
import { ActivationByExperiment } from '../widgets/ActivationByExperiment.jsx';
import { getActiveExperiments } from '../../../../lib/experiments.js';
import { useAnalyticsFilters, useRegisterViewRuntime } from '../AnalyticsFiltersContext.jsx';

const num = (x) => (x == null || Number.isNaN(Number(x)) ? 0 : Number(x));

/**
 * Instrumentation coverage: server truth vs the client event that should
 * accompany it.
 *
 * Merges the old EventCoverage and OnboardingErrorCoverage widgets, which were
 * two panels asking the same question about different milestones. A gap here
 * means a number elsewhere on the dashboard is low for a reporting reason
 * rather than a product one, which is exactly the kind of thing that should
 * live next to the honesty contract instead of inside a retention view.
 */
function Instrumentation({ rows }) {
  const data = (rows || []).map((r) => ({
    label: r.milestone,
    value: num(r.coverage_pct) * 100,
    server: num(r.server_truth),
    client: num(r.client_event),
  }));

  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">Event coverage</h3>
        <span className="admin-chart-sub t-meta">
          share of server-stamped milestones that also emitted their client event
        </span>
      </header>
      <BarRows
        rows={data}
        max={100}
        formatValue={(v) => `${v.toFixed(0)}%`}
        secondary={(r) => (
          <span title="client events / server truth">
            {formatCount(r.client)} / {formatCount(r.server)}
          </span>
        )}
        colors={(r) => (r.value < 80 ? VAR.bad : VAR.ink)}
        emptyLabel="No milestones reached in this window."
      />
    </section>
  );
}

/**
 * The known-wrong list.
 *
 * Every entry is documented in a migration or a component header somewhere in
 * the tree, which means it was known and invisible. Someone reading a number on
 * this dashboard deserves to find out here rather than by re-deriving it.
 */
function KnownLimits({ excludeInternal }) {
  return (
    <section className="admin-chart-panel admin-chart-panel-wide">
      <header className="admin-chart-head">
        <h3 className="admin-chart-title">What the data cannot tell you</h3>
        <span className="admin-chart-sub t-meta">read this before trusting a number elsewhere</span>
      </header>
      <div className="admin-chart-body">
        <ul className="admin-dq-list">
          <li>
            <span className={`admin-dq-pill ${excludeInternal ? 'is-on' : 'is-off'}`}>
              {excludeInternal ? 'Internal traffic excluded' : 'Internal traffic included'}
            </span>
            Founder, admin and test accounts are {excludeInternal ? 'removed from' : 'counted in'} every
            product metric. Toggle in the toolbar to compare.
          </li>
          <li>
            <strong>&ldquo;Sessions&rdquo; in the funnel are browsers.</strong> The funnel RPCs count distinct
            <code> session_id</code>, which migration 0248 documents as a device id minted once into
            localStorage and never rotated — measured p50 span 13 seconds, max 81 days. The real session
            is <code>app_session_id</code>, and it is NULL for every row written before that migration.
          </li>
          <li>
            <strong>Presence is not work.</strong> 54% of <code>user_active_day</code> rows contain no work
            event at all. Panels that say &ldquo;did work&rdquo; pass <code>p_require_work</code>; those that
            say &ldquo;active&rdquo; do not. <code>did_work</code> cannot be backfilled, so it is false for
            everything before 2026-08-17.
          </li>
          <li>
            <strong>Revenue is empty by absence.</strong> No subscription has ever existed, so MRR, ARPU and
            every conversion rate have a zero numerator because nothing happened — not because measurement
            failed.
          </li>
          <li>
            <strong>Two windows in the history are contaminated.</strong> Events before migration 0230 include
            a QA harness replaying <code>?local=1&amp;tier=demo&amp;cards=60</code>, fake checkout successes
            included. And <code>card_index.created_at</code> before 2026-08-22 was backfilled from
            <code> updated_at</code>, so card history older than that is a last-edit histogram.
          </li>
          <li>
            <strong>Rates are sample-size gated.</strong> Solid at n ≥ {MIN_RATE_FLAG}; from {MIN_RATE_SHOW}
            –{MIN_RATE_FLAG - 1} flagged <em>directional</em>; below {MIN_RATE_SHOW} hidden. Trend lines need
            ≥ {MIN_POINTS} real points, and <code>metrics_daily</code> has no backfill — so a gap in a
            sparkline is a missing day, not a zero.
          </li>
        </ul>
      </div>
    </section>
  );
}

export function SystemView() {
  const f = useAnalyticsFilters();

  const q = useAdminData(async () => {
    const [ec, oe] = await Promise.allSettled([
      supabase.rpc('admin_event_coverage', { p_days: f.days, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_onboarding_error_coverage', { p_days: f.days, p_exclude_internal: f.excludeInternal }),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    return { coverage: val(ec) || [], onboardingErrors: val(oe) || [] };
  }, [f.days, f.excludeInternal, f.verifiedOnly]);

  useRegisterViewRuntime({ refresh: q.refresh, lastUpdated: q.lastUpdated, refreshing: q.refreshing });

  const experiments = getActiveExperiments();

  return (
    <AdminAsync loading={q.loading} error={q.error} onRetry={q.refresh} skeleton={<AdminSkeleton variant="table" />}>
      <div className={q.refreshing ? 'is-refreshing' : ''}>
        <h2 className="admin-section-title">Honesty</h2>
        <KnownLimits excludeInternal={f.excludeInternal} />

        <h2 className="admin-section-title">Instrumentation</h2>
        <div className="admin-section-sub">
          Whether the events the rest of this dashboard counts are actually being emitted.
        </div>
        <Instrumentation rows={q.data?.coverage} />

        <h2 className="admin-section-title">Detail</h2>
        <Detail id="sys.integrations" label="Integrations and delivery">
          <MetaCapiHealth />
        </Detail>
        <Detail id="sys.storage" label="Storage footprint">
          <AdminStorageSection />
        </Detail>
        {experiments.length > 0 && (
          <Detail id="sys.experiments" label="Onboarding experiments">
            <LazyExperiments days={f.days} f={f} keys={experiments} />
          </Detail>
        )}
      </div>
    </AdminAsync>
  );
}

/**
 * Experiment arms.
 *
 * Moved out of the retention view and demoted: the bandit optimises on
 * activation and shifts traffic nightly on its own, so this is a readout, not a
 * decision surface. Retention-by-arm was dropped entirely — it never had the
 * sample size to say anything, and it cost one RPC per active experiment on
 * every mount of the busiest view on the dashboard.
 */
function LazyExperiments({ days, f, keys }) {
  const q = useAdminData(async () => {
    const settled = await Promise.allSettled([
      ...keys.map((k) => supabase.rpc('admin_activation_by_experiment', { p_key: k, p_days: days, p_exclude_internal: f.excludeInternal })),
      supabase.rpc('admin_get_experiment_state'),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const state = val(settled[keys.length]) || {};
    return { arms: keys.map((k, i) => ({ key: k, rows: val(settled[i]) || [], state: state?.[k] || null })) };
  }, [days, f.excludeInternal, keys.join(',')]);

  return (
    <AdminAsync loading={q.loading} error={q.error} onRetry={q.refresh} skeleton={<AdminSkeleton variant="table" />}>
      {(q.data?.arms || []).map((e) => (
        <ActivationByExperiment key={e.key} expKey={e.key} rows={e.rows} state={e.state} />
      ))}
    </AdminAsync>
  );
}
