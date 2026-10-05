// The calendar half — pure models for the three densities and the wall chart.
//
// WHY THE MONTH GRID STOPPED BEING ENOUGH. A month grid is built for a SPARSE
// calendar: a few meetings a week, most cells empty. A production is the
// opposite — content on nearly every weekday for months — and, more to the
// point, nearly every one of those days IS a board: a cluster holding that
// day's call sheet, shotlist, script pages and running order. So the calendar
// is not showing events. It is the way into thirty-four boards, and a coloured
// bar with a date in it cannot carry a board's identity.
//
// Three densities of the same data, chosen by one control:
//
//   grid   the month grid, kept — a release plan or a prep calendar IS sparse,
//          and sparse is the one thing a grid is genuinely good at
//   tiles  a contact sheet: weeks as rows, each day a tile showing its board's
//          own thumbnail. You recognise a day by what is in it.
//   list   day rows with a small thumb, name, place and call time — a fortnight
//          at a glance, for running the week rather than planning it
//
// Above all three sits the WALL CHART: one row per month, one thin column per
// day. It is the only thing that answers "what is the shape of this shoot", it
// does it in about a hundred pixels, and it is what actually gets pinned up in
// a production office.

import {
  parseISO, formatISO, todayISO, daysInMonth, addDays, addMonths,
  startOfWeek, weekdayOf, MONTHS, MONTHS_SHORT,
} from './schedDates.js';

export const CAL_DENSITIES = Object.freeze(['grid', 'tiles', 'list']);
export const DEFAULT_DENSITY = 'tiles';

export function normalizeDensity(d) {
  return CAL_DENSITIES.includes(d) ? d : DEFAULT_DENSITY;
}

export const CAL_TUNING = Object.freeze({
  WALL_ROW_H: 18,       // one month's band; CSS mirror: .schedw-row height
  WALL_GAP: 2,
  WALL_LABEL_W: 30,
  WALL_MAX_MONTHS: 14,  // a chart taller than this stops being a glance
  TILE_MIN_W: 96,       // below this a tile can hold a thumbnail or a caption, not both
  TILE_ASPECT: 0.72,    // thumbnail box, height / width
  LIST_ROW_H: 52,
  WEEKEND_FR: 0.62,     // weekend columns are narrower — see calTracks()
});

// Inclusive day walk, bounded. Twelve months is ~366 steps; anything past the
// bound is a mis-entered range and must not spin.
function eachDay(from, to, fn) {
  if (!parseISO(from) || !parseISO(to) || to < from) return;
  let d = from;
  for (let i = 0; i < 800; i++) {
    fn(d);
    if (d === to) return;
    d = addDays(d, 1);
  }
}

// ── weeks ───────────────────────────────────────────────────────────────────
//
// Monday-first weeks covering [from, to], clipped to the range. Used by tiles
// and list; both group by week because a production is planned and reported in
// weeks ("three setups before lunch, five days this week").
//
// `pad` keeps the leading and trailing out-of-range days so a grid of tiles
// lines up in columns; the list drops them, because a list has no columns to
// align and a row for a day outside the range is a row about nothing.
export function calWeeks({ from, to, todayIso = todayISO(), pad = true }) {
  if (!parseISO(from) || !parseISO(to) || to < from) return [];
  const out = [];
  let cursor = startOfWeek(from);
  for (let w = 0; w < 120 && cursor <= to; w++) {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(cursor, i);
      const outside = date < from || date > to;
      if (outside && !pad) continue;
      days.push({
        date, dow: i, outside,
        weekend: i >= 5,
        isToday: date === todayIso,
      });
    }
    const real = days.filter((d) => !d.outside);
    if (real.length) {
      out.push({
        key: cursor,
        from: real[0].date,
        to: real[real.length - 1].date,
        label: weekLabel(real[0].date, real[real.length - 1].date),
        days,
      });
    }
    cursor = addDays(cursor, 7);
  }
  return out;
}

function weekLabel(a, b) {
  const x = parseISO(a), y = parseISO(b);
  if (!x || !y) return '';
  return x.m === y.m
    ? `${MONTHS_SHORT[x.m - 1]} ${x.d}–${y.d}`
    : `${MONTHS_SHORT[x.m - 1]} ${x.d} – ${MONTHS_SHORT[y.m - 1]} ${y.d}`;
}

