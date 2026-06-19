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
  formatMoney, formatCount, formatCompact, shortDate, relativeTime,
} from '../../lib/adminFormat.js';
import { formatDurationParts } from '../../lib/formatDuration.js';
import { Icon } from '../../components/Icon.jsx';
import { Maximize2, ArrowsClockwise } from '../../lib/icons.js';
import { useAdminData } from './useAdminData.js';
import { useUniverseStats } from './useUniverseStream.js';
import { UniverseGraph } from './UniverseGraph.jsx';
import { useCardPlacements } from './useCardPlacements.js';

const SOLEIL = '#ffa500';
const GREEN  = '#50c878';
const GREY   = '#9aa0aa';

const TIP = {
  contentStyle: { background: 'var(--bg-2)', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 12 },
  labelStyle:   { color: 'var(--ink-1)' },
  itemStyle:    { color: 'var(--soleil)' },
};
const AXIS = { stroke: 'var(--ink-3)', fontSize: 10, tickLine: false, axisLine: false };

// Live-placement ticker labels + per-kind dot color.
const KIND_ARTICLE = { image: 'an image', note: 'a note', link: 'a link', palette: 'a palette', doc: 'a doc', url: 'a URL' };
const KIND_COLOR   = { image: '#ffa500', note: '#50c878', link: '#7da0dc', palette: '#c08cff', doc: '#7da0dc', url: '#9aa0aa' };
function placementText(p) {
  return p.n > 1 ? `placed ${p.n} cards` : `placed ${KIND_ARTICLE[p.kind] || 'a card'}`;
}

