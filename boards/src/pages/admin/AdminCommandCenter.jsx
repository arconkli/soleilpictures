// AdminCommandCenter — the office-wall view of the Universe tab.
//
// The live 3D universe is the centerpiece (reused verbatim from <UniverseGraph>);
// frosted-glass panels frame the edges:
//   • top    — hero KPI row (MRR, active-now, users, activation, cards today)
//   • left   — MRR trend, users-growth trend, time in app, content mix
//   • right  — signups·30d, waitlist funnel, activation funnel, cards created
//   • bottom — what the renderer actually drew + the live placement tape
//
// Metrics auto-refresh every ~20s (useAdminData pollIntervalMs); the universe
// numbers stream live over SSE (useUniverseStats); a fullscreen button drives
// kiosk mode. The open center passes pointer events through to the universe so
// it stays pan/zoom interactive behind the frame.
//
// Two rules this file learned the hard way, both worth keeping:
//
//   1. NOTHING HERE INVENTS DATA. The "Time in app" counter used to integrate
//      a rate with a floor of 1/s, so it ticked upward at one second per
//      second even when literally nobody was online, and it was monotonic, so
//      it never corrected back down. The live tape used to repeat real
//      placements to look busy on a quiet day. A wall display is exactly where
//      that is most damaging — it is the number people quote in meetings.
//
//   2. EVERY PANEL DECLARES ITS POPULATION. The panels here draw from windows
//      and filters that genuinely differ (the activation funnel excludes
//      internal accounts, the content mix deliberately does not), so each one
//      says so rather than letting the reader assume they match.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { supabase } from '../../lib/supabase.js';
import {
  formatMoney, formatCount, formatCompact, formatPct, shortDate, relativeTime, safeRate,
} from '../../lib/adminFormat.js';
import { formatDurationParts } from '../../lib/formatDuration.js';
import { ChartGate, PanelNote } from './SmallN.jsx';
import { CHART } from './chartTheme.js';
import { Icon } from '../../components/Icon.jsx';
import { Maximize2, ArrowsClockwise } from '../../lib/icons.js';
import { useAdminData } from './useAdminData.js';
import { useUniverseStats } from './useUniverseStream.js';
import { UniverseGraph, KIND_COLORS } from './UniverseGraph.jsx';
import { useCardPlacements } from './useCardPlacements.js';

// The activation funnel's window. The waitlist was switched off on 2026-06-16;
// any window reaching past it mixes two different products (people who queued
// vs people who walked straight in), which is why this panel used to be
// quietly all-time — admin_activation_funnel() delegates to 36500 days. 60d is
// wholly inside the post-waitlist era and still covers most of the signups the
// all-time window did.
const ACTIVATION_DAYS = 60;
// Content mix reads as "the corpus", not a window. 365 is the RPC's clamp.
const CONTENT_DAYS = 365;
// Rows past this fold into "Other" (hover it for the breakdown). Five, not
// seven, because a rail panel is ~110px of body and a sixth row was landing
// half-clipped at the fold.
const MIX_ROWS = 5;

// Live-placement tape labels. Any kind without an article falls through to
// "a card", which is honest for the long tail.
const KIND_ARTICLE = {
  image: 'an image', note: 'a note', link: 'a link', palette: 'a palette',
  doc: 'a doc', url: 'a URL', grid: 'a grid', video: 'a video', pdf: 'a PDF',
  audio: 'an audio clip', shape: 'a shape', schedule: 'a schedule', file: 'a file',
};
function placementText(p) {
  return p.n > 1 ? `placed ${p.n} cards` : `placed ${KIND_ARTICLE[p.kind] || 'a card'}`;
}
// Tape/mix dots reuse the renderer's palette so a colour on the wall means the
// same thing as that colour in the universe behind it.
const dotColor = (kind) => KIND_COLORS[kind] || KIND_COLORS.card;

