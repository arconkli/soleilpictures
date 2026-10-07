// TodayView — the daily check-in, and the view that did not exist.
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
// Two deliberate omissions:
//
//   * No MRR tile. No subscription has ever existed, so it is structurally
//     zero — and this codebase already learned (see the header of the old
//     AdminOverviewTab, and AdminCommandCenter) that a permanent flat zero
//     reads as a measurement rather than an absence. A number that cannot move
//     does not earn the top of the screen.
//
// MRR is on this screen from before the first subscription exists, by explicit
// decision. The argument against it was that a structurally-zero number reads
// as a measurement rather than an absence — which is true, and the reason the
// tile does NOT draw a sparkline or a delta while it is zero. What it draws
// instead is the reason it is zero, in words. The moment a subscription lands
// it becomes a normal metric with a trend, and nobody has to remember to add
// it back on the day it would first have mattered.
//
// The four tiles that count people and cards answer a second question as well:
// has this held its direction for WEEKS, or did one week move? One seven-day
// delta cannot say. Each of them carries a strip of complete UTC weeks and the
// sentence weeklyTrend() (lib/trendStats.js) reads off it; the week-over-week
// badge stays, demoted to the sub line. The thirteen weeks behind those strips
// are drawn in the band below, beside what changed along the way.

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../../../lib/supabase.js';
import { formatCount, formatCompact, formatMoney, relativeTime, fmtDateTime } from '../../../../lib/adminFormat.js';
import { ALPHA_SOLID, DEFAULT_WINDOW, weekDelta, weeklyTrend } from '../../../../lib/trendStats.js';
import {
  WEEKLY_METRICS, addDays, breaksFor, mergeMarkers, mondayOf, toWeekPoints,
} from '../../../../lib/weeklySeries.js';
import { DEFINITION_BREAKS } from '../../../../lib/adminDefinitionBreaks.js';
import { CHANGELOG_ENTRIES } from '../../../../lib/changelogIndex.js';
import { undoToast } from '../../../../lib/undoToast.js';
import { isAdminPreviewMode } from '../../../../lib/localMode.js';
import { useFeedback } from '../../../../components/AppFeedback.jsx';
import { useAdminData } from '../../useAdminData.js';
import { AdminAsync, AdminSkeleton } from '../../AdminStates.jsx';
import { useAnalyticsFilters, useRegisterViewRuntime, POLL_MS } from '../AnalyticsFiltersContext.jsx';
import { Metric, MetricGrid } from '../../viz/Metric.jsx';
import { Heatmap } from '../../viz/Heatmap.jsx';
import { EventConsole } from '../../viz/EventConsole.jsx';
import { Deck, Well, Plate } from '../../viz/Well.jsx';
import { VAR } from '../../viz/palette.js';
import { WeeklyMultiples } from '../widgets/WeeklyMultiples.jsx';
import { MarkersPanel } from '../widgets/MarkersPanel.jsx';

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

/** Who arrived, and whether they did anything once they got here. */
function WhoArrived({ users }) {
  if (!users.length) return <div className="admin-empty">No signups yet.</div>;
  return (
    <div className="admin-people-list">
      {users.map((u) => {
        const cards = num(u.card_count) || 0;
        const boards = num(u.board_count) || 0;
        const did = cards > 0;
        return (
          <div className="admin-people-row" key={u.user_id}>
            <span className={`admin-people-dot ${did ? 'is-did' : ''}`} aria-hidden="true" />
            <span className="admin-people-email" title={u.email}>{u.email}</span>
            <span className="admin-people-what">
              {did
                ? `${formatCount(cards)} card${cards === 1 ? '' : 's'} · ${formatCount(boards)} cluster${boards === 1 ? '' : 's'}`
                : 'nothing yet'}
            </span>
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
              : 'one visit, never made a card'}
          </span>
          <span className="admin-people-when">{formatCount(r.days_dormant)}d quiet</span>
        </div>
      ))}
    </div>
  );
}

