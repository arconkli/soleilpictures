// AdminOverviewTab — KPI cards + signups bar + waitlist funnel + tier
// pie + recent signups. Fires its RPCs with allSettled so one failed
// query renders a partial page instead of blanking the whole tab; only a
// total failure shows the retry surface.

import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { supabase } from '../../lib/supabase.js';
import { formatDuration } from '../../lib/formatDuration.js';
import { CopyableText } from '../../components/CopyableText.jsx';
import { relativeTime, fmtDateTime, shortDate, formatMoney, formatCount, TIER_COLORS } from '../../lib/adminFormat.js';
import { useAdminData } from './useAdminData.js';
import { AdminToolbar, AdminAsync, AdminSkeleton } from './AdminStates.jsx';
import { AdminStatCard } from './AdminStatCard.jsx';
import { TierPill } from './AdminPills.jsx';
import { CHART } from './chartTheme.js';

export function AdminOverviewTab() {
  const { data, loading, error, refreshing, lastUpdated, refresh } = useAdminData(async () => {
    const results = await Promise.allSettled([
      supabase.rpc('admin_stats'),
      supabase.rpc('admin_signups_by_day', { p_days: 30 }),
      supabase.rpc('admin_waitlist_funnel', { p_days: 30 }),
      supabase.rpc('admin_list_users', { p_limit: 10, p_offset: 0 }),
      supabase.rpc('admin_avg_time_to_paid'),
    ]);
    const [s, sb, f, rl, c] = results;
    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;
    // If every core query failed, surface an error so the retry UI shows.
    const core = [s, sb, f, rl];
    if (!core.some((r) => r.status === 'fulfilled' && !r.value.error)) {
      throw errOf(core.find(errOf)) || new Error('Failed to load overview');
    }
    return {
      stats:   val(s),
      signups: val(sb) || [],
      funnel:  val(f) || [],
      recent:  val(rl) || [],
      conv:    val(c),
    };
  }, []);

  const stats   = data?.stats || null;
  const signups = data?.signups || [];
  const funnel  = data?.funnel || [];
  const recent  = data?.recent || [];
  const conv    = data?.conv || null;

  const tierCounts = stats?.tier_counts || {};
  const pieData = ['admin', 'paid', 'demo', 'waitlist']
    .map((tier) => ({ name: tier, value: tierCounts[tier] || 0 }))
    .filter((d) => d.value > 0);

  return (
    <div className="admin-overview">
      <AdminToolbar onRefresh={refresh} refreshing={refreshing} lastUpdated={lastUpdated} />

      <AdminAsync
        loading={loading}
        error={error}
        onRetry={refresh}
        skeleton={<><AdminSkeleton variant="cards" rows={4} /><div style={{ height: 16 }} /><AdminSkeleton variant="chart" /></>}
      >
        <div className={refreshing ? 'is-refreshing' : ''}>
          {/* KPI cards */}
          <div className="admin-stat-grid">
            <AdminStatCard label="Total users" value={formatCount(stats?.total_users)} sub={`+${stats?.new_users_7d ?? 0} in the last 7 days`} />
            <AdminStatCard label="MRR (active subs)" value={formatMoney(stats?.mrr_cents ?? 0)}
              sub={`${tierCounts.paid || 0} paying customer${(tierCounts.paid || 0) === 1 ? '' : 's'}`} accent />
            <AdminStatCard label="Demo accounts" value={formatCount(tierCounts.demo)} />
            <AdminStatCard label="Waitlist pending" value={formatCount(stats?.waitlist_pending)} sub={`${stats?.waitlist_total ?? 0} total ever joined`} />
            {conv && (
              <AdminStatCard label="Median time to paid"
                value={conv.paid_users > 0 ? formatDuration(conv.median_seconds) : '—'}
                sub={conv.paid_users > 0 ? `${conv.paid_users} converted · avg ${formatDuration(conv.avg_seconds)}` : 'no conversions yet'} />
            )}
          </div>

          {/* Charts row */}
          <div className="admin-charts-row">
            <section className="admin-chart-panel">
              <header className="admin-chart-head">
                <h3 className="admin-chart-title">Signups · last 30 days</h3>
                <span className="admin-chart-sub t-meta">{signups.reduce((a, b) => a + (b.signups || 0), 0)} total</span>
              </header>
              <div className="admin-chart-body">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={signups.map((r) => ({ ...r, label: shortDate(r.day) }))} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                    <CartesianGrid {...CHART.grid} />
                    <XAxis dataKey="label" {...CHART.axis} interval="preserveStartEnd" />
                    <YAxis {...CHART.axis} allowDecimals={false} />
                    <Tooltip {...CHART.tooltip} />
                    <Bar dataKey="signups" fill={CHART.soleil} radius={[3, 3, 0, 0]} {...CHART.noAnim} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="admin-chart-panel">
              <header className="admin-chart-head">
                <h3 className="admin-chart-title">Tier distribution</h3>
                <span className="admin-chart-sub t-meta">{pieData.reduce((a, b) => a + b.value, 0)} accounts</span>
              </header>
              <div className="admin-chart-body">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={56} outerRadius={86} paddingAngle={2} stroke="var(--bg-1)" {...CHART.noAnim}>
                      {pieData.map((d) => <Cell key={d.name} fill={TIER_COLORS[d.name] || '#888'} />)}
                    </Pie>
                    <Tooltip {...CHART.tooltip} />
                    <Legend verticalAlign="bottom" align="center" iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11, color: 'var(--ink-2)' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </section>
          </div>

          {/* Waitlist funnel */}
          <section className="admin-chart-panel admin-chart-panel-wide">
            <header className="admin-chart-head">
              <h3 className="admin-chart-title">Waitlist funnel · last 30 days</h3>
              <span className="admin-chart-sub t-meta">
                {funnel.reduce((a, b) => a + (b.submitted || 0), 0)} submitted · {funnel.reduce((a, b) => a + (b.accepted || 0), 0)} accepted
              </span>
            </header>
            <div className="admin-chart-body">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={funnel.map((r) => ({ ...r, label: shortDate(r.day) }))} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid {...CHART.grid} />
                  <XAxis dataKey="label" {...CHART.axis} interval="preserveStartEnd" />
                  <YAxis {...CHART.axis} allowDecimals={false} />
                  <Tooltip {...CHART.tooltip} />
                  <Legend verticalAlign="top" align="right" iconSize={10} iconType="circle" wrapperStyle={{ fontSize: 11, color: 'var(--ink-2)' }} />
                  <Line type="monotone" dataKey="submitted" stroke={CHART.series[3]} strokeWidth={2} dot={false} {...CHART.noAnim} />
                  <Line type="monotone" dataKey="accepted"  stroke={CHART.soleil}    strokeWidth={2} dot={false} {...CHART.noAnim} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Recent signups */}
          <section className="admin-chart-panel admin-chart-panel-wide">
            <header className="admin-chart-head">
              <h3 className="admin-chart-title">Recent signups</h3>
              <span className="admin-chart-sub t-meta">last {recent.length}</span>
            </header>
            <div className="admin-recent-list">
              {recent.length === 0 ? (
                <div className="admin-empty">No users yet.</div>
              ) : recent.map((u) => (
                <div key={u.user_id} className="admin-recent-row">
                  <TierPill tier={u.tier} />
                  <CopyableText value={u.email} className="admin-email" />
                  <span className="admin-muted" title={fmtDateTime(u.created_at)}>{relativeTime(u.created_at)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </AdminAsync>
    </div>
  );
}
