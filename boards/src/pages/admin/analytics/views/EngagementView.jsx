// EngagementView — what happens after signup: activation milestones, weekly
// retention cohorts, and what's being created (cards per day, kinds, by tier).

import { supabase } from '../../../../lib/supabase.js';
import { useAdminData } from '../../useAdminData.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { useAnalyticsFilters, useRegisterViewRuntime } from '../AnalyticsFiltersContext.jsx';
import { ActivationFunnel } from '../widgets/ActivationFunnel.jsx';
import { ActivationByDevice } from '../widgets/ActivationByDevice.jsx';
import { RetentionCurve } from '../widgets/RetentionCurve.jsx';
import { LifespanDistribution } from '../widgets/LifespanDistribution.jsx';
import { RetentionCohorts } from '../widgets/RetentionCohorts.jsx';
import { ReturnRate } from '../widgets/ReturnRate.jsx';
import { RetentionBySource } from '../widgets/RetentionBySource.jsx';
import { UserDormancy } from '../widgets/UserDormancy.jsx';
import { EventCoverage } from '../widgets/EventCoverage.jsx';
import { TimeToFirstCard } from '../widgets/TimeToFirstCard.jsx';
import { FirstCardFriction } from '../widgets/FirstCardFriction.jsx';
import { PostSignupDropoff } from '../widgets/PostSignupDropoff.jsx';
import { OnboardingErrorCoverage } from '../widgets/OnboardingErrorCoverage.jsx';
import { RetentionByExperiment } from '../widgets/RetentionByExperiment.jsx';
import { ActivationByExperiment } from '../widgets/ActivationByExperiment.jsx';
import { getActiveExperiments } from '../../../../lib/experiments.js';
import { AdminCardsSection } from '../../AdminCardsSection.jsx';
import { AdminTierCompareTable } from '../../AdminTierCompareTable.jsx';

