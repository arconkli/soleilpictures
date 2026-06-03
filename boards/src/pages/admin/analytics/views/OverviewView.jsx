// OverviewView — the executive summary: headline KPIs (with small-N honesty) +
// the signup funnel as the hero + the biggest-leak/friction callout. The funnel
// is the one genuinely actionable signal at this scale, so it leads.
//
// Fetches its own KPIs / history / cards-per-day / signup-funnel; reads the
// shared live stats (MRR/ARPU) and segment filters from context. Core = the
// funnel must load; KPIs degrade gracefully (cards fall back to "—").

import { supabase } from '../../../../lib/supabase.js';
import { useAdminData } from '../../useAdminData.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { AdminKpiStrip } from '../../AdminKpiStrip.jsx';
import { useAnalyticsFilters, useRegisterViewRuntime } from '../AnalyticsFiltersContext.jsx';
import { SignupFunnelPanel } from '../widgets/SignupFunnelPanel.jsx';
import { LeaksSummary } from '../widgets/LeaksSummary.jsx';

export function OverviewView() {
  const f = useAnalyticsFilters();
  const q = useAdminData(async () => {
    const [ks, mh, pd, fn] = await Promise.allSettled([
      supabase.rpc('admin_kpi_summary',     { p_days: f.days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_metrics_history', { p_days: 90 }),
      supabase.rpc('admin_cards_per_day',   { p_days: f.days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_signup_funnel',   { p_days: f.days, p_source: f.source || null, p_campaign: f.campaign || null, p_content: f.content || null, p_exclude_internal: f.excludeInternal }),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;
    if (fn.status !== 'fulfilled' || fn.value.error) throw errOf(fn) || new Error('Failed to load funnel');
    return { kpi: val(ks), history: val(mh) || [], perDay: val(pd) || [], steps: val(fn) || [] };
  }, [f.days, f.source, f.campaign, f.content, f.excludeInternal]);

  useRegisterViewRuntime({ refresh: q.refresh, lastUpdated: q.lastUpdated, refreshing: q.refreshing });

  return (
    <AdminAsync loading={q.loading} error={q.error} onRetry={q.refresh}
      skeleton={<><AdminSkeleton variant="cards" rows={8} /><div style={{ height: 16 }} /><AdminSkeleton variant="chart" /></>}>
      <div className={q.refreshing ? 'is-refreshing' : ''}>
        <AdminKpiStrip kpi={q.data?.kpi} history={q.data?.history || []} stats={f.stats}
                       perDay={q.data?.perDay || []} days={f.days} excludeInternal={f.excludeInternal} />

        <h2 className="admin-section-title">Signup funnel</h2>
        <div className="admin-section-sub">
          The funnel that matters — where sessions fall off from landing to paid. The flow forks at
          the welcome screen into the waitlist and pricing paths{(f.source || f.campaign || f.content) ? ' (segment-filtered)' : ''}.
        </div>
        <SignupFunnelPanel steps={q.data?.steps || []} days={f.days} />
        <LeaksSummary steps={q.data?.steps || []} />
      </div>
    </AdminAsync>
  );
}
