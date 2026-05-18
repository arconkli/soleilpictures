// AdminOverviewTab — KPI cards + signups bar chart + waitlist funnel bars
// + tier-distribution pie + recent-signups list. One mount triggers four
// RPCs (admin_stats, admin_signups_by_day, admin_waitlist_funnel,
// admin_list_users(10, 0)) in parallel.

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid,
} from 'recharts';
import { supabase } from '../../lib/supabase.js';
import { AdminStatCard } from './AdminStatCard.jsx';

const TIER_COLORS = {
  admin:    '#ffa500',  // soleil
  paid:     '#50c878',  // emerald
  demo:     '#9aa0aa',  // mid-grey
  waitlist: '#7a8090',  // dim
};
const SOLEIL = '#ffa500';

function relativeTime(iso) {
  if (!iso) return '—';
  const d  = new Date(iso);
  const ms = Date.now() - d.getTime();
  const m  = Math.floor(ms / 60000);
  if (m < 1)        return 'just now';
  if (m < 60)       return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)       return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30)    return `${days}d ago`;
  return d.toLocaleDateString();
}

function dollarsFromCents(cents) {
  if (!cents) return '$0';
  return '$' + (cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

export function AdminOverviewTab() {
  const [stats, setStats]       = useState(null);
  const [signups, setSignups]   = useState([]);
  const [funnel, setFunnel]     = useState([]);
  const [recent, setRecent]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase.rpc('admin_stats'),
      supabase.rpc('admin_signups_by_day', { p_days: 30 }),
      supabase.rpc('admin_waitlist_funnel', { p_days: 30 }),
      supabase.rpc('admin_list_users', { p_limit: 10, p_offset: 0 }),
    ])
      .then(([s, sb, f, rl]) => {
        if (cancelled) return;
        if (s.error)   throw s.error;
        if (sb.error)  throw sb.error;
        if (f.error)   throw f.error;
        if (rl.error)  throw rl.error;
        setStats(s.data || null);
        setSignups(sb.data || []);
        setFunnel(f.data || []);
        setRecent(rl.data || []);
      })
      .catch((e) => { if (!cancelled) setError(e?.message || String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="admin-empty">Loading…</div>;
  if (error)   return <div className="auth-error t-meta" style={{ padding: 40 }}>{error}</div>;

  const tierCounts = stats?.tier_counts || {};
  const pieData = ['admin', 'paid', 'demo', 'waitlist']
    .map((tier) => ({ name: tier, value: tierCounts[tier] || 0 }))
    .filter((d) => d.value > 0);

  return (
    <div className="admin-overview">

      {/* KPI cards */}
      <div className="admin-stat-grid">
        <AdminStatCard
          label="Total users"
          value={(stats?.total_users ?? 0).toLocaleString()}
          sub={`+${stats?.new_users_7d ?? 0} in the last 7 days`}
        />
        <AdminStatCard
          label="MRR (active subs)"
          value={dollarsFromCents(stats?.mrr_cents ?? 0)}
          sub={`${tierCounts.paid || 0} paying customer${(tierCounts.paid || 0) === 1 ? '' : 's'}`}
          accent
        />
        <AdminStatCard
          label="Demo accounts"
          value={(tierCounts.demo || 0).toLocaleString()}
        />
        <AdminStatCard
          label="Waitlist pending"
          value={(stats?.waitlist_pending ?? 0).toLocaleString()}
          sub={`${stats?.waitlist_total ?? 0} total ever joined`}
        />
      </div>

      {/* Charts row */}
      <div className="admin-charts-row">

        {/* Signups bar */}
        <section className="admin-chart-panel">
          <header className="admin-chart-head">
            <h3 className="admin-chart-title">Signups · last 30 days</h3>
            <span className="admin-chart-sub t-meta">
              {signups.reduce((a, b) => a + (b.signups || 0), 0)} total
            </span>
          </header>
          <div className="admin-chart-body">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={signups.map((r) => ({ ...r, label: shortDate(r.day) }))}
                        margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="var(--line-1)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" stroke="var(--ink-3)" fontSize={10} interval="preserveStartEnd" tickLine={false} axisLine={false} />
                <YAxis stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(255,165,0,.08)' }}
                  contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--ink-1)' }}
                  itemStyle={{ color: 'var(--soleil)' }}
                />
                <Bar dataKey="signups" fill={SOLEIL} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Tier distribution pie */}
        <section className="admin-chart-panel">
          <header className="admin-chart-head">
            <h3 className="admin-chart-title">Tier distribution</h3>
            <span className="admin-chart-sub t-meta">
              {pieData.reduce((a, b) => a + b.value, 0)} accounts
            </span>
          </header>
          <div className="admin-chart-body">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={56}
                  outerRadius={86}
                  paddingAngle={2}
                  stroke="var(--bg-1)"
                >
                  {pieData.map((d) => (
                    <Cell key={d.name} fill={TIER_COLORS[d.name] || '#888'} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'var(--ink-1)' }}
                  itemStyle={{ color: 'var(--ink-0)' }}
                />
                <Legend
                  verticalAlign="bottom"
                  align="center"
                  iconSize={10}
                  iconType="circle"
                  wrapperStyle={{ fontSize: 11, color: 'var(--ink-2)' }}
                />
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
            {funnel.reduce((a, b) => a + (b.submitted || 0), 0)} submitted
            {' · '}
            {funnel.reduce((a, b) => a + (b.accepted  || 0), 0)} accepted
          </span>
        </header>
        <div className="admin-chart-body">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={funnel.map((r) => ({ ...r, label: shortDate(r.day) }))}
                       margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--line-1)" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="label" stroke="var(--ink-3)" fontSize={10} interval="preserveStartEnd" tickLine={false} axisLine={false} />
              <YAxis stroke="var(--ink-3)" fontSize={10} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--ink-1)' }}
              />
              <Legend
                verticalAlign="top"
                align="right"
                iconSize={10}
                iconType="circle"
                wrapperStyle={{ fontSize: 11, color: 'var(--ink-2)' }}
              />
              <Line type="monotone" dataKey="submitted" stroke="#9aa0aa" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="accepted"  stroke={SOLEIL}  strokeWidth={2} dot={false} />
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
              <span className={`admin-status admin-status-${u.tier}`}>{u.tier}</span>
              <span className="admin-email">{u.email}</span>
              <span className="admin-muted">{relativeTime(u.created_at)}</span>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}

function shortDate(d) {
  // e.g. 5/18
  const dt = new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}