// dataSource — same dev-only override UniverseGraph takes, threaded through so
// the ?adminpreview harness can render the wall over the synthetic corpus.
// Production passes nothing and the backdrop uses the real party endpoints.
export function AdminCommandCenter({ dataSource = null }) {
  const stageRef = useRef(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [graph, setGraph] = useState(null);

  const { stats: uni } = useUniverseStats();

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
      // Windowed + internal-excluded on purpose; the panel says so. The no-arg
      // overload is all-time and straddles the waitlist cutover.
      supabase.rpc('admin_activation_funnel', {
        p_days: ACTIVATION_DAYS, p_exclude_internal: true, p_verified_only: true,
      }),
      // The wall is the "everything happening" view → include internal activity
      // so these match the live placement tape beside them.
      supabase.rpc('admin_card_stats',    { p_days: CONTENT_DAYS, p_exclude_internal: false }),
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
  const history = data?.history || [];
  const trend   = history.map((h) => ({
    label: shortDate(h.day),
    mrr: (h.mrr_cents || 0) / 100,
    users: h.total_users || 0,
  }));

  // metrics_daily is sparse and is never backfilled, so `trend.length` is a
  // ROW COUNT — it was previously rendered as "Nd", which reads as a span.
  const spanLabel = useMemo(() => {
    if (history.length < 2) return `${history.length} pt`;
    const a = Date.parse(history[0].day);
    const b = Date.parse(history[history.length - 1].day);
    const days = Math.round((b - a) / 86400000) + 1;
    return days === history.length ? `${days}d` : `${days}d · ${history.length} pts`;
  }, [history]);

  const signups  = (data?.signups  || []).map((s) => ({ ...s, label: shortDate(s.day) }));
  const waitlist = (data?.waitlist || []).map((w) => ({ ...w, label: shortDate(w.day) }));

  // Gates: how many points actually carry a value. Both of these series are
  // structurally empty right now (no subscription has ever existed; the
  // waitlist has been off since 2026-06-13), and a flat zero line reads as a
  // measurement rather than an absence. They light up on their own.
  const mrrPoints      = trend.filter((t) => t.mrr > 0).length;
  const waitlistPoints = waitlist.filter((w) => (w.submitted || 0) + (w.accepted || 0) > 0).length;

  const act = data?.activation || {};
  const activation = [
    { stage: 'Signed up',      value: act.signed_up       || 0 },
    { stage: 'First board',    value: act.first_board     || 0 },
    { stage: 'First card',     value: act.first_card      || 0 },
    // The RPC has always returned this and the panel dropped it — it is the
    // stage that separates "clicked once" from "actually made something".
    { stage: 'Filled a board', value: act.populated_board || 0 },
    { stage: 'Shared',         value: act.first_share     || 0 },
  ];
  const activated = safeRate(act.first_card || 0, act.signed_up || 0);

  const { items: placements } = useCardPlacements();

  // Content mix — ranked, not a donut. The card kinds span three orders of
  // magnitude, so a pie is a couple of wedges and a dozen sub-degree slivers,
  // and there are nowhere near that many distinguishable hues
  // (see the palette note in UniverseGraph). A ranked bar direct-labelled with
  // the kind name carries identity in text and magnitude in length, so it
  // needs exactly one colour and stays readable in a 280px rail.
  const contentMix = useMemo(() => {
    const all = Object.entries((data?.cardStats || {}).by_kind || {})
      .map(([name, value]) => ({ name, value: Number(value) || 0 }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);
    if (all.length <= MIX_ROWS + 1) return all;
    const head = all.slice(0, MIX_ROWS);
    const tail = all.slice(MIX_ROWS);
    return [...head, {
      name: 'other',
      value: tail.reduce((a, b) => a + b.value, 0),
      tail: tail.map((t) => `${t.name} ${t.value.toLocaleString()}`).join(' · '),
    }];
  }, [data?.cardStats]);
  const contentTotal = contentMix.reduce((a, b) => a + b.value, 0);

  // Cards CREATED per day. Until migration 0254 this was card_index.updated_at,
  // i.e. cards last EDITED that day — which meant re-saving an old card moved
  // it out of its original day and the chart's own history rewrote itself as
  // people worked.
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
        <UniverseGraph onNodeClick={noop} resetSignal={resetSignal} fitAll
                       onStats={setGraph} dataSource={dataSource} />
      </div>
      <div className="cc-frame">
        {/* Top — hero KPI row */}
        <div className="cc-top">
          <Kpi label={<><span className="cc-live-dot" /> Active now</>}
               value={formatCount(data?.activeNow ?? 0)} sub="last 5 min" accent live />
          <Kpi label="Total users" value={formatCompact(stats?.total_users ?? 0)}
               sub={`+${formatCount(stats?.new_users_7d ?? 0)} / 7d`} />
          <Kpi label="Activated"
               value={activated.hide ? '—' : formatPct(activated.rate)}
               sub={`${formatCount(act.first_card ?? 0)} of ${formatCount(act.signed_up ?? 0)} made a card`} />
          <Kpi label="Cards today" value={formatCount(uni?.today?.cards ?? 0)}
               sub={`${formatCompact(uni?.total_cards ?? 0)} all-time`} />
          {/* No gold accent on a zero: --soleil is reserved for live/active
              state, and dressing $0 as the hero number is the tell of a wall
              nobody trusts. It gets the accent back when it earns it. */}
          <Kpi label="MRR" value={formatMoney(stats?.mrr_cents ?? 0)}
               accent={(stats?.mrr_cents ?? 0) > 0}
               sub={`${formatCount(stats?.subscribed_paid ?? 0)} subscribed · ${formatCount(stats?.comped_paid ?? 0)} comped`} />
        </div>

        {/* Left rail — revenue + growth + mix */}
        <div className="cc-rail cc-rail-left">
          <CcPanel title="Revenue · MRR" sub={mrrPoints ? spanLabel : 'no revenue yet'}>
            <ChartGate count={mrrPoints} min={1}
                       title="No revenue yet"
                       sub="No subscription has ever been active. This lights up on its own with the first one.">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="ccMrr" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART.soleil} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={CHART.soleil} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...CHART.grid} />
                  <XAxis dataKey="label" {...CHART.axis} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis {...CHART.axis} width={38} tickFormatter={(v) => `$${formatCompact(v)}`} />
                  <Tooltip {...CHART.tooltip} formatter={(v) => formatMoney(v * 100)} />
                  <Area type="monotone" dataKey="mrr" stroke={CHART.soleil} strokeWidth={2}
                        fill="url(#ccMrr)" dot={mrrPoints < 3} {...CHART.noAnim} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartGate>
          </CcPanel>

          <CcPanel title="Users · growth" sub={spanLabel}>
            <ChartGate count={trend.length}
                       title="Trend builds daily"
                       sub="metrics_daily snapshots once a night and is never backfilled.">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="ccUsers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CHART.green} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={CHART.green} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...CHART.grid} />
                  <XAxis dataKey="label" {...CHART.axis} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis {...CHART.axis} width={34} allowDecimals={false} tickFormatter={formatCompact} />
                  <Tooltip {...CHART.tooltip} itemStyle={{ color: CHART.green }} />
                  <Area type="monotone" dataKey="users" stroke={CHART.green} strokeWidth={2}
                        fill="url(#ccUsers)" {...CHART.noAnim} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartGate>
          </CcPanel>

          <CcPanel title="Time in app" className="cc-bignum"
                   sub={`${formatCount(stats?.total_users ?? 0)} users`}>
            <CountUpDuration value={stats?.total_seconds_in_app ?? 0}
                             ratePerSec={Number(data?.activeNow) || 0}
                             syncedAt={lastUpdated} />
            <div className="cc-bignum-note">summed across signed-in users</div>
          </CcPanel>

          <CcPanel title="Content mix" sub={`${formatCount(contentTotal)} cards`}>
            <RankBar rows={contentMix} total={contentTotal} />
          </CcPanel>
        </div>

        {/* Right rail — funnels */}
        <div className="cc-rail cc-rail-right">
          <CcPanel title="Signups · 30d"
                   sub={`${formatCount(signups.reduce((a, b) => a + (b.signups || 0), 0))} total`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={signups} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid {...CHART.grid} />
                <XAxis dataKey="label" {...CHART.axis} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...CHART.axis} width={26} allowDecimals={false} tickFormatter={formatCompact} />
                <Tooltip {...CHART.tooltip} cursor={{ fill: 'rgba(255,165,0,.08)' }} />
                <Bar dataKey="signups" fill={CHART.soleil} radius={[3, 3, 0, 0]} {...CHART.noAnim} />
              </BarChart>
            </ResponsiveContainer>
          </CcPanel>

          <CcPanel title="Waitlist funnel · 30d"
                   sub={waitlistPoints
                     ? `${formatCount(waitlist.reduce((a, b) => a + (b.accepted || 0), 0))} accepted`
                     : 'switched off'}>
            <ChartGate count={waitlistPoints} min={1}
                       title="Waitlist is off"
                       sub="No entry has been submitted since 2026-06-13. This lights up on its own if it is re-enabled.">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={waitlist} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid {...CHART.grid} />
                  <XAxis dataKey="label" {...CHART.axis} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis {...CHART.axis} width={26} allowDecimals={false} tickFormatter={formatCompact} />
                  <Tooltip {...CHART.tooltip} />
                  <Line type="monotone" dataKey="submitted" stroke={CHART.series[3]} strokeWidth={2} dot={false} {...CHART.noAnim} />
                  <Line type="monotone" dataKey="accepted" stroke={CHART.soleil} strokeWidth={2} dot={false} {...CHART.noAnim} />
                </LineChart>
              </ResponsiveContainer>
            </ChartGate>
          </CcPanel>

          <CcPanel title="Activation funnel" sub={`${ACTIVATION_DAYS}d`}>
            <StageList stages={activation} />
            <PanelNote>
              Post-waitlist signups only. Excludes internal accounts — the card
              panels don't.
            </PanelNote>
          </CcPanel>

          <CcPanel title="Cards created · 30d" sub="by creation date">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cardsDaily} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
                <CartesianGrid {...CHART.grid} />
                <XAxis dataKey="label" {...CHART.axis} interval="preserveStartEnd" minTickGap={24} />
                <YAxis {...CHART.axis} width={26} allowDecimals={false} tickFormatter={formatCompact} />
                <Tooltip {...CHART.tooltip} cursor={{ fill: 'rgba(255,165,0,.08)' }} />
                <Bar dataKey="cards" fill={CHART.soleil} radius={[3, 3, 0, 0]} {...CHART.noAnim} />
              </BarChart>
            </ResponsiveContainer>
          </CcPanel>
        </div>

        {/* Bottom — what is actually on screen + the live tape */}
        <div className="cc-bottom">
          <div className="cc-uni">
            <UniCell label="Workspaces" value={uni?.total_workspaces} delta={uni?.today?.workspaces} />
            <UniCell label="Boards"     value={uni?.total_boards}     delta={uni?.today?.boards} />
            <UniCell label="Cards"      value={uni?.total_cards}      delta={uni?.today?.cards} />
            {/* Not a counter. platform_counters counts ROWS, and entity_links
                are overwhelmingly tag attachments, which the graph draws as
                nothing — so this cell used to read "Links" over a universe
                containing no link edges at all. These two come from the
                renderer, so the strip can only claim what you can see. */}
            <UniCell label="Nodes"       value={graph?.nodes}
                     title="Nodes the renderer drew. Lower than Cards + Boards: cards on soft-deleted boards keep their row but lose their board." />
            <UniCell label="Connections" value={graph?.edges}
                     title="Edges the renderer drew — hierarchy, board→card, workspace membership and shares. Tag attachments are not drawn." />
            <UniCell label="New · 24h"  value={uni?.nodes_created_24h}
                     title="Users + workspaces + boards + cards created in the last 24 hours." />
          </div>

          <div className="cc-ticker">
            <span className="cc-tape-label"><span className="cc-live-dot" /> Live</span>
            <Tape items={placements} />
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