export function AdminCommandCenter() {
  const stageRef = useRef(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const { stats: uni } = useUniverseStats();

  // Seed/refresh today's snapshot once so the trend has a current datapoint.
  useEffect(() => { supabase.rpc('admin_capture_metrics_now').then(() => {}, () => {}); }, []);

  // Once the universe has loaded + settled inside its (small) box, frame every
  // node. The initial auto-fit already runs, but the box is smaller than the
  // stage, so re-fit once positions/box are final.
  useEffect(() => {
    const t = setTimeout(() => setResetSignal((n) => n + 1), 1600);
    return () => clearTimeout(t);
  }, []);

  const { data, lastUpdated } = useAdminData(async () => {
    const r = await Promise.allSettled([
      supabase.rpc('admin_stats'),
      supabase.rpc('admin_active_now', { p_window_minutes: 5 }),
      supabase.rpc('admin_metrics_history', { p_days: 90 }),
      supabase.rpc('admin_signups_by_day', { p_days: 30 }),
      supabase.rpc('admin_waitlist_funnel', { p_days: 30 }),
      supabase.rpc('admin_activation_funnel'),
      // Command Center is the "everything happening" wall → include all activity
      // (exclude_internal:false) so these match the live placement stream.
      supabase.rpc('admin_card_stats',    { p_days: 90, p_exclude_internal: false }),
      supabase.rpc('admin_cards_per_day', { p_days: 30, p_exclude_internal: false }),
    ]);
    const val = (x) => (x.status === 'fulfilled' && !x.value.error ? x.value.data : null);
    return {
      stats:       val(r[0]),
      activeNow:   val(r[1]),
      history:     val(r[2]) || [],
      signups:     val(r[3]) || [],
      waitlist:    val(r[4]) || [],
      activation:  val(r[5]),
      cardStats:   val(r[6]),
      cardsPerDay: val(r[7]) || [],
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

  const { items: placements } = useCardPlacements();
  // Pad a short feed up to ≥6 before doubling so the seamless -50% scroll never
  // exposes a blank gap on a quiet wall; the track always renders two copies.
  const tapeBase = placements.length && placements.length < 6
    ? Array.from({ length: Math.ceil(6 / placements.length) }, () => placements).flat()
    : placements;

  // Content mix (card kinds) — pairs visually with the tier-mix donut above it.
  const contentMix = Object.entries((data?.cardStats || {}).by_kind || {})
    .map(([name, value]) => ({ name, value: Number(value) || 0 }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);
  const contentTotal = contentMix.reduce((a, b) => a + b.value, 0);

  // Card activity · 30d — how many cards were *last edited* on each day.
  // card_index has no creation time (only updated_at), so this is a recency /
  // activity view, not a creation count — labeled accordingly. It's not a
  // running total, so it deliberately doesn't compete with the live universe
  // "Cards" tally in the bottom strip.
  const cardsDaily = (data?.cardsPerDay || []).map((r) => ({ label: shortDate(r.day), cards: r.cards || 0 }));

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

  // Kiosk: in fullscreen, hide the cursor after a few seconds of no movement
  // (any move/click/scroll brings it back). Toggle a class on the stage so the
  // high-frequency mousemove path never re-renders React.
  useEffect(() => {
    const stage = stageRef.current;
    if (!isFullscreen || !stage) return;
    let t;
    const wake = () => {
      stage.classList.remove('cc-idle');
      clearTimeout(t);
      t = setTimeout(() => stage.classList.add('cc-idle'), 2500);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('mousedown', wake);
    window.addEventListener('wheel', wake, { passive: true });
    return () => {
      clearTimeout(t);
      stage.classList.remove('cc-idle');
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('mousedown', wake);
      window.removeEventListener('wheel', wake);
    };
  }, [isFullscreen]);

  return (
    <div className={`cc-stage ${isFullscreen ? 'is-fullscreen' : ''}`} ref={stageRef}>
      {/* Full-bleed live universe — fills the whole stage; the frosted frame
          floats on top. Pointer events pass through the frame's empty center. */}
      <div className="cc-universe-bg">
        <UniverseGraph onNodeClick={() => {}} resetSignal={resetSignal} fitAll />
      </div>
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
            <ResponsiveContainer width="100%" height="100%">
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
            <ResponsiveContainer width="100%" height="100%">
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

          <CcPanel title="Time in app" className="cc-bignum"
                   sub={`${formatCount(stats?.total_users ?? 0)} users`}>
            <CountUpDuration value={stats?.total_seconds_in_app ?? 0} />
            <div className="cc-bignum-note">summed across everyone</div>
          </CcPanel>

          <CcPanel title="Content mix" className="cc-pie" sub={`${formatCount(contentTotal)} cards`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={contentMix} dataKey="value" nameKey="name" innerRadius={26} outerRadius={42}
                     paddingAngle={2} stroke="var(--bg-1)">
                  {contentMix.map((d) => <Cell key={d.name} fill={KIND_COLOR[d.name] || GREY} />)}
                </Pie>
                <Tooltip {...TIP} itemStyle={{ color: 'var(--ink-0)' }} />
                <Legend verticalAlign="bottom" align="center" layout="horizontal" iconSize={9}
                        iconType="circle" wrapperStyle={{ fontSize: 11, color: 'var(--ink-2)', lineHeight: '14px' }} />
              </PieChart>
            </ResponsiveContainer>
          </CcPanel>
        </div>

        {/* Right rail — funnels */}
        <div className="cc-rail cc-rail-right">
          <CcPanel title="Signups · 30d"
                   sub={`${formatCount(signups.reduce((a, b) => a + (b.signups || 0), 0))} total`}>
            <ResponsiveContainer width="100%" height="100%">
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
            <ResponsiveContainer width="100%" height="100%">
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
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={activation} layout="vertical" margin={{ top: 2, right: 10, bottom: 2, left: 2 }}>
                <XAxis type="number" {...AXIS} hide allowDecimals={false} />
                <YAxis type="category" dataKey="stage" {...AXIS} width={66} />
                <Tooltip {...TIP} cursor={{ fill: 'rgba(255,165,0,.08)' }} />
                <Bar dataKey="value" fill={GREEN} radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CcPanel>

          <CcPanel title="Card activity · 30d" sub="by last edit">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cardsDaily} margin={{ top: 6, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="var(--line-1)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...AXIS} width={28} allowDecimals={false} />
                <Tooltip {...TIP} cursor={{ fill: 'rgba(255,165,0,.08)' }} />
                <Bar dataKey="cards" fill={SOLEIL} radius={[3, 3, 0, 0]} />
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

          <div className="cc-leaders cc-ticker">
            <span className="cc-tape-label"><span className="cc-live-dot" /> Live</span>
            <div className="cc-tape">
              {placements.length === 0 ? (
                <span className="cc-tape-empty">Waiting for the next card…</span>
              ) : (
                <div className="cc-tape-track"
                     style={{ animationDuration: `${Math.max(28, tapeBase.length * 4.5)}s` }}>
                  {[...tapeBase, ...tapeBase].map((p, i) => (
                    <span className="cc-tape-item" key={`${p._key}-${i}`}>
                      <span className="cc-ticker-dot" style={{ color: KIND_COLOR[p.kind] || 'var(--soleil)' }} />
                      <span className="cc-tape-actor">{p.actor || 'someone'}</span>
                      <span className="cc-tape-what">{placementText(p)}</span>
                      <span className="cc-tape-time">{relativeTime(p.occurred_at)}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
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

// Big "always going up" duration: RAF-animates the seconds toward each new
// value (count-up only, since total time is monotonic) and renders the full
// multi-unit breakdown (years → seconds) so it never collapses to one token.
function CountUpDuration({ value }) {
  const [shown, setShown] = useState(Number(value) || 0);
  const fromRef = useRef(Number(value) || 0);
  useEffect(() => {
    const target = Number(value) || 0;
    const from = fromRef.current;
    if (target === from) return undefined;
    const start = performance.now();
    const dur = 800;
    let raf = 0;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (target - from) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
      else { fromRef.current = target; setShown(target); }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <div className="cc-dur">
      {formatDurationParts(shown).map((p) => (
        <span className="cc-dur-seg" key={p.unit}>
          <span className="cc-dur-val">{p.value}</span>
          <span className="cc-dur-unit">{p.unit}</span>
        </span>
      ))}
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

function CcPanel({ title, sub, className = '', children }) {
  return (
    <section className={`cc-panel ${className}`.trim()}>
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
