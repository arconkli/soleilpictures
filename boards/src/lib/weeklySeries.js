// weeklySeries.js — the calendar the weekly read stands on.
//
// admin_weekly_series returns one wide row per UTC week. The trend read wants a
// single metric as points it can score, the charts want to know which column a
// dated event falls in, and the verdict strip wants one glyph per week. Those
// jobs share one assumption — a week is a UTC Monday — and nearly every bug in
// this area is two places disagreeing about it. So the assumption lives here,
// once, and date arithmetic for the weekly dashboard belongs in this file.
//
// Three rules, each with a failure behind it:
//
//   - UTC, built from Date.UTC() on the ISO parts. new Date('2026-09-14') is
//     UTC midnight, but getDay() and getDate() read it in LOCAL time, so west of
//     Greenwich the same string is a Sunday: a "Monday" is not one and a marker
//     lands a column early, for some viewers and in no test that runs in UTC.
//     Nothing here touches a local getter.
//   - A week is its Monday, as 'YYYY-MM-DD'. ISO days compare correctly as plain
//     strings, so ordering and windowing never need to parse.
//   - Bad input is null (a date), [] (rows) or '' (a label), never a throw. This
//     runs during render, and a dashboard that white-screens on one malformed
//     row is worse than a chart that is missing that row.
//
// Pure and free of React, the DOM and the Supabase client, like
// retentionStats.js, so all of it is unit-testable under node.

import { DEFINITION_BREAKS } from './adminDefinitionBreaks.js';

// The metrics the dashboard trends, one per column of admin_weekly_series.
//
// `measurableCol` names the boolean that says whether a week could be measured
// at all. It exists only for the two counters that did not always exist, where
// "before the counter" must not read as "zero people did it". `dispersion` is
// the noise model the trend read should use: counts of people vary about as a
// Poisson count does; cards are dominated by the occasional bulk import, so
// they get the robust one. `family` is a plain grouping tag; nothing in this
// module reads it.
export const WEEKLY_METRICS = [
  { key: 'signups', col: 'signups',      label: 'Signups',       family: 0, dispersion: 'poisson' },
  { key: 'active',  col: 'active_users', label: 'Weekly active', family: 1, dispersion: 'poisson', measurableCol: 'active_measurable' },
  { key: 'work',    col: 'work_users',   label: 'Did real work', family: 1, dispersion: 'poisson', measurableCol: 'work_measurable' },
  { key: 'cards',   col: 'cards',        label: 'Cards created', family: 2, dispersion: 'mad' },
];

// ── Calendar ──────────────────────────────────────────────────────────────
const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

// ms -> 'YYYY-MM-DD', or null when the instant is out of range or its year does
// not print as four digits (toISOString signs those: '+010000-01-01').
function formatIso(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString().slice(0, 10);
  return ISO_DAY.test(iso) ? iso : null;
}

// UTC midnight of an ISO day in ms, or NaN. Date.UTC rolls an impossible date
// ('2026-02-30') forward into March instead of refusing it, so a string only
// counts as a day if it survives the round trip back to itself.
function parseIso(iso) {
  const m = typeof iso === 'string' ? ISO_DAY.exec(iso) : null;
  if (!m) return NaN;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return formatIso(ms) === iso ? ms : NaN;
}

/** 'YYYY-MM-DD' plus n days, UTC. null for anything that is not a real ISO day and a finite n. */
export function addDays(isoDate, n) {
  const ms = parseIso(isoDate);
  if (Number.isNaN(ms) || !Number.isFinite(n)) return null;
  return formatIso(ms + n * DAY_MS);
}

/** UTC Monday of the week containing isoDate ('YYYY-MM-DD'); a Sunday maps to the PREVIOUS Monday. */
export function mondayOf(isoDate) {
  const ms = parseIso(isoDate);
  if (Number.isNaN(ms)) return null;
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7; // getUTCDay() has Sunday as 0; here Monday is 0
  return formatIso(ms - sinceMonday * DAY_MS);
}

/** The first UTC Monday ON OR AFTER isoDate (a Monday maps to itself). */
export function mondayOnOrAfter(isoDate) {
  // The Monday on or after d is the Monday OF the week containing d + 6: a
  // Monday's d + 6 is the Sunday closing its own week (so d itself), and every
  // other day's d + 6 falls in the following week, whose Monday is the answer.
  return mondayOf(addDays(isoDate, 6));
}

