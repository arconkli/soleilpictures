// AdminCommandCenter — the office-wall "command center" view of the Universe tab.
//
// The live 3D universe is the centerpiece (reused verbatim from <UniverseGraph>);
// frosted-glass panels frame the edges with live business metrics:
//   • top    — hero KPI row (MRR, active-now, users, paying, waitlist)
//   • left   — MRR trend, users-growth trend, tier mix
//   • right  — signups·30d, waitlist funnel, activation funnel
//   • bottom — live universe totals + a top-users leaderboard
//
// Metrics auto-refresh every ~20s (useAdminData pollIntervalMs); the universe
// numbers stream live over SSE (useUniverseStats); a fullscreen button drives
// kiosk mode. The open center passes pointer events through to the universe so
// it stays pan/zoom interactive behind the frame.

import { useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { supabase } from '../../lib/supabase.js';
import {
  formatMoney, formatCount, formatCompact, shortDate, TIER_COLORS,
} from '../../lib/adminFormat.js';
import { Icon } from '../../components/Icon.jsx';
import { Maximize2, ArrowsClockwise } from '../../lib/icons.js';
import { useAdminData } from './useAdminData.js';
import { useUniverseStats } from './useUniverseStream.js';
import { UniverseGraph } from './UniverseGraph.jsx';
import { TierPill } from './AdminPills.jsx';

const SOLEIL = '#ffa500';
const GREEN  = '#50c878';
const GREY   = '#9aa0aa';

const TIP = {
  contentStyle: { background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 12 },
  labelStyle:   { color: 'var(--ink-1)' },
  itemStyle:    { color: 'var(--soleil)' },
};
const AXIS = { stroke: 'var(--ink-3)', fontSize: 10, tickLine: false, axisLine: false };

export function AdminCommandCenter() {
  const stageRef = useRef(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { stats: uni } = useUniverseStats();

  // Seed/refresh today's snapshot once so the trend has a current datapoint.
  useEffect(() => { supabase.rpc('admin_capture_metrics_now').then(() => {}, () => {}); }, []);

  const { data, lastUpdated } = useAdminData(async () => {
    const r = await Promise.allSettled([
      supabase.rpc('admin_stats'),
      supabase.rpc('admin_active_now', { p_window_minutes: 5 }),
      supabase.rpc('admin_metrics_history', { p_days: 90 }),
      supabase.rpc('admin_signups_by_day', { p_days: 30 }),
      supabase.rpc('admin_waitlist_funnel', { p_days: 30 }),
      supabase.rpc('admin_activation_funnel'),
      supabase.rpc('admin_top_users', { p_tier: null, p_limit: 8 }),
    ]);
    const val = (x) => (x.status === 'fulfilled' && !x.value.error ? x.value.data : null);
    return {
      stats:      val(r[0]),
      activeNow:  val(r[1]),
      history:    val(r[2]) || [],
      signups:    val(r[3]) || [],
      waitlist:   val(r[4]) || [],
      activation: val(r[5]),
      topUsers:   val(r[6]) || [],
    };
  }, [], { pollIntervalMs: 20000 });

  const stats   = data?.stats || null;
  const tiers   = stats?.tier_counts || {};
  const history = data?.history || [];
  const trend   = history.map((h) => ({
    label: shortDate(h.day),
    mrr: (h.mrr_cents || 0) / 100,
    users: h.total_users || 0,
    active: h.active_users || 0,
  }));
  const sparse = trend.length < 2;

  const signups = (data?.signups || []).map((s) => ({ ...s, label: shortDate(s.day) }));
  const waitlist = (data?.waitlist || []).map((w) => ({ ...w, label: shortDate(w.day) }));

  const act = data?.activation || {};
  const activation = [
    { stage: 'Signed up',   value: act.signed_up   || 0 },
    { stage: 'First board', value: act.first_board || 0 },
    { stage: 'First card',  value: act.first_card  || 0 },
    { stage: 'First share', value: act.first_share || 0 },
    { stage: 'Paid',        value: act.first_paid  || 0 },
  ];

  const pieData = ['admin', 'paid', 'demo', 'waitlist']
    .map((t) => ({ name: t, value: tiers[t] || 0 }))
    .filter((d) => d.value > 0);

  const topUsers = data?.topUsers || [];

  const toggleFullscreen = () => {
    const el = stageRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    }
  };
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  return (
    <div className={`cc-stage ${isFullscreen ? 'is-fullscreen' : ''}`} ref={stageRef}>
      {/* Centerpiece — the live universe fills the stage behind the frame. */}
      <UniverseGraph onNodeClick={() => {}} resetSignal={resetSignal} />

      <div className="cc-frame">
        {/* Top — hero KPI row */}
        <div className="cc-top">
          <Kpi label="MRR" value={formatMoney(stats?.mrr_cents ?? 0)} accent
               sub={`${formatCount(tiers.paid || 0)} paying`} />
          <Kpi label={<><span className="cc-live-dot" /> Active now</>}
               value={formatCount(data?.activeNow ?? 0)} sub="last 5 min" live />
          <Kpi label="Total users" value={formatCompact(stats?.total_users ?? 0)}
               sub={`+${formatCount(stats?.new_users_7d ?? 0)} / 7d`} />
          <Kpi label="Paying" value={formatCount(tiers.paid ?? 0)}
               sub={`${formatCount(stats?.comped_paid ?? 0)} comped`} />
          <Kpi label="Waitlist" value={formatCount(stats?.waitlist_pending ?? 0)}
               sub={`${formatCount(stats?.waitlist_total ?? 0)} all-time`} />
        </div>

        {/* Left rail — revenue + growth + mix */}
        <div className="cc-rail cc-rail-left">
          <CcPanel title="Revenue · MRR" sub={sparse ? 'trend builds daily' : `${trend.length}d`}>
            <ResponsiveContainer width="100%" height={132}>
              <AreaChart data={trend} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id="ccMrr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SOLEIL} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={SOLEIL} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--line-1)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...AXIS} width={40} tickFormatter={(v) => `$${v}`} />
                <Tooltip {...TIP} formatter={(v) => formatMoney(v * 100)} />
                <Area type="monotone" dataKey="mrr" stroke={SOLEIL} strokeWidth={2}
                      fill="url(#ccMrr)" dot={sparse} />
              </AreaChart>
            </ResponsiveContainer>
          </CcPanel>

          <CcPanel title="Users · growth" sub={sparse ? 'trend builds daily' : `${trend.length}d`}>
            <ResponsiveContainer width="100%" height={132}>
              <AreaChart data={trend} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id="ccUsers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={GREEN} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--line-1)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...AXIS} width={32} allowDecimals={false} />
                <Tooltip {...TIP} itemStyle={{ color: GREEN }} />
                <Area type="monotone" dataKey="users" stroke={GREEN} strokeWidth={2}
                      fill="url(#ccUsers)" dot={sparse} />
              </AreaChart>
            </ResponsiveContainer>
          </CcPanel>

          <CcPanel title="Tier mix" sub={`${pieData.reduce((a, b) => a + b.value, 0)} accounts`}>
            <ResponsiveContainer width="100%" height={132}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={34} outerRadius={54}
                     paddingAngle={2} stroke="var(--bg-1)">
                  {pieData.map((d) => <Cell key={d.name} fill={TIER_COLORS[d.name] || '#888'} />)}
                </Pie>
                <Tooltip {...TIP} itemStyle={{ color: 'var(--ink-0)' }} />
                <Legend verticalAlign="middle" align="right" layout="vertical" iconSize={9}
                        iconType="circle" wrapperStyle={{ fontSize: 11, color: 'var(--ink-2)' }} />
              </PieChart>
            </ResponsiveContainer>
          </CcPanel>
        </div>

        {/* Right rail — funnels */}
        <div className="cc-rail cc-rail-right">
          <CcPanel title="Signups · 30d"
                   sub={`${formatCount(signups.reduce((a, b) => a + (b.signups || 0), 0))} total`}>
            <ResponsiveContainer width="100%" height={132}>
              <BarChart data={signups} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="var(--line-1)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...AXIS} width={28} allowDecimals={false} />
                <Tooltip {...TIP} cursor={{ fill: 'rgba(255,165,0,.08)' }} />
                <Bar dataKey="signups" fill={SOLEIL} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CcPanel>

          <CcPanel title="Waitlist funnel · 30d"
                   sub={`${formatCount(waitlist.reduce((a, b) => a + (b.accepted || 0), 0))} accepted`}>
            <ResponsiveContainer width="100%" height={132}>
              <LineChart data={waitlist} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="var(--line-1)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...AXIS} width={28} allowDecimals={false} />
                <Tooltip {...TIP} itemStyle={{ color: 'var(--ink-0)' }} />
                <Line type="monotone" dataKey="submitted" stroke={GREY} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="accepted" stroke={SOLEIL} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CcPanel>

          <CcPanel title="Activation funnel">
            <ResponsiveContainer width="100%" height={132}>
              <BarChart data={activation} layout="vertical" margin={{ top: 2, right: 10, bottom: 2, left: 2 }}>
                <XAxis type="number" {...AXIS} hide allowDecimals={false} />
                <YAxis type="category" dataKey="stage" {...AXIS} width={66} />
                <Tooltip {...TIP} cursor={{ fill: 'rgba(255,165,0,.08)' }} />
                <Bar dataKey="value" fill={GREEN} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CcPanel>
        </div>

        {/* Bottom — live universe totals + leaderboard */}
        <div className="cc-bottom">
          <div className="cc-uni">
            <UniCell label="Workspaces" value={uni?.total_workspaces} delta={uni?.today?.workspaces} />
            <UniCell label="Boards"     value={uni?.total_boards}     delta={uni?.today?.boards} />
            <UniCell label="Cards"      value={uni?.total_cards}      delta={uni?.today?.cards} />
            <UniCell label="Links"      value={uni?.total_links}      delta={uni?.today?.links} />
            <UniCell label="New · 24h"  value={uni?.nodes_created_24h} />
          </div>

          <div className="cc-leaders">
            <div className="cc-leaders-title">Top creators</div>
            <ol className="cc-leaders-list">
              {topUsers.slice(0, 6).map((u, i) => (
                <li key={u.user_id} className="cc-leader">
                  <span className="cc-leader-rank">{i + 1}</span>
                  <span className="cc-leader-email">{u.email}</span>
                  <TierPill tier={u.tier} />
                  <span className="cc-leader-count">{formatCount(u.card_count)}</span>
                </li>
              ))}
              {topUsers.length === 0 && <li className="cc-leader cc-leader-empty">No data yet.</li>}
            </ol>
          </div>
        </div>

        {/* Corner controls */}
        <div className="cc-controls">
          {lastUpdated && (
            <span className="cc-updated t-meta">live · {new Date(lastUpdated).toLocaleTimeString()}</span>
          )}
          <button className="cc-ctrl-btn" onClick={() => setResetSignal((n) => n + 1)} title="Reset view" aria-label="Reset view">
            <Icon as={ArrowsClockwise} size={16} />
          </button>
          <button className="cc-ctrl-btn" onClick={toggleFullscreen}
                  title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'} aria-label="Toggle fullscreen">
            <Icon as={Maximize2} size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, accent, live }) {
  return (
    <div className={`cc-kpi ${accent ? 'is-accent' : ''} ${live ? 'is-live' : ''}`}>
      <div className="cc-kpi-label">{label}</div>
      <div className="cc-kpi-value">{value}</div>
      {sub && <div className="cc-kpi-sub">{sub}</div>}
    </div>
  );
}

function CcPanel({ title, sub, children }) {
  return (
    <section className="cc-panel">
      <header className="cc-panel-head">
        <h4 className="cc-panel-title">{title}</h4>
        {sub && <span className="cc-panel-sub">{sub}</span>}
      </header>
      <div className="cc-panel-body">{children}</div>
    </section>
  );
}

function UniCell({ label, value, delta }) {
  return (
    <div className="cc-uni-cell">
      <div className="cc-uni-num">{formatCompact(value ?? 0)}</div>
      <div className="cc-uni-label">{label}</div>
      {delta > 0 && <div className="cc-uni-delta">+{formatCount(delta)} today</div>}
    </div>
  );
}