function noop() {}

// Live placement tape. The marquee needs two copies of the track to loop
// seamlessly (-50% lands copy 2's start exactly where copy 1 began), but a
// short feed used to be PADDED with repeats of the same real placements first,
// so a quiet day was dressed up as a busy one. Below the fold it just renders
// what happened, statically.
const TAPE_MIN_TO_SCROLL = 6;
function Tape({ items }) {
  if (items.length === 0) {
    return <div className="cc-tape"><span className="cc-tape-empty">Waiting for the next card…</span></div>;
  }
  const scroll = items.length >= TAPE_MIN_TO_SCROLL;
  const rendered = scroll ? [...items, ...items] : items;
  return (
    <div className="cc-tape">
      <div className={`cc-tape-track ${scroll ? 'is-scrolling' : ''}`}
           style={scroll ? { animationDuration: `${Math.max(28, items.length * 4.5)}s` } : undefined}>
        {rendered.map((p, i) => (
          <span className="cc-tape-item" key={`${p._key}-${i}`}>
            <span className="cc-ticker-dot" style={{ color: dotColor(p.kind) }} />
            <span className="cc-tape-actor">{p.actor || 'someone'}</span>
            <span className="cc-tape-what">{placementText(p)}</span>
            <span className="cc-tape-time">{relativeTime(p.occurred_at)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// Ranked horizontal bars, direct-labelled. One hue: length is the magnitude
// and the label is the identity, so this never needs a legend and never runs
// out of distinguishable colours the way a 15-slice donut does.
function RankBar({ rows, total }) {
  if (!rows.length) return <div className="cc-rank-empty t-meta">No cards yet.</div>;
  const max = rows[0]?.value || 1;
  return (
    <div className="cc-rank">
      {rows.map((r) => (
        <div className="cc-rank-row" key={r.name}
             title={r.tail
               ? `${r.tail} — kinds too rare to list separately`
               : `${r.value.toLocaleString()} of ${total.toLocaleString()} cards`}>
          <span className="cc-rank-label">{r.name}</span>
          <span className="cc-rank-track">
            <span className="cc-rank-fill" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </span>
          <span className="cc-rank-n">{formatCompact(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

// Activation funnel as a labelled stage list rather than a bar chart. The tail
// stages are ~1% of the top, so on a shared linear axis their bars round to
// sub-pixel and the reader sees an empty row where a real number lives. Here
// every stage prints its count and its step conversion regardless of width.
function StageList({ stages }) {
  const top = stages[0]?.value || 0;
  if (!top) return <div className="cc-rank-empty t-meta">No signups in this window.</div>;
  return (
    <div className="cc-stagelist">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1].value : null;
        const step = prev ? safeRate(s.value, prev) : null;
        return (
          <div className="cc-stage-row" key={s.stage}
               title={`${formatCount(s.value)} of ${formatCount(top)} (${formatPct(s.value / top)} of signups)`}>
            <span className="cc-stage-name">{s.stage}</span>
            <span className="cc-stage-track">
              <span className="cc-stage-fill" style={{ width: `${Math.max(1.5, (s.value / top) * 100)}%` }} />
            </span>
            <span className="cc-stage-n">{formatCount(s.value)}</span>
            <span className="cc-stage-step">
              {step && !step.hide ? formatPct(step.rate) : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Big "always going up" duration.
//
// This used to integrate `max(activeNow, 1)` seconds per second and clamp
// itself monotonically upward with Math.max(base, serverValue) — so on a quiet
// night it invented a second per second, never corrected back down, and a wall
// left up for a day over-reported by as much as 86,400s.
//
// Now: it counts at the REAL measured rate (zero users → it holds still), and
// it can never run further ahead of the server than one poll interval's worth
// of the rate it was told. Each poll re-seats it on server truth in both
// directions.
function CountUpDuration({ value, ratePerSec, syncedAt }) {
  const [shown, setShown] = useState(() => Number(value) || 0);
  const ref = useRef({ base: Number(value) || 0, at: performance.now(), rate: 0, drift: 0 });

  // Each poll: seat on server truth (up OR down) and adopt the new rate.
  useEffect(() => {
    ref.current.base = Number(value) || 0;
    ref.current.rate = Math.max(0, Number(ratePerSec) || 0);
    ref.current.drift = 0;
    ref.current.at = performance.now();
  }, [value, ratePerSec, syncedAt]);

  // Integrate the rate over real time and repaint ~4x/s. dt is capped so a tab
  // that was hidden (rAF paused) doesn't surge on return, and the accumulated
  // drift is capped at one poll interval so this can never wander away from
  // the server figure even if a poll is missed.
  useEffect(() => {
    let raf = 0;
    let lastPaint = 0;
    const MAX_DRIFT_S = 30;   // the poll interval
    const loop = (t) => {
      const st = ref.current;
      const dt = Math.min((t - st.at) / 1000, 1.5);
      st.at = t;
      st.drift = Math.min(st.drift + st.rate * dt, st.rate * MAX_DRIFT_S);
      if (t - lastPaint >= 250) { lastPaint = t; setShown(st.base + st.drift); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

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

function UniCell({ label, value, delta, title }) {
  return (
    <div className="cc-uni-cell" title={title}>
      <div className="cc-uni-num">{formatCompact(value ?? 0)}</div>
      <div className="cc-uni-label">{label}</div>
      {delta > 0 && <div className="cc-uni-delta">+{formatCount(delta)} today</div>}
    </div>
  );
}