// ── Rows to points ────────────────────────────────────────────────────────
// ISO days sort correctly as strings, so ordering weeks and days needs no parsing.
const cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
const byWeek = (a, b) => cmp(a.week, b.week);

// A number, or null. Number(null) is 0, so coercing would turn every gap into a
// zero; the RPC sends int columns as JSON numbers, so a string is not a thing
// to parse but a sign that the row is wrong, and a gap is the honest reading.
const finiteOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Wide RPC rows (admin_weekly_series) -> WeekPoint[] for one metric:
 *   { week, value, measurable, complete, settling }
 * value = row[col] (null stays null); measurable = metric.measurableCol ? !!row[measurableCol] : true;
 * a null value with measurable=true is a gap (kept as null); rows sorted by week ascending.
 *
 * Never throws. Input that is not an array of rows is [], and a row without a
 * real week is dropped, since it cannot be placed anywhere. Everything else
 * about a row degrades to the cautious reading: a value that is not a finite
 * number is a gap, and a flag that is absent is false (so a row that does not
 * say it is complete is never scored as if it were).
 */
export function toWeekPoints(rows, metric) {
  if (!Array.isArray(rows) || typeof metric?.col !== 'string') return [];
  const points = [];
  for (const row of rows) {
    if (!row || Number.isNaN(parseIso(row.week_start))) continue;
    points.push({
      week: row.week_start,
      value: finiteOrNull(row[metric.col]),
      measurable: metric.measurableCol ? !!row[metric.measurableCol] : true,
      complete: !!row.complete,
      settling: !!row.settling,
    });
  }
  return points.sort(byWeek);
}

// ── Definition breaks ─────────────────────────────────────────────────────
/**
 * Cut points for a series column: entries with cut=true whose series includes col,
 * each as { week: mondayOnOrAfter(date), date, label, migration }. The straddling week is
 * thereby excluded from scoring (trendStats excludes weeks starting BEFORE week).
 * `date` is the day the change actually happened, kept because the trend read's
 * caveat prints it: the Monday is where the cut falls, not when anything changed.
 * `breaks` is overridable (the harness passes a relative list; DEV `?breaks=0` passes []).
 *
 * Oldest first. Strict about what counts as a cut: only a literal true, and a
 * series list that is really a list, because 'cards'.includes('card') is true
 * and a cut that fires on a substring would be impossible to find.
 */
export function breaksFor(col, breaks = DEFINITION_BREAKS) {
  if (!Array.isArray(breaks)) return [];
  const cuts = [];
  for (const b of breaks) {
    if (!b || b.cut !== true || !Array.isArray(b.series) || !b.series.includes(col)) continue;
    const week = mondayOnOrAfter(b.date);
    if (week) cuts.push({ week, date: b.date, label: b.label, migration: b.migration });
  }
  return cuts.sort(byWeek);
}

// ── Marker placement ──────────────────────────────────────────────────────
/**
 * Where a day lands on an index axis of `weeks` (Monday strings, ascending, evenly spaced).
 * Returns { index, edge } or null. index = i + (day - weeks[i]) / 7 for the week containing
 * day; inside the LAST week index is clamped to weeks.length - 1 and edge = true
 * (the partial week is drawn as a single hollow point at the right rule).
 * null when day < weeks[0] or day >= addDays(weeks.at(-1), 7).
 *
 * An axis that is not consecutive weeks (a hole, a repeat, backwards) is null
 * as well: with no even column width there is nothing a day could be a
 * fraction of, and a NaN position would draw nowhere without saying why.
 */
export function markerIndex(day, weeks) {
  const dayMs = parseIso(day);
  if (Number.isNaN(dayMs) || !Array.isArray(weeks) || weeks.length === 0) return null;
  const last = weeks.length - 1;
  const firstMs = parseIso(weeks[0]);
  const lastMs = parseIso(weeks[last]);
  if (lastMs - firstMs !== last * WEEK_MS) return null; // also false whenever either end is NaN
  if (dayMs < firstMs || dayMs >= lastMs + WEEK_MS) return null;
  if (dayMs >= lastMs) return { index: last, edge: true };

  const i = Math.floor((dayMs - firstMs) / WEEK_MS);
  const daysIn = (dayMs - (firstMs + i * WEEK_MS)) / DAY_MS;
  return { index: i + daysIn / 7, edge: false };
}