// The grid-template-columns for a tiles week. Weekends get a narrower track:
// productions DO shoot Saturdays, so dropping the columns entirely would strand
// real days — but on a five-day week they are two sevenths of the width holding
// nothing. Narrow recovers most of that and keeps weekday alignment, which
// dropping them would also lose.
export function calTracks(weekendFr = CAL_TUNING.WEEKEND_FR) {
  return `repeat(5, 1fr) ${weekendFr}fr ${weekendFr}fr`;
}

// ── the wall chart ──────────────────────────────────────────────────────────
//
// One row per month between from and to, each with all its real days. Days are
// laid out by DATE, not by weekday, so the columns do not line up between
// months — Aug 1 is a Saturday and Sep 1 a Tuesday. That is how a paper wall
// chart works too; the faded weekend cells carry the rhythm instead.
export function wallMonths({ from, to, todayIso = todayISO() }) {
  const a = parseISO(from), b = parseISO(to);
  if (!a || !b || to < from) return [];
  const out = [];
  let iso = formatISO(a.y, a.m, 1);
  for (let i = 0; i < CAL_TUNING.WALL_MAX_MONTHS; i++) {
    const t = parseISO(iso);
    if (!t || iso > formatISO(b.y, b.m, 1)) break;
    const days = [];
    for (let d = 1; d <= daysInMonth(t.y, t.m); d++) {
      const date = formatISO(t.y, t.m, d);
      days.push({
        date, day: d,
        dow: weekdayOf(date),
        weekend: weekdayOf(date) >= 5,
        isToday: date === todayIso,
      });
    }
    out.push({
      iso, label: `${MONTHS[t.m - 1]} ${t.y}`, short: MONTHS_SHORT[t.m - 1], days,
    });
    iso = addMonths(iso, 1);
  }
  return out;
}

// What the chart should span. A production's own dated days if it has any —
// the chart's whole job is the shape of THIS shoot, and clipping it to whatever
// month you happen to be looking at would defeat that. Falls back to the
// visible range for a calendar with nothing dated on it yet.
export function productionSpan(shootDays, fallback) {
  const dates = Object.keys(shootDays || {}).filter((d) => parseISO(d)).sort();
  if (!dates.length) return { ...fallback };
  const from = dates[0] < fallback.from ? dates[0] : fallback.from;
  const to = dates[dates.length - 1] > fallback.to ? dates[dates.length - 1] : fallback.to;
  const a = parseISO(from), b = parseISO(to);
  // Whole months, so a chart never opens or closes mid-band.
  const start = formatISO(a.y, a.m, 1);
  const end = formatISO(b.y, b.m, daysInMonth(b.y, b.m));
  // Bounded: a stray date years out would otherwise make a chart of empty rows.
  const span = wallMonths({ from: start, to: end });
  return span.length >= CAL_TUNING.WALL_MAX_MONTHS
    ? { from: fallback.from, to: fallback.to }
    : { from: start, to: end };
}

// A production's headline counts, for the summary column. Derived rather than
// stored, so it cannot disagree with the calendar next to it.
export function productionTally(shootDays, typeOf) {
  const tally = {};
  let total = 0;
  const seen = new Set();
  for (const date in shootDays || {}) {
    for (const b of shootDays[date]) {
      if (!b || seen.has(b.id)) continue;      // a multi-day block counts once
      seen.add(b.id);
      if (b.sched_status === 'cancelled') continue;
      total += 1;
      const k = (typeOf ? typeOf(b) : b.day_type) || 'untyped';
      tally[k] = (tally[k] || 0) + 1;
    }
  }
  return { total, byType: tally };
}

// Every date in a range that has neither a dated cluster nor loose content —
// the tiles surface offers these a "+", and it is the only place someone
// creates a day from the calendar rather than from a range dialog.
export function emptyDates({ from, to, shootDays = {}, dayCounts = {} }) {
  const out = [];
  eachDay(from, to, (d) => {
    if (!(shootDays[d] || []).length && !dayCounts[d]) out.push(d);
  });
  return out;
}