export function TodayView() {
  const f = useAnalyticsFilters();
  const feedback = useFeedback();

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
      // strip, verdict and tile spark, and the stack in band 02. The same
      // population flags as the headline figures, so a tile's number and its
      // strip count the same people.
      supabase.rpc('admin_weekly_series', { p_weeks: 14, p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      // The owner's notes and the pipeline alerts. Releases and definition
      // breaks are repo facts, merged in below rather than fetched.
      supabase.rpc('admin_markers'),
      supabase.rpc('admin_active_now', { p_window_minutes: 5 }),
      supabase.rpc('admin_user_dormancy', { p_exclude_internal: f.excludeInternal, p_verified_only: f.verifiedOnly }),
      supabase.rpc('admin_list_users', { p_limit: 8, p_offset: 0 }),
      // Lifetime scale, straight off platform_counters. Every window figure on
      // this screen is paired with one of these: a total on its own only ever
      // goes up, so it cannot tell you anything is wrong, but beside "this
      // week" it gives the week a size.
      supabase.rpc('admin_universe_stats'),
      // The chart worth looking at rather than reading.
      supabase.rpc('admin_activity_heatmap', { p_days: 30, p_tz: TZ, p_exclude_internal: f.excludeInternal }),
    ]);

    const val = (r) => (r.status === 'fulfilled' && !r.value.error ? r.value.data : null);
    const errOf = (r) => (r.status === 'rejected' ? r.reason : r.value?.error) || null;

    // Only the headline numbers gate the view; everything else degrades in
    // place rather than blanking the morning check-in.
    if (kpi.status !== 'fulfilled' || kpi.value.error) throw errOf(kpi) || new Error('Failed to load today');

    return {
      startedAt,
      kpi: val(kpi),
      history: val(hist) || [],
      weekly: val(wk) || [],
      markers: val(mk) || [],
      activeNow: val(active),
      users: val(users) || [],
      lifetime: val(life) || null,
      heatmap: val(heat) || [],
      stalled: (val(dorm) || [])
        .filter((r) => !r.did_card && (num(r.days_dormant) ?? 999) <= 14)
        .sort((a, b) => (num(b.active_day_count) || 0) - (num(a.active_day_count) || 0))
        .slice(0, 6),
    };
  }, [f.excludeInternal, f.verifiedOnly],
     { pollIntervalMs: POLL_MS.today, refetchOnFocus: true });

  const d = q.data;
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
  // Oldest first, as the RPC sends them, and sorted anyway: the strips, the
  // sparks and the stack are all positional, so a row out of order would draw
  // one week in another's place.
  const rows = useMemo(() => (Array.isArray(d?.weekly) ? d.weekly : [])
    .filter((r) => r && typeof r.week_start === 'string')
    .sort(byWeekStart), [d?.weekly]);
  const weeks = useMemo(() => rows.map((r) => r.week_start), [rows]);
  // null until there is data, so the status strip never says "0 complete" while loading.
  const completeWeeks = d ? rows.filter((r) => r.complete).length : null;

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

  const trends = useMemo(() => Object.fromEntries(WEEKLY_METRICS.map((m) => [
    m.key,
    weeklyTrend(toWeekPoints(rows, m), { breaks: breaksFor(m.col, breakList), dispersion: m.dispersion }),
  ])), [rows, breakList]);

  // A tile's spark is its complete weeks, the ones its strip reads: the week so
  // far would draw a collapse every Monday. A week nothing was recording is left
  // out rather than drawn as a zero; with nothing left there is no spark.
  const sparks = useMemo(() => {
    const complete = rows.filter((r) => r.complete);
    return Object.fromEntries(WEEKLY_METRICS.map((m) => {
      const values = complete
        .filter((r) => !m.measurableCol || r[m.measurableCol])
        .map((r) => num(r[m.col]))
        .filter((v) => v != null);
      return [m.key, values.length ? values : null];
    }));
  }, [rows]);

  // One row per WEEKLY_METRICS entry, keyed by its key: that is how the stack
  // knows which column a definition break is about.
  const stackSeries = useMemo(() => WEEKLY_METRICS.map((m) => ({
    key: m.key,
    name: m.label,
    color: VAR.cat[m.family],
    values: rows.map((r) => r[m.col]),
    measurable: rows.map((r) => (m.measurableCol ? !!r[m.measurableCol] : true)),
  })), [rows]);

  const status = useMemo(() => ({ weeks: completeWeeks, partialDays }), [completeWeeks, partialDays]);
  useRegisterViewRuntime({ refresh: q.refresh, lastUpdated: q.lastUpdated, refreshing: q.refreshing, status });

  // ── Markers, and the owner's notes ──────────────────────────────────────
  // Notes are local state so an add or a remove shows at once. They are seeded
  // from each fetch's list, and only when a fetch brings a new one (its identity
  // changes once per fetch, never per render), so a render cannot wind back a
  // change. A poll can: one that began before a change was answered may not
  // carry it, and lands after it. So every change is also kept in `pending` and
  // replayed over each list, until a list from a read that began after the
  // change was answered (`at`; Infinity while it is still out) has been seeded.
  // Every change is idempotent, so replaying one the list already shows is free.
  const fetchedMarkers = d?.markers;
  const fetchedAt = d?.startedAt;
  const pending = useRef([]);
  const [notes, setNotes] = useState([]);
  useEffect(() => {
    if (fetchedAt != null) pending.current = pending.current.filter((op) => op.at > fetchedAt);
    const listed = Array.isArray(fetchedMarkers) ? fetchedMarkers.filter((m) => m?.source === 'note') : [];
    setNotes(pending.current.reduce((n, op) => op.apply(n), listed));
  }, [fetchedMarkers, fetchedAt]);
  const alerts = useMemo(
    () => (Array.isArray(fetchedMarkers) ? fetchedMarkers.filter((m) => m?.source !== 'note') : []),
    [fetchedMarkers],
  );
  // The window the stack draws. Without a weekly series, the same thirteen weeks
  // counted back from this Monday, so the list never runs back to the first release.
  const windowFrom = weeks[0] ?? addDays(mondayOf(todayUtc), -7 * 13);
  // Everything in the window. The list shows all of it; the stack draws each
  // marker only on the charts it is about (WeeklyMultiples).
  const mergedMarkers = useMemo(() => mergeMarkers({
    rpc: [...alerts, ...notes],
    changelog: CHANGELOG_ENTRIES,
    breaks: DEFINITION_BREAKS,
    from: windowFrom,
    to: todayUtc,
  }), [alerts, notes, windowFrom, todayUtc]);

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
    // Off the list at once; back on it if the server says no.
    const gone = change(withoutNote(id));
    track(1);
    try {
      const { data, error } = await supabase.rpc('admin_note_delete', { p_id: id });
      if (error || data === false) {
        pending.current = pending.current.filter((op) => op !== gone);
        setNotes(withNote(note));
        feedback.toast({ type: 'error', message: error?.message ? `Note not removed · ${error.message}` : 'Note not removed' });
        return;
      }
      gone.at = Date.now();
    } finally {
      track(-1);
    }
    // A soft delete, so the undo restores the same row, id and all.
    undoToast(feedback, {
      message: `Note removed · ${note.label}`,
      onUndo: async () => {
        track(1);
        try {
          const { data, error } = await supabase.rpc('admin_note_restore', { p_id: id });
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
  // accounts, so reading tier_counts here printed "4 paying accounts" beside
  // $0 of revenue — four people who have never paid anything. Anything that
  // claims to count payers has to count the thing that charges.
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
          foot={lifeN('total_users') != null ? (
            /* Everything the platform has ever accumulated, on one line. Kept
               out of the tiles because a total that only ever rises cannot tell
               you anything is wrong — it is scale, not a signal, and now it
               reads as the rail's footer rather than as five more metrics. */
            <dl className="admin-lifetime">
              <div><dt>Signups</dt><dd>{formatCount(lifeN('total_users'))}</dd></div>
              <div><dt>Clusters</dt><dd>{formatCount(lifeN('total_boards'))}</dd></div>
              <div><dt>Cards</dt><dd>{formatCount(lifeN('total_cards'))}</dd></div>
              <div><dt>Workspaces</dt><dd>{formatCount(lifeN('total_workspaces'))}</dd></div>
              <div>
                <dt>Time in app</dt>
                <dd>{lifeN('total_seconds_in_app') != null
                  ? `${formatCount(Math.round(lifeN('total_seconds_in_app') / 3600))}h` : '—'}</dd>
              </div>
            </dl>
          ) : null}
        >
        <MetricGrid hero>
          <Metric
            hero
            label="Signups"
            value={cur.signups != null ? formatCount(cur.signups) : null}
            sub="new accounts"
            total={lifeN('total_users') != null
              ? { value: formatCount(lifeN('total_users')), label: 'all time' } : null}
            delta={weekDelta(num(cur.signups), num(prev.signups))}
            trend={trends.signups}
            spark={sparks.signups}
            sparkColor={VAR.cat[0]}   /* acquisition */
            title={READ_HOW}
          />
          <Metric
            hero
            label="Weekly active"
            value={wau != null ? formatCount(wau) : null}
            sub="opened the app"
            total={lifeN('total_users') != null && wau != null
              ? { value: formatCount(lifeN('total_users')), label: 'signed up' } : null}
            delta={weekDelta(wau, num(prev.wau))}
            trend={trends.active}
            spark={sparks.active}
            sparkColor={VAR.cat[1]}   /* engagement */
            title={READ_HOW}
          />
          <Metric
            hero
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
            trend={trends.work}
            spark={sparks.work}
            sparkColor={VAR.cat[1]}
            title={`People with a work event in the last 7 days, not everyone who opened the app. ${READ_HOW}`}
          />
          <Metric
            hero
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
            label="MRR"
            value={mrrCents == null ? null : formatMoney(mrrCents)}
            sub={payingUsers > 0
              ? `${formatCount(payingUsers)} paying ${payingUsers === 1 ? 'account' : 'accounts'}`
              : 'no subscription yet'}
            muted={!(mrrCents > 0)}
            total={payingUsers > 0 && arpu != null
              ? { value: formatMoney(arpu), label: 'per account' } : null}
            delta={mrrCents > 0 ? weekDelta(mrrCents, mrrPrev, { kind: 'exact' }) : null}
            spark={mrrCents > 0 ? (d?.history || []).map((r) => num(r.mrr_cents) || 0) : null}
            sparkColor={VAR.cat[1]}
            title={mrrCents > 0
              ? 'Live monthly recurring revenue from ACTIVE subscriptions only. A trial carries the full list price and has collected nothing, so it is counted in Trials and never here.'
              : 'No subscription has ever charged, so this is zero by absence rather than by measurement. It gets a trend line and a change badge as soon as there is something to trend.'}
          />
          <Metric
            hero
            label="Cards created"
            value={cur.cards_created != null ? formatCompact(cur.cards_created) : null}
            sub="across every cluster"
            total={lifeN('total_cards') != null
              ? { value: formatCompact(lifeN('total_cards')), label: 'all time' } : null}
            delta={weekDelta(num(cur.cards_created), num(prev.cards_created))}
            trend={trends.cards}
            spark={sparks.cards}
            sparkColor={VAR.cat[2]}   /* output */
            title={READ_HOW}
          />
        </MetricGrid>
        </Well>
        </Deck>

        {/* The weeks the strips above read, and what changed along the way.
            Small multiples on one calendar: the four series sit an order of
            magnitude apart, so they share the x axis and never the y. The
            markers list sits beside them because a step in a line needs its
            explanation within reach, and it is where the owner pins a note. */}
        <h2 className="admin-section-title">Thirteen weeks, and what changed</h2>
        <Deck>
          <Well
            span={8}
            title="Weekly, by metric"
            meta="13 complete weeks + this week so far · UTC Monday"
            foot="History can shrink: deleted accounts and cards leave it."
          >
            <WeeklyMultiples
              weeks={weeks}
              series={stackSeries}
              markers={mergedMarkers}
              partialWeeks={rows.length > 0 && !rows[rows.length - 1].complete ? 1 : 0}
            />
          </Well>
          <Plate
            span={4}
            className="adm-markers"
            title="What changed"
            meta={`${mergedMarkers.length} marker${mergedMarkers.length === 1 ? '' : 's'} in 13 wk`}
          >
            <MarkersPanel
              markers={mergedMarkers}
              onAdd={addNote}
              onRemove={removeNote}
              busy={inFlight > 0}
              todayUtc={todayUtc}
            />
          </Plate>
        </Deck>

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
              cells={d?.heatmap || []}
              formatValue={(v) => `${formatCount(v)} event${v === 1 ? '' : 's'}`}
            />
          </Well>

          <Well span={4} flush title="Live" meta="pushed, not polled">
            <EventConsole activeNow={d?.activeNow} minutes={60} excludeInternal={f.excludeInternal} />
          </Well>
        </Deck>

        <h2 className="admin-section-title">People</h2>
        <div className="admin-section-sub">
          At this volume the individuals are legible, so read them rather than an average.
        </div>
        <Deck>
          <Plate span={6} title="Just arrived" meta={`newest ${d?.users?.length || 0}`}>
            <WhoArrived users={d?.users || []} />
          </Plate>
          <Plate span={6} title="Arrived and stalled" meta="signed up ≤14d ago, no card ever">
            <WhoStalled rows={d?.stalled || []} />
          </Plate>
        </Deck>
      </div>
    </AdminAsync>
  );
}
