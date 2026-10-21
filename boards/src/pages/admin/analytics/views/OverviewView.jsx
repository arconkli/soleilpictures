// OverviewView — Analytics › Overview, the daily check-in. Until 2026-10-20 this
// was "Today", under a top tab called Overview; the owner renamed the tab
// Analytics and this view Overview, because it is where the long-term graphs
// go too, not only the last seven days.
//
// Before this there were two Overviews. The top-level tab showed total users,
// MRR, a signups bar chart, a tier donut and a list of recent emails; the
// Analytics sub-view showed eight KPIs and the funnel. Both led with the same
// numbers, neither was authoritative, and NEITHER answered the question you
// actually open a dashboard with in the morning: does anything need me?
//
// So that question leads here, and it is the only block on the page that is
// about acting rather than knowing.
//
// MRR is on this screen from before the first subscription exists, by explicit
// decision. The argument against it was that a structurally-zero number reads
// as a measurement rather than an absence — which is true, and the reason the
// tile does NOT draw a sparkline or a delta while it is zero. What it draws
// instead is the reason it is zero, in words. The moment a subscription lands
// it becomes a normal metric with a trend, and nobody has to remember to add
// it back on the day it would first have mattered. A trial is not a paying
// subscription, and the sub-line says which one exists.
//
// The four tiles that count people and cards answer a second question as well:
// has this held its direction for WEEKS, or did one week move? One seven-day
// delta cannot say. Each of them carries a strip of complete UTC weeks and the
// sentence weeklyTrend() (lib/trendStats.js) reads off it; the week-over-week
// badge stays, demoted to the sub line. Below the tiles, the long-run band
// (widgets/GrowthBand.jsx) draws every week since the first account, one small
// chart per measure, beside what changed along the way.
//
// It is live (the owner's ask, 2026-10-21: the page as it is, live in place).
// The realtime stream the console draws is held here, once, and an event from
// someone signed in re-reads the figures it can move (useOverviewLive). Those
// figures roll to their new value, and one that rose says by how much for a
// few seconds; a new signup slides into Just arrived, a row whose work changed
// flashes, and this week's bars in the band grow. The five-minute read stays
// underneath as the backstop, and each figure shows whichever read is newer.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../../lib/supabase.js';
import { useAuth } from '../../../../auth/AuthGate.jsx';
import { formatCount, formatCompact, formatMoney, relativeTime, fmtDateTime } from '../../../../lib/adminFormat.js';
import { ALPHA_SOLID, DEFAULT_WINDOW, WEEKS_FETCHED, weekDelta, weeklyTrend } from '../../../../lib/trendStats.js';
import {
  WEEKLY_METRICS, breaksFor, mergeMarkers, toWeekPoints,
} from '../../../../lib/weeklySeries.js';
import { BEFORE_LAUNCH, RETURN_HORIZON_DAYS, RETURN_WEEKS } from '../../../../lib/growthSeries.js';
import { DEFINITION_BREAKS } from '../../../../lib/adminDefinitionBreaks.js';
import { CHANGELOG_ENTRIES } from '../../../../lib/changelogIndex.js';
import { undoToast } from '../../../../lib/undoToast.js';
import { isAdminPreviewMode } from '../../../../lib/localMode.js';
import { useFeedback } from '../../../../components/AppFeedback.jsx';
import { useAdminData } from '../../useAdminData.js';
import { useActivityPulse } from '../../useActivityPulse.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { useAnalyticsFilters, useRegisterViewRuntime, POLL_MS } from '../AnalyticsFiltersContext.jsx';
import { useOverviewLive, fresher, mergeWeeks } from '../useOverviewLive.js';
import { Metric, MetricGrid } from '../../viz/Metric.jsx';
import { Rolling } from '../../viz/Rolling.jsx';
import { Heatmap } from '../../viz/Heatmap.jsx';
import { EventConsole } from '../../viz/EventConsole.jsx';
import { Deck, Well, Plate } from '../../viz/Well.jsx';
import { VAR } from '../../viz/palette.js';
import { GrowthBand } from '../widgets/GrowthBand.jsx';
import { stalledSignups } from '../stalledSignups.js';

// The browser's zone, so the heatmap buckets by the hours the owner keeps
// rather than by UTC — which would smear a US-hours product diagonally across
// the grid and make the dead hours look busy.
const TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
})();

const num = (x) => (x == null || Number.isNaN(Number(x)) ? null : Number(x));

