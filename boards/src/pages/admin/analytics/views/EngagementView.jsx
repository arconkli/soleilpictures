// EngagementView — what happens after signup: activation milestones, weekly
// retention cohorts, and what's being created (cards per day, kinds, by tier).

import { supabase } from '../../../../lib/supabase.js';
import { useAdminData } from '../../useAdminData.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { useAnalyticsFilters, useRegisterViewRuntime } from '../AnalyticsFiltersContext.jsx';
import { ActivationFunnel } from '../widgets/ActivationFunnel.jsx';
import { RetentionCohorts } from '../widgets/RetentionCohorts.jsx';
import { AdminCardsSection } from '../../AdminCardsSection.jsx';
import { AdminTierCompareTable } from '../../AdminTierCompareTable.jsx';

export function EngagementView() {
  const f = useAnalyticsFilters();
  const q = useAdminData(async () => {
    const [af, ch, cs, pd, tc] = await Promise.allSettled([
      supabase.rpc('admin_activation_funnel',   { p_days: f.days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_retention_cohorts',   { p_window_days: Math.max(f.days, 60), p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_card_stats',          { p_days: f.days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_cards_per_day',       { p_days: f.days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_tier_usage_compare',  { p_days: 36500, p_exclude_internal: f.excludeInternal }),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;
    const core = [cs, pd];
    if (!core.some((r) => r.status === 'fulfilled' && !r.value.error)) {
      throw errOf(core.find(errOf)) || new Error('Failed to load engagement');
    }
    return { activation: val(af), cohorts: val(ch) || [], cardStats: val(cs), perDay: val(pd) || [], tierCompare: val(tc) || [] };
  }, [f.days, f.excludeInternal]);

  useRegisterViewRuntime({ refresh: q.refresh, lastUpdated: q.lastUpdated, refreshing: q.refreshing });

  return (
    <AdminAsync loading={q.loading} error={q.error} onRetry={q.refresh}
      skeleton={<><AdminSkeleton variant="chart" /><div style={{ height: 16 }} /><AdminSkeleton variant="table" /></>}>
      <div className={q.refreshing ? 'is-refreshing' : ''}>
        <h2 className="admin-section-title">Activation &amp; retention</h2>
        <div className="admin-section-sub">How signed-up users progress, and whether cohorts keep coming back.</div>
        {q.data?.activation && <ActivationFunnel data={q.data.activation} days={f.days} />}
        <RetentionCohorts rows={q.data?.cohorts || []} />

        <h2 className="admin-section-title">Cards &amp; product</h2>
        <div className="admin-section-sub">What's being created and which tiers create it.</div>
        <AdminCardsSection perDay={q.data?.perDay || []} cardStats={q.data?.cardStats} days={f.days} />
        <AdminTierCompareTable rows={q.data?.tierCompare || []} />
      </div>
    </AdminAsync>
  );
}
