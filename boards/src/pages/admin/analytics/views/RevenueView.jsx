// RevenueView — money + checkout health: live MRR/ARPU, the pricing branch of
// the funnel (view → checkout → paid), checkout reliability + failure signals,
// and the highest-activity demo/paid accounts.

import { supabase } from '../../../../lib/supabase.js';
import { formatMoney, formatCount, MIN_RATE_FLAG } from '../../../../lib/adminFormat.js';
import { useAdminData } from '../../useAdminData.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { useAnalyticsFilters, useRegisterViewRuntime } from '../AnalyticsFiltersContext.jsx';
import { SignupFunnelPanel } from '../widgets/SignupFunnelPanel.jsx';
import { AdminEventBreakdown } from '../../AdminEventBreakdown.jsx';
import { AdminTopUsersList } from '../../AdminTopUsersList.jsx';

function RevenueKpis({ stats }) {
  const paid     = Number(stats?.tier_counts?.paid) || 0;
  const mrrCents = stats?.mrr_cents != null ? Number(stats.mrr_cents) : null;
  const arpu     = mrrCents != null && paid ? mrrCents / paid : null;
  const arpuLowN = paid < MIN_RATE_FLAG;
  return (
    <div className="admin-stat-grid">
      <div className="admin-stat-card is-accent">
        <div className="admin-stat-head"><div className="admin-stat-label">MRR</div></div>
        <div className="admin-stat-value">{mrrCents != null ? formatMoney(mrrCents) : '—'}</div>
        <div className="admin-stat-sub">monthly recurring (live)</div>
      </div>
      <div className="admin-stat-card">
        <div className="admin-stat-head"><div className="admin-stat-label">Paying users</div></div>
        <div className="admin-stat-value">{formatCount(paid)}</div>
        <div className="admin-stat-sub">current paid tier</div>
      </div>
      <div className={`admin-stat-card ${arpuLowN ? 'is-lown' : ''}`}>
        <div className="admin-stat-head"><div className="admin-stat-label">ARPU</div></div>
        <div className="admin-stat-value">{arpu != null ? formatMoney(arpu) : '—'}</div>
        <div className="admin-stat-sub">per paying user · n={formatCount(paid)}</div>
      </div>
    </div>
  );
}

export function RevenueView() {
  const f = useAnalyticsFilters();
  const q = useAdminData(async () => {
    const [cr, eb, td, tp, fn] = await Promise.allSettled([
      supabase.rpc('admin_checkout_reliability', { p_days: f.days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_event_breakdown',      { p_days: f.days, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_top_users',            { p_tier: 'demo', p_limit: 20, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_top_users',            { p_tier: 'paid', p_limit: 20, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_signup_funnel',        { p_days: f.days, p_exclude_internal: f.excludeInternal }),
    ]);
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;
    const core = [td, tp];
    if (!core.some((r) => r.status === 'fulfilled' && !r.value.error)) {
      throw errOf(core.find(errOf)) || new Error('Failed to load revenue');
    }
    return {
      reliability: val(cr), eventBreakdown: val(eb) || [],
      topDemo: val(td) || [], topPaid: val(tp) || [], steps: val(fn) || [],
    };
  }, [f.days, f.excludeInternal, f.verifiedOnly]);

  useRegisterViewRuntime({ refresh: q.refresh, lastUpdated: q.lastUpdated, refreshing: q.refreshing });

  return (
    <AdminAsync loading={q.loading} error={q.error} onRetry={q.refresh}
      skeleton={<><AdminSkeleton variant="cards" rows={3} /><div style={{ height: 16 }} /><AdminSkeleton variant="table" /></>}>
      <div className={q.refreshing ? 'is-refreshing' : ''}>
        <h2 className="admin-section-title">Revenue</h2>
        <div className="admin-section-sub">Live recurring revenue and the pricing path that produces it.</div>
        <RevenueKpis stats={f.stats} />
        <SignupFunnelPanel steps={q.data?.steps || []} days={f.days}
          title="Pricing path" sub="of those who reached the fork: pricing → checkout → paid" branches={['pricing']} />

        <h2 className="admin-section-title">Checkout &amp; signals</h2>
        <div className="admin-section-sub">How completed checkouts resolve, plus error / abandon signals.</div>
        <AdminEventBreakdown rows={q.data?.eventBreakdown || []} reliability={q.data?.reliability} days={f.days} />

        <h2 className="admin-section-title">Most active accounts</h2>
        <div className="admin-section-sub">Highest-activity demo (upgrade-prone) and paid users — internal accounts excluded.</div>
        <AdminTopUsersList topDemo={q.data?.topDemo || []} topPaid={q.data?.topPaid || []} />
      </div>
    </AdminAsync>
  );
}