// How a trended tile reads, on hover. The window and the threshold come from the
// module that applies them, so the sentence cannot drift from the test.
const READ_HOW = 'Strip: one glyph per week, newest right. '
  + `Steady means the order of the last ${DEFAULT_WINDOW} complete weeks is non-random at `
  + `${Math.round(ALPHA_SOLID * 100)}% one-sided AND the move is larger than week-to-week noise; `
  + 'a perfectly ordered rise inside the noise reads "Leaning". '
  + 'Outlined glyph = still settling. Hatched = not measured.';

// DEV only: ?breaks=0 scores every series straight through its definition
// breaks, so the harness can show the read a cut withholds. Behind the literal
// guard, so a production build never reads the parameter.
function breaksOffInDev() {
  if (!import.meta.env.DEV) return false;
  try { return new URLSearchParams(window.location.search).get('breaks') === '0'; } catch { return false; }
}
const NO_BREAKS = [];

const byWeekStart = (a, b) => (a.week_start < b.week_start ? -1 : a.week_start > b.week_start ? 1 : 0);

// `RightNow` used to live here: a full-page-width panel holding one numeral and
// a 64px sparkline, which made it the sparsest thing on the densest screen. It
// measured the same stream the live console does, so it moved inside it — the
// numeral is now a readout in the console header.

/**
 * What someone who just arrived has made. admin_recent_signups (0460) counts
 * their own cards on live clusters, the cards they placed in someone else's
 * cluster, and the clusters they made, so an invitee who only ever worked in
 * the inviter's cluster no longer reads "nothing yet". first_card_at outlives
 * the cards, so "placed a card, none left" is someone who made one and then
 * deleted it, not someone who never started.
 */