export function EngagementView() {
  const f = useAnalyticsFilters();
  const q = useAdminData(async () => {
    const [af, rc, ls, ch, cs, pd, tc, rr, rs, dm, ec, tt, fc, oe, jd] = await Promise.allSettled([
      supabase.rpc('admin_activation_funnel',   { p_days: f.days, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      // Retention graphs — degrade gracefully via val(); never gate the view.
      supabase.rpc('admin_retention_curve',     { p_window_days: Math.max(f.days, 30), p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_user_lifespan',       { p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_retention_cohorts',   { p_window_days: Math.max(f.days, 60), p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_card_stats',          { p_days: f.days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_cards_per_day',       { p_days: f.days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_tier_usage_compare',  { p_days: 36500, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      // New retention/measurement RPCs (migration 0120) — all graceful via val().
      supabase.rpc('admin_return_rate',         { p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_retention_by_source', { p_window_days: Math.max(f.days, 30), p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_user_dormancy',       { p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_event_coverage',      { p_days: f.days, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      // First-card friction RPCs (migration 0139) — return zeros until the
      // client emits the friction events; widgets show "still collecting".
      supabase.rpc('admin_time_to_first_card',      { p_days: f.days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_first_card_friction',     { p_days: f.days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_onboarding_error_coverage', { p_days: f.days, p_exclude_internal: f.excludeInternal }),
      // Post-signup journey drop-off (migration 0162) — returns zeros until ps_*
      // events accrue; widget shows "still collecting".
      supabase.rpc('admin_journey_dropoff', { p_days: f.days, p_exclude_internal: f.excludeInternal }),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;
    // A/B per-experiment splits + live bandit state (migrations 0140/0141) —
    // graceful; empty until new users are enrolled + their cohorts mature. The
    // activation split (composite payment-weighted reward) is what the bandit
    // optimizes; retention-by-arm is a supporting view.
    const activeExps = getActiveExperiments();
    const expResults = await Promise.allSettled([
      ...activeExps.map((k) => supabase.rpc('admin_retention_by_experiment', { p_key: k, p_window_days: Math.max(f.days, 30), p_exclude_internal: f.excludeInternal })),
      ...activeExps.map((k) => supabase.rpc('admin_activation_by_experiment', { p_key: k, p_days: f.days, p_exclude_internal: f.excludeInternal })),
      supabase.rpc('admin_get_experiment_state'),
    ]);
    const nE = activeExps.length;
    const experimentRetention = activeExps.map((k, i) => ({ key: k, rows: val(expResults[i]) || [] }));
    const experimentState = val(expResults[2 * nE]) || {};
    const experimentActivation = activeExps.map((k, i) => ({ key: k, rows: val(expResults[nE + i]) || [], state: experimentState?.[k] || null }));
    // Activation funnel split by device (admin_activation_funnel(...,p_device),
    // migration 0156) — the headline mobile-vs-desktop activation readout. One
    // call per device; graceful via val(), so a missing overload just hides it.
    const DEVICES = ['mobile', 'desktop', 'tablet', 'unknown'];
    const devResults = await Promise.allSettled(
      DEVICES.map((d) => supabase.rpc('admin_activation_funnel',
        { p_days: f.days, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly, p_device: d })),
    );
    const activationByDevice = DEVICES.map((d, i) => ({ device: d, data: val(devResults[i]) })).filter((x) => x.data);
    const core = [cs, pd];
    if (!core.some((r) => r.status === 'fulfilled' && !r.value.error)) {
      throw errOf(core.find(errOf)) || new Error('Failed to load engagement');
    }
    return { activation: val(af), retention: val(rc) || [], lifespan: val(ls), cohorts: val(ch) || [], cardStats: val(cs), perDay: val(pd) || [], tierCompare: val(tc) || [], returnRate: val(rr) || [], bySource: val(rs) || [], dormancy: val(dm) || [], coverage: val(ec) || [], timeToCard: val(tt), friction: val(fc), onboardingErrors: val(oe) || [], journeyDropoff: val(jd), experimentRetention, experimentActivation, activationByDevice };
  }, [f.days, f.excludeInternal, f.verifiedOnly]);

  useRegisterViewRuntime({ refresh: q.refresh, lastUpdated: q.lastUpdated, refreshing: q.refreshing });

  return (
    <AdminAsync loading={q.loading} error={q.error} onRetry={q.refresh}
      skeleton={<><AdminSkeleton variant="chart" /><div style={{ height: 16 }} /><AdminSkeleton variant="table" /></>}>
      <div className={q.refreshing ? 'is-refreshing' : ''}>
        <h2 className="admin-section-title">Activation &amp; retention</h2>
        <div className="admin-section-sub">How signed-up users progress, and whether cohorts keep coming back.</div>
        {q.data?.activation && <ActivationFunnel data={q.data.activation} days={f.days} />}
        <ActivationByDevice rows={q.data?.activationByDevice || []} days={f.days} />
        <RetentionCurve rows={q.data?.retention || []} />
        <LifespanDistribution data={q.data?.lifespan} />
        <RetentionCohorts rows={q.data?.cohorts || []} />
        <ReturnRate rows={q.data?.returnRate || []} />
        <RetentionBySource rows={q.data?.bySource || []} />
        <UserDormancy rows={q.data?.dormancy || []} />
        <EventCoverage rows={q.data?.coverage || []} />

        <h2 className="admin-section-title">First-card friction</h2>
        <div className="admin-section-sub">Where new users get stuck before placing their first card — attempts, failures, and how long it takes.</div>
        <PostSignupDropoff data={q.data?.journeyDropoff} />
        <TimeToFirstCard data={q.data?.timeToCard} />
        <FirstCardFriction data={q.data?.friction} />
        <OnboardingErrorCoverage rows={q.data?.onboardingErrors || []} />

        <h2 className="admin-section-title">Experiments (auto-optimizing)</h2>
        <div className="admin-section-sub">Onboarding A/B arms, scored on a composite payment-weighted reward. The bandit auto-shifts traffic nightly; directional until each arm clears ~20 enrollees.</div>
        {(q.data?.experimentActivation || []).map((e) => (
          <ActivationByExperiment key={e.key} expKey={e.key} rows={e.rows} state={e.state} />
        ))}
        {(q.data?.experimentRetention || []).map((e) => (
          <RetentionByExperiment key={e.key} expKey={e.key} rows={e.rows} />
        ))}

        <h2 className="admin-section-title">Cards &amp; product</h2>
        <div className="admin-section-sub">What's being created and which tiers create it.</div>
        <AdminCardsSection perDay={q.data?.perDay || []} cardStats={q.data?.cardStats} days={f.days} />
        <AdminTierCompareTable rows={q.data?.tierCompare || []} />
      </div>
    </AdminAsync>
  );
}