// ── Marker merging ────────────────────────────────────────────────────────
const asList = (x) => (Array.isArray(x) ? x : []);
const byDaySourceLabel = (a, b) =>
  cmp(a.day, b.day) || cmp(a.source, b.source) || cmp(a.label, b.label);

/**
 * Merge marker sources into one sorted list (by day, then source, then label):
 *   rpc:       rows from admin_markers [{ day, kind, label, source, ref_id }]
 *   changelog: CHANGELOG_ENTRIES [{ date, title, anchor }] -> { day: date, kind: 'changelog', label: title, source: 'changelog', anchor }
 *   breaks:    DEFINITION_BREAKS -> { day: date, kind: 'break', label, source: 'definition', series, migration }
 *   from/to:   inclusive 'YYYY-MM-DD' window; rows outside are dropped
 * Every output row carries { day, kind, label, source } and keeps any extra fields.
 *
 * The changelog is passed in rather than imported, so this module stays free of
 * generated files and a caller (or a test) can hand it any list. Rows come
 * back as copies, and one whose day is not a real day is dropped, since there
 * is no column to draw it in.
 */
export function mergeMarkers({ rpc = [], changelog = [], breaks = [], from, to } = {}) {
  const rows = [
    ...asList(rpc).filter(Boolean).map((r) => ({ ...r })),
    ...asList(changelog).filter(Boolean).map((c) => ({
      day: c.date, kind: 'changelog', label: c.title, source: 'changelog', anchor: c.anchor,
    })),
    ...asList(breaks).filter(Boolean).map((b) => ({
      day: b.date, kind: 'break', label: b.label, source: 'definition', series: b.series, migration: b.migration,
    })),
  ];
  return rows
    .filter((r) => !Number.isNaN(parseIso(r.day)) && (from == null || r.day >= from) && (to == null || r.day <= to))
    .sort(byDaySourceLabel);
}

// ── Labels ────────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * 'wk of Sep 15' for an ISO Monday (en-US short month, UTC).
 *
 * Built from the ISO parts and a month table instead of toLocaleDateString:
 * the label can then never depend on the viewer's timezone or on which ICU data
 * their runtime shipped, and it is the same string in the tests as in the
 * browser. A string that is not a day gets '' rather than "wk of undefined".
 */
export function weekLabel(isoMonday) {
  if (Number.isNaN(parseIso(isoMonday))) return '';
  const [, month, day] = isoMonday.split('-');
  return `wk of ${MONTHS[Number(month) - 1]} ${Number(day)}`;
}

// ── The streak strip ──────────────────────────────────────────────────────
const STATE_OF_DIR = new Map([[1, 'up'], [0, 'flat'], [-1, 'down']]);

// A fresh object per slot: the strip's callers may decorate a slot, and padding
// that shared one object would decorate them all.
const unmeasuredSlot = () => ({ state: 'unmeasured', settling: false, title: '' });

function slotOf(step) {
  const state = STATE_OF_DIR.get(step?.dir) ?? 'gap';
  return {
    state,
    settling: !!step?.settling,
    title: state === 'gap' ? '' : `${weekLabel(step.week)}: ${step.from} → ${step.to}`,
  };
}

/**
 * Slots for the StreakStrip from a trend read (the TrendRead that weeklyTrend() in trendStats.js returns):
 *   returns `slots` entries, newest last: { state: 'up'|'down'|'flat'|'gap'|'unmeasured', settling, title }
 * Under verdict.code === 'too_few' every slot is 'unmeasured'. Otherwise the last
 * min(slots, steps.length) steps map dir 1/0/-1/null -> up/flat/down/gap, left-padded
 * with 'unmeasured'. title = `${weekLabel(step.week)}: ${from} → ${to}` for defined steps.
 *
 * Reads only trend.verdict.code and trend.steps, so the strip cannot drift from
 * what the trend read decided. A step with no direction, and a slot with no step
 * behind it, have no from and to to report, so their title is ''.
 */
export function streakSlots(trend, slots = 7) {
  const steps = trend?.verdict?.code === 'too_few' || !Array.isArray(trend?.steps) ? [] : trend.steps;
  const shown = steps.slice(Math.max(0, steps.length - slots)).map(slotOf);
  return [...Array.from({ length: Math.max(0, slots - shown.length) }, unmeasuredSlot), ...shown];
}