function arrivedWhat(u) {
  const own = num(u.card_count) || 0;
  const guest = num(u.guest_cards) || 0;
  const made = num(u.clusters_made) || 0;
  const plural = (n, one, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;
  const parts = [];
  if (own > 0) parts.push(plural(own, 'card'));
  if (made > 0) parts.push(`${plural(made, 'cluster')} made`);
  if (guest > 0) parts.push(own > 0 ? `${formatCount(guest)} as a guest` : `${plural(guest, 'card')} in someone else's cluster`);
  if (parts.length) return { did: true, text: parts.join(' · ') };
  if (u.first_card_at) return { did: true, text: 'placed a card, none left' };
  return { did: false, text: 'nothing yet' };
}

/**
 * Which rows just changed, for the eye. Someone who was not on the list the last
 * time it was read slides in, and a row whose work changed (a first card, above
 * all) flashes. Nothing is marked on the first list or after a filter change:
 * that is a new list, not news. `gen` names the population, as useLiveRise's.
 */
function useArrivalMarks(users, gen) {
  const last = useRef({ gen: null, texts: null });
  const [marks, setMarks] = useState(() => new Map());
  useEffect(() => {
    const texts = new Map(users.map((u) => [u.user_id, arrivedWhat(u).text]));
    const p = last.current;
    last.current = { gen, texts };
    if (p.gen !== gen || !p.texts || p.texts.size === 0) return;
    const next = new Map();
    for (const [id, text] of texts) {
      if (!p.texts.has(id)) next.set(id, 'new');
      else if (p.texts.get(id) !== text) next.set(id, 'upd');
    }
    if (next.size) setMarks(next);
  }, [users, gen]);
  // The animations run 2.4s; the marks come off after them, so the next change
  // can put them back on.
  useEffect(() => {
    if (!marks.size) return undefined;
    const t = setTimeout(() => setMarks(new Map()), 2600);
    return () => clearTimeout(t);
  }, [marks]);
  return marks;
}

/** Who arrived, and whether they did anything once they got here. */
function WhoArrived({ users, gen }) {
  const marks = useArrivalMarks(users, gen);
  if (!users.length) return <div className="admin-empty">No signups yet.</div>;
  return (
    <div className="admin-people-list">
      {users.map((u) => {
        const { did, text } = arrivedWhat(u);
        const mark = marks.get(u.user_id);
        return (
          <div className={`admin-people-row${mark ? ` is-${mark}` : ''}`} key={u.user_id}>
            <span className={`admin-people-dot ${did ? 'is-did' : ''}`} aria-hidden="true" />
            <span className="admin-people-email" title={u.email}>{u.email}</span>
            {/* Keyed by its words, so a second change restarts the flash. */}
            <span className="admin-people-what" key={text}>{text}</span>
            <span className="admin-people-when" title={fmtDateTime(u.created_at)}>{relativeTime(u.created_at)}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Who signed up recently and has still never made a card.
 *
 * This is the actionable half of the person view. `admin_user_dormancy` has
 * carried `did_card` all along and nothing on the dashboard has ever read it.
 */
function WhoStalled({ rows }) {
  if (!rows.length) {
    return <div className="admin-empty">Everyone who signed up in the last two weeks has made something.</div>;
  }
  return (
    <div className="admin-people-list">
      {rows.map((r) => (
        <div className="admin-people-row" key={r.user_id}>
          <span className="admin-people-dot" aria-hidden="true" />
          <span className="admin-people-email" title={r.email}>{r.email}</span>
          <span className="admin-people-what">
            {r.active_day_count > 1
              ? `came back ${formatCount(r.active_day_count)}×, never made a card`
              : (r.active_day_count === 1 ? 'one visit, never made a card' : 'never opened the app')}
          </span>
          <span className="admin-people-when">
            {r.days_dormant != null ? `${formatCount(r.days_dormant)}d quiet` : `joined ${formatCount(r.signup_age)}d ago`}
          </span>
        </div>
      ))}
    </div>
  );
}

export function OverviewView() {
  const f = useAnalyticsFilters();
  const feedback = useFeedback();
  const { user } = useAuth();
  // The page's one realtime stream: the console draws it, and the live layer
  // listens to it. One hook, because Supabase hands two channels on the same
  // topic the same object (see useActivityPulse).
  const pulse = useActivityPulse({ minutes: 60 });
  const live = useOverviewLive({
    pulse, excludeInternal: f.excludeInternal, verifiedOnly: f.verifiedOnly, viewerId: user?.id ?? null,
  });
  // The population every live figure counts. A change of it is a new baseline,
  // never a rise (Metric's useLiveRise, useArrivalMarks).
  const liveGen = `${f.excludeInternal ? 'ex' : 'in'}-${f.verifiedOnly ? 'ver' : 'all'}`;

  const q = useAdminData(async () => {
    // When this read began: a note change answered after it may be missing from
    // the markers it brings back (see the notes below).
    const startedAt = Date.now();
    const [kpi, hist, wk, mk, active, dorm, users, life, heat] = await Promise.allSettled([
      // The headline figures, and the only call the view cannot do without. It
      // also carries work_users: presence and work are different things (a day
      // in the app often holds no work event at all), so "Did real work" is its
      // own count rather than "Weekly active" again.
      supabase.rpc('admin_kpi_summary', { p_days: 7, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_metrics_history', { p_days: 60 }),
      // Thirteen complete UTC weeks and this one so far, oldest first: every
      // strip, verdict and tile spark. The same population flags as the
      // headline figures, so a tile's number and its strip count the same
      // people. The long-run band reads its own series, below.
      supabase.rpc('admin_weekly_series', { p_weeks: WEEKS_FETCHED, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      // The owner's notes and the pipeline alerts, back to the first week: the
      // band can show every week since launch, and the read's own default stops
      // at 120 days. Releases and definition breaks are repo facts, merged in
      // below rather than fetched.
      supabase.rpc('admin_markers', { p_since: BEFORE_LAUNCH }),
      // Follows the Internal toggle (0460). It used to count the team always,
      // the admin reading it included.
      supabase.rpc('admin_active_now', { p_window_minutes: 5, p_exclude_internal: f.excludeInternal }),
      supabase.rpc('admin_user_dormancy', { p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      // The newest signups under both toggles, with the work they did anywhere
      // (0460). admin_list_users ignored the toggles and counted only cards on
      // the person's own clusters.
      supabase.rpc('admin_recent_signups', { p_limit: 20, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      // Lifetime scale. Every window figure on this screen is paired with one of
      // these: a total on its own only ever goes up, so it cannot tell you
      // anything is wrong, but beside "this week" it gives the week a size.
      // It follows both toggles (0460); admin_universe_stats, which this read
      // before, counts the team, so under "Internal: excluded" the totals here
      // disagreed with every window figure beside them.
      supabase.rpc('admin_lifetime_totals', { p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      // The chart worth looking at rather than reading.
      supabase.rpc('admin_activity_heatmap', { p_days: 30, p_tz: TZ, p_exclude_internal: f.excludeInternal }),
    ]);

    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;

    // Only the headline numbers gate the view; everything else degrades in
    // place rather than blanking the morning check-in.
    if (kpi.status !== 'fulfilled' || kpi.value.error) throw errOf(kpi) || new Error('Failed to load the overview');

    return {
      startedAt,
      kpi: val(kpi),
      history: val(hist) || [],
      // Both stay null, not [], when their call failed. A failed read is not a
      // short history: it must never print "Too few weeks (0 of 4)" or "0
      // complete", and it must not empty the notes list either.
      weekly: val(wk),
      markers: val(mk),
      activeNow: val(active),
      users: val(users) || [],
      lifetime: val(life) || null,
      heatmap: val(heat) || [],
      // By signup age, never-opened accounts included: see stalledSignups.js.
      stalled: stalledSignups(val(dorm) || []),
    };
  }, [f.excludeInternal, f.verifiedOnly],
     { pollIntervalMs: POLL_MS.overview, refetchOnFocus: true });

  // The long-run band: one row per UTC week since the first account (0460), and
  // week-one return by week of first visit (0322's week rows, as far back as the
  // read reaches). A read of its own so it never holds up the tiles above it,
  // and so a failure blanks the band and nothing else. The same population
  // flags as everything on the page.
  const g = useAdminData(async () => {
    const startedAt = Date.now();
    const [growth, returns] = await Promise.allSettled([
      supabase.rpc('admin_growth_series', { p_weeks: 104, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_return_fixed_horizon', {
        p_since: BEFORE_LAUNCH,
        p_horizon_days: RETURN_HORIZON_DAYS,
        p_exclude_internal: f.excludeInternal,
        p_verified_only: f.verifiedOnly,
        p_weeks: RETURN_WEEKS,
      }),
    ]);
    const ok = (r) => r.status === 'fulfilled' && !r.value.error;
    if (!ok(growth)) {
      throw (growth.status === 'rejected' ? growth.reason : growth.value.error) || new Error('Failed to load the weekly series');
    }
    // null, not [], when the return read failed: the band then says it did not
    // load instead of drawing every week as nobody.
    return { startedAt, growth: growth.value.data, returns: ok(returns) ? returns.value.data : null };
  }, [f.excludeInternal, f.verifiedOnly],
     { pollIntervalMs: POLL_MS.overview, refetchOnFocus: true });

  // Each figure from whichever read began later: the backstop's, or the live
  // one an event set off. The weekly strips, the heatmap, the markers and the
  // history are the backstop's alone.
  const d0 = q.data;
  const d = useMemo(() => {
    if (!d0) return d0;
    const at = d0.startedAt;
    const dorm = live.dormancy;
    return {
      ...d0,
      kpi: fresher(live, 'kpi', d0.kpi, at),
      lifetime: fresher(live, 'lifetime', d0.lifetime, at),
      users: fresher(live, 'users', d0.users, at) || [],
      activeNow: fresher(live, 'activeNow', d0.activeNow, at),
      stalled: dorm && dorm.value !== undefined && (at == null || dorm.at > at)
        ? stalledSignups(dorm.value || []) : d0.stalled,
    };
  }, [d0, live]);
  // This week's row of the band, from the live read, while it is the newer one.
  const growthData = useMemo(() => {
    const L = live.growth;
    if (!g.data || !L || L.at <= (g.data.startedAt ?? 0)) return g.data;
    return { ...g.data, growth: mergeWeeks(g.data.growth, L.value) };
  }, [g.data, live.growth]);
  const band = growthData === g.data ? g : { ...g, data: growthData };
  const cur = d?.kpi?.current || {};
  const prev = d?.kpi?.previous || {};
  const life = d?.lifetime || {};
  const lifeN = (k) => num(life[k]);
  const wau = num(cur.wau);
  // null, not 0, when the figure is missing. A hard zero here would say "nobody
  // did anything this week" when what happened is that we did not find out —
  // the same class of lie as the flat-zero waitlist funnel.
  const workUsers = num(cur.work_users);

  // ── The weekly read ─────────────────────────────────────────────────────
  // false while loading and when admin_weekly_series failed. The tiles then make
  // no weekly claim at all: no strip, no verdict, no spark and no WEEKS in the
  // status strip. (The band below reads its own series.)
  const weeklyRead = Array.isArray(d?.weekly);
  // Oldest first, as the RPC sends them, and sorted anyway: the strips and the
  // sparks are positional, so a row out of order would draw one week in
  // another's place.
  const rows = useMemo(() => (Array.isArray(d?.weekly) ? d.weekly : [])
    .filter((r) => r && typeof r.week_start === 'string')
    .sort(byWeekStart), [d?.weekly]);
  const completeWeeks = weeklyRead ? rows.filter((r) => r.complete).length : null;

  const now = new Date();
  const todayUtc = now.toISOString().slice(0, 10);
  // Days of this UTC week so far, Monday 1 to Sunday 7: how much of the week the
  // hollow point at the right of each chart has counted.
  const partialDays = ((now.getUTCDay() + 6) % 7) + 1;

  // The breaks each series is cut at. The preview harness scores against its own
  // list, placed relative to this week (local/adminFixtures.js), so the state a
  // tile shows there never depends on the date. Imported dynamically under the
  // literal DEV guard, so the fixtures never reach a production chunk; until it
  // arrives the harness reads the real list.
  const [breakList, setBreakList] = useState(() => (breaksOffInDev() ? NO_BREAKS : DEFINITION_BREAKS));
  useEffect(() => {
    if (import.meta.env.DEV && isAdminPreviewMode() && !breaksOffInDev()) {
      let live = true;
      import('../../../../local/adminFixtures.js').then((m) => { if (live) setBreakList(m.HARNESS_BREAKS); });
      return () => { live = false; };
    }
    return undefined;
  }, []);

  const trends = useMemo(() => (weeklyRead
    ? Object.fromEntries(WEEKLY_METRICS.map((m) => [
      m.key,
      weeklyTrend(toWeekPoints(rows, m), { breaks: breaksFor(m.col, breakList), dispersion: m.dispersion }),
    ]))
    : null), [weeklyRead, rows, breakList]);

  // A tile's spark draws the weeks its strip reads: complete (the week so far
  // would draw a collapse every Monday), measured (a week nothing was recording
  // is not a zero), and on this side of the metric's latest definition cut (a
  // week before it measured something else). Under "Too few weeks" there is no
  // spark either, so the picture never says more than the sentence; the work
  // tile's proportion bar stands in, which is true.
  const sparks = useMemo(() => Object.fromEntries(WEEKLY_METRICS.map((m) => {
    if (!trends || trends[m.key]?.verdict?.code === 'too_few') return [m.key, null];
    const cut = breaksFor(m.col, breakList).at(-1)?.week;
    const values = rows
      .filter((r) => r.complete && (!m.measurableCol || r[m.measurableCol]) && (!cut || r.week_start >= cut))
      .map((r) => num(r[m.col]))
      .filter((v) => v != null);
    return [m.key, values.length ? values : null];
  })), [trends, rows, breakList]);

  const status = useMemo(() => ({ weeks: completeWeeks, partialDays }), [completeWeeks, partialDays]);
  // The toolbar's one refresh re-reads both: the band is on this page too.
  const refreshQ = q.refresh;
  const refreshG = g.refresh;
  const refresh = useCallback(() => { refreshQ(); refreshG(); }, [refreshQ, refreshG]);
  useRegisterViewRuntime({
    refresh, lastUpdated: q.lastUpdated, refreshing: q.refreshing || g.refreshing, status, stream: pulse.status,
  });

  // ── Markers, and the owner's notes ──────────────────────────────────────
  // Notes are local state so an add or a remove shows at once. They are seeded
  // from each fetch's list, and only when a fetch brings a new one (its identity
  // changes once per fetch, never per render), so a render cannot wind back a
  // change. A poll can: one that began before a change was answered may not
  // carry it, and lands after it. So every change is also kept in `pending` and
  // replayed over each list, until a list from a read that began after the
  // change was answered (`at`; Infinity while it is still out) has been seeded.
  // Every change is idempotent, so replaying one the list already shows is free.
  // A read whose markers call failed re-seeds nothing: the notes keep the list
  // they have, and the changes still pending wait for a read that worked.
  const fetchedMarkers = d?.markers;
  const fetchedAt = d?.startedAt;
  const pending = useRef([]);
  const [notes, setNotes] = useState([]);
  useEffect(() => {
    if (!Array.isArray(fetchedMarkers)) return;
    if (fetchedAt != null) pending.current = pending.current.filter((op) => op.at > fetchedAt);
    const listed = fetchedMarkers.filter((m) => m?.source === 'note');
    setNotes(pending.current.reduce((n, op) => op.apply(n), listed));
  }, [fetchedMarkers, fetchedAt]);
  const alerts = useMemo(
    () => (Array.isArray(fetchedMarkers) ? fetchedMarkers.filter((m) => m?.source !== 'note') : []),
    [fetchedMarkers],
  );
  // Every marker since the first week. The band keeps the ones in the weeks it
  // shows, and draws each only on the charts it is about (lib/growthSeries.js).
  const mergedMarkers = useMemo(() => mergeMarkers({
    rpc: [...alerts, ...notes],
    changelog: CHANGELOG_ENTRIES,
    breaks: DEFINITION_BREAKS,
    from: BEFORE_LAUNCH,
    to: todayUtc,
  }), [alerts, notes, todayUtc]);

  // A change to the notes: shown now, and kept for replay (above).
  const change = (apply, at = Infinity) => {
    const op = { apply, at };
    pending.current.push(op);
    setNotes(apply);
    return op;
  };
  const withNote = (note) => (n) => [note, ...n.filter((x) => x.ref_id !== note.ref_id)];
  const withoutNote = (id) => (n) => n.filter((x) => x.ref_id !== id);

  // Requests in flight, counted: an undo can land while an add is still out.
  const [inFlight, setInFlight] = useState(0);
  const track = (n) => setInFlight((k) => k + n);

  async function addNote(day, label, kind) {
    track(1);
    try {
      const { data, error } = await supabase.rpc('admin_note_add', { p_day: day, p_label: label, p_kind: kind });
      if (error || !data) {
        feedback.toast({ type: 'error', message: error?.message ? `Note not added · ${error.message}` : 'Note not added' });
        return false;
      }
      change(withNote({ day: data.day, kind: data.kind, label: data.label, source: 'note', ref_id: data.id }), Date.now());
      return true;
    } finally {
      track(-1);
    }
  }

  async function removeNote(row) {
    const id = row?.ref_id;
    if (id == null) return;
    const note = { day: row.day, kind: row.kind, label: row.label, source: 'note', ref_id: id };
    // Off the list at once; back on it only if the call failed.
    const gone = change(withoutNote(id));
    track(1);
    try {
      let data;
      let error;
      // The call resolves with { error } when it fails. A rejection takes the same
      // path: left to throw, it kept the note off the list, its change replaying
      // over every later list, and said nothing.
      try {
        ({ data, error } = await supabase.rpc('admin_note_delete', { p_id: id }));
      } catch (thrown) {
        error = thrown || {};
      }
      if (error) {
        pending.current = pending.current.filter((op) => op !== gone);
        setNotes(withNote(note));
        feedback.toast({ type: 'error', message: error.message ? `Note not removed · ${error.message}` : 'Note not removed' });
        return;
      }
      gone.at = Date.now();
      // false: no live note had this id, so it was removed elsewhere first (another
      // tab, another admin). It stays off the list, and there is nothing to undo.
      if (data === false) {
        feedback.toast({ type: 'info', message: 'Already removed' });
        return;
      }
    } finally {
      track(-1);
    }
    // A soft delete, so the undo restores the same row, id and all.
    undoToast(feedback, {
      message: `Note removed · ${note.label}`,
      onUndo: async () => {
        track(1);
        try {
          let data;
          let error;
          // A rejection is a failed undo too, not a silent one.
          try {
            ({ data, error } = await supabase.rpc('admin_note_restore', { p_id: id }));
          } catch (thrown) {
            error = thrown || {};
          }
          if (error || !data) {
            feedback.toast({ type: 'error', message: 'Undo failed' });
            return;
          }
          change(withNote(note), Date.now());
        } finally {
          track(-1);
        }
      },
    });
  }

  // MRR rides admin_stats, which the shell already fetches for every view —
  // no extra call. The prior value comes off the same metrics_daily series the
  // sparkline uses, so the badge and the line can never disagree.
  const mrrCents = num(f.stats?.mrr_cents);
  // ACTIVE SUBSCRIPTIONS, not tier='paid'. The paid tier also holds comped
  // accounts, so reading tier_counts here counted comps as paying accounts
  // beside an MRR that did not include them. Anything that claims to count
  // payers has to count the thing that charges.
  const payingUsers = num(f.stats?.sub_counts?.active) || 0;
  const compedUsers = num(f.stats?.comped_paid) || 0;
  // The free tier, from the same admin_stats the shell already fetched. A bare
  // count of demo accounts would be a vanity number — it only rises — so the
  // tile leads with the population and qualifies it with how much of that
  // population is actually near the moment the free tier converts.
  const demoUsers = num(f.stats?.demo_users) ?? 0;
  const demosNearCap = num(f.stats?.demos_near_cap) ?? 0;
  const demosTrialEligible = num(f.stats?.demos_trial_eligible) ?? 0;
  // The paid funnel in one box: who is eligible, who is inside a trial right
  // now, who is actually paying. All of it reads zero until the first trial
  // starts, which is the honest state and not a broken panel.
  const trialingNow = num(f.stats?.trialing_subs) ?? 0;
  const trialsStarted = num(f.stats?.trials_started) ?? 0;
  const trialsConverted = num(f.stats?.trials_converted) ?? 0;
  const arpu = mrrCents != null && payingUsers > 0 ? mrrCents / payingUsers : null;
  const mrrPrev = (() => {
    const h = d?.history || [];
    for (let i = h.length - 2; i >= 0; i--) {
      const v = num(h[i]?.mrr_cents);
      if (v != null) return v;
    }
    return null;
  })();

  return (
    <AdminAsync
      loading={q.loading}
      error={q.error}
      hasData={q.hasData}
      onRetry={q.refresh}
      skeleton={<><AdminSkeleton variant="cards" rows={4} /><div style={{ height: 16 }} /><AdminSkeleton variant="chart" /></>}
    >
      <div className="adm-view">
        {/* Sparkline hue follows the metric's FAMILY — acquisition, engagement,
            output — rather than being four decorative colours. Three hues for
            three families is the most colour this palette can carry honestly:
            a fourth categorical hue does not survive the contrast and
            colour-blindness floors (see viz/palette.js). */}
        <h2 className="admin-section-title">The last seven days</h2>
        {/* The primary readout goes on the plot ground with everything else.
            The tiles were the last part of the page still floating on the bare
            surface, which made the top of the screen read as a document header
            with instruments below it rather than as one console. */}
        <Deck>
        <Well
          span={12}
          className="adm-rail"
          foot={lifeN('users') != null ? (
            /* Everything the platform has accumulated, on one line. Kept out of
               the tiles because a total that only ever rises cannot tell you
               anything is wrong — it is scale, not a signal, and now it reads
               as the rail's footer rather than as five more metrics.

               These are what exists NOW: an account or a card that was deleted
               is gone from them, which is why Accounts is not "signups ever".
               Clusters are the ones people made; the Studio every workspace is
               born with sits beside them, not inside. */
            <dl className="admin-lifetime">
              <div><dt>Accounts</dt><dd><Rolling text={formatCount(lifeN('users'))} /></dd></div>
              <div>
                <dt>Clusters made</dt>
                <dd>
                  <Rolling text={formatCount(lifeN('clusters_made'))} />
                  {lifeN('studios') > 0 && <small>+{formatCount(lifeN('studios'))} Studios</small>}
                </dd>
              </div>
              <div><dt>Cards</dt><dd><Rolling text={formatCount(lifeN('cards'))} /></dd></div>
              <div><dt>Workspaces</dt><dd><Rolling text={formatCount(lifeN('workspaces'))} /></dd></div>
              <div>
                <dt>Time in app</dt>
                <dd>{lifeN('seconds_in_app') != null
                  ? <Rolling text={`${formatCount(Math.round(lifeN('seconds_in_app') / 3600))}h`} /> : '—'}</dd>
              </div>
              <div className="admin-lifetime-scope">
                totals now · {f.excludeInternal ? 'team excluded' : 'incl. team'} · {f.verifiedOnly ? 'entered the code' : 'all accounts'}
              </div>
            </dl>
          ) : null}
        >
        <MetricGrid hero>
          <Metric
            hero
            roll
            live={num(cur.signups)}
            liveGen={liveGen}
            label="Signups"
            value={cur.signups != null ? formatCount(cur.signups) : null}
            sub="new accounts"
            total={lifeN('users') != null
              ? { value: formatCount(lifeN('users')), label: 'accounts' } : null}
            delta={weekDelta(num(cur.signups), num(prev.signups))}
            trend={trends?.signups ?? null}
            spark={sparks.signups}
            sparkColor={VAR.cat[0]}   /* acquisition */
            title={trends ? READ_HOW : undefined}
          />
          <Metric
            hero
            roll
            live={wau}
            liveGen={liveGen}
            label="Weekly active"
            value={wau != null ? formatCount(wau) : null}
            sub="opened the app"
            total={lifeN('users') != null && wau != null
              ? { value: formatCount(lifeN('users')), label: 'accounts' } : null}
            delta={weekDelta(wau, num(prev.wau))}
            trend={trends?.active ?? null}
            spark={sparks.active}
            sparkColor={VAR.cat[1]}   /* engagement */
            title={trends ? READ_HOW : undefined}
          />
          <Metric
            hero
            roll
            live={workUsers}
            liveGen={liveGen}
            label="Did real work"
            value={workUsers != null ? formatCount(workUsers) : null}
            sub="placed, edited or shared something"
            total={workUsers != null && wau
              ? { value: formatCount(wau), label: 'were here' } : null}
            // The proportion bar stands in for a spark only while there is no
            // measured week to draw one from.
            ratio={!sparks.work && workUsers != null && wau
              ? { pct: workUsers / Math.max(1, wau),
                  title: `${formatCount(workUsers)} of ${formatCount(wau)} weekly actives did real work` }
              : null}
            trend={trends?.work ?? null}
            spark={sparks.work}
            sparkColor={VAR.cat[1]}
            title={`People with a work event in the last 7 days, not everyone who opened the app.${trends ? ` ${READ_HOW}` : ''}`}
          />
          <Metric
            hero
            roll
            label="Trials"
            value={formatCount(trialingNow)}
            sub={`${formatCount(payingUsers)} paying · ${formatCount(demosTrialEligible)} eligible`}
            muted={trialingNow === 0}
            total={{ value: formatCount(demosNearCap), label: 'near the cap' }}
            ratio={trialsStarted > 0
              ? { pct: trialsConverted / trialsStarted,
                  title: `${formatCount(trialsConverted)} of ${formatCount(trialsStarted)} trials went on to pay` }
              : null}
            sparkColor={VAR.cat[1]}
            title={`People inside a Creator trial right now${trialsStarted > 0 ? ` · ${formatCount(trialsStarted)} started, ${formatCount(trialsConverted)} converted` : ''}. "Paying" counts subscriptions that are actually charging, so a trial in flight and a complimentary grant are both excluded${compedUsers > 0 ? ` (${formatCount(compedUsers)} comped)` : ''}. "Eligible" is the free accounts the server would offer a trial to on their next visit; "near the cap" is anyone holding at least 80% of THEIR cap, which is per-user, out of ${formatCount(demoUsers)} free accounts.`}
          />
          <Metric
            hero
            roll
            label="MRR"
            value={mrrCents == null ? null : formatMoney(mrrCents)}
            sub={payingUsers > 0
              ? `${formatCount(payingUsers)} paying ${payingUsers === 1 ? 'account' : 'accounts'}`
              : `No paying subscription yet${trialingNow > 0 ? ` · ${formatCount(trialingNow)} in trial` : ''}`}
            muted={!(mrrCents > 0)}
            total={payingUsers > 0 && arpu != null
              ? { value: formatMoney(arpu), label: 'per account' } : null}
            delta={mrrCents > 0 ? weekDelta(mrrCents, mrrPrev, { kind: 'exact' }) : null}
            spark={mrrCents > 0 ? (d?.history || []).map((r) => num(r.mrr_cents) || 0) : null}
            sparkColor={VAR.cat[1]}
            title={mrrCents > 0
              ? 'Live monthly recurring revenue from ACTIVE subscriptions only. A trial carries the full list price and has collected nothing, so it is counted in Trials and never here.'
              : `No subscription has ever charged, so this is zero by absence rather than by measurement. It gets a trend line and a change badge as soon as there is something to trend.${trialingNow > 0 ? ' A trial in flight carries the list price and has collected nothing, so it is counted under Trials, not here.' : ''}`}
          />
          <Metric
            hero
            roll
            live={num(cur.cards_created)}
            liveGen={liveGen}
            label="Cards created"
            value={cur.cards_created != null ? formatCompact(cur.cards_created) : null}
            sub="across every cluster"
            total={lifeN('cards') != null
              ? { value: formatCompact(lifeN('cards')), label: 'exist now' } : null}
            delta={weekDelta(num(cur.cards_created), num(prev.cards_created))}
            trend={trends?.cards ?? null}
            spark={sparks.cards}
            sparkColor={VAR.cat[2]}   /* output */
            title={trends ? READ_HOW : undefined}
          />
        </MetricGrid>
        </Well>
        </Deck>

        {/* The long run, and what changed along the way: every week since the
            first account, or the last thirteen, one small chart per measure on
            one calendar, with the markers list beside them because a step in a
            line needs its explanation within reach. It is also where the owner
            pins a note. */}
        <GrowthBand
          query={band}
          liveGen={liveGen}
          markers={mergedMarkers}
          breaks={DEFINITION_BREAKS}
          cutBreaks={breakList}
          onAdd={addNote}
          onRemove={removeNote}
          busy={inFlight > 0}
          todayUtc={todayUtc}
        />

        <h2 className="admin-section-title">When people are here, and what is happening now</h2>
        <Deck>
          <Well
            span={8}
            flush
            title="Activity by weekday and hour"
            meta="30d of events, folded onto one week, your timezone"
            foot="Daily totals are too small to have a shape. A month of them stacked on a week is."
          >
            <Heatmap
              markNow
              cells={d?.heatmap || []}
              formatValue={(v) => `${formatCount(v)} event${v === 1 ? '' : 's'}`}
            />
          </Well>

          <Well span={4} flush title="Live" meta="pushed, not polled">
            <EventConsole pulse={pulse} activeNow={d?.activeNow} minutes={60} excludeInternal={f.excludeInternal} />
          </Well>
        </Deck>

        <h2 className="admin-section-title">People</h2>
        <div className="admin-section-sub">
          At this volume the individuals are legible, so read them rather than an average.
        </div>
        <Deck>
          <Plate span={6} title="Just arrived" meta={`newest ${d?.users?.length || 0}`}>
            <WhoArrived users={d?.users || []} gen={liveGen} />
          </Plate>
          <Plate span={6} title="Arrived and stalled"
                 meta={`signed up ≤14d ago, no card ever${d?.stalled?.total > (d?.stalled?.rows?.length || 0) ? ` · ${formatCount(d.stalled.rows.length)} of ${formatCount(d.stalled.total)}` : ''}`}>
            <WhoStalled rows={d?.stalled?.rows || []} />
          </Plate>
        </Deck>
      </div>
    </AdminAsync>
  );
}
