// growthSeries.js — the long run, as Analytics › Overview draws it.
//
// admin_growth_series (0460) returns one row per UTC week since the first
// account: every column admin_weekly_series has, computed the same way, plus
// running totals, who came back, clusters made, day-one cards and time in app.
// admin_return_fixed_horizon (0322) adds the share of each week's first visits
// that came back within seven days, as `week:YYYY-MM-DD` rows. This module turns
// the two into what the band draws: one array per measure on one calendar, the
// reading beside each chart, the sentence each group leads with, and which
// dated markers go where.
//
// Kept apart from WEEKLY_METRICS on purpose. That list is pinned to 0372 by
// weeklySeriesMigration.test.mjs and feeds the tiles' trend reads; this one
// feeds pictures, and adding a measure here must never move a verdict.
//
// The calendar rules are weeklySeries.js's, whose helpers this uses: UTC only,
// a week is its Monday, and bad input degrades (null, [], '') rather than
// throwing, because all of it runs during render.

import { addDays, mondayOf, mondayOnOrAfter } from './weeklySeries.js';

/** A day before the first account. A read that takes a start date counts from the beginning when given it. */
export const BEFORE_LAUNCH = '2026-01-01';

/** admin_return_fixed_horizon clamps p_weeks to 52, so no older week has a return rate. */
export const RETURN_WEEKS = 52;
export const RETURN_HORIZON_DAYS = 7;

/** Under this many people a rate is a dot of its own: drawn, but never joined or leaned on. */
export const SMALL_N = 15;

/** The two windows the band offers: the last thirteen complete weeks, and everything. */
export const RANGES = Object.freeze({ thirteen: '13', all: 'all' });
const THIRTEEN = 13;

// `family` is the categorical slot in viz/palette.js (0 arriving, 1 coming back,
// 2 making things); 'ink' is the neutral mark, for a magnitude with no family.
// `series` lists the DEFINITION_BREAKS series a measure is drawn from, so a break
// is drawn on exactly the charts it changed. `measurable` names the flag that
// says a week could be counted at all.
export const GROWTH_MEASURES = Object.freeze({
  accounts: {
    key: 'accounts', name: 'Accounts', kind: 'line', family: 0, stock: true, area: true,
    col: 'users_total', series: ['signups'],
    about: 'every account that still exists, at the end of each week',
  },
  signups: {
    key: 'signups', name: 'Signups', kind: 'col', family: 0,
    col: 'signups', series: ['signups'],
    about: 'new accounts each week, counted once the emailed code is entered',
  },
  active: {
    key: 'active', name: 'Weekly active', kind: 'stack', family: 1,
    col: 'active_users', back: 'returning_active', fresh: 'new_active', measurable: 'active_measurable',
    series: ['active_users'],
    about: 'opened the app that week: came back from an earlier week, or new that week',
  },
  work: {
    key: 'work', name: 'Did real work', kind: 'line', family: 1,
    col: 'work_users', measurable: 'work_measurable', series: ['work_users'], cut: 'work_users',
    about: 'placed, edited or shared something that week',
  },
  cards: {
    key: 'cards', name: 'Cards made', kind: 'col', family: 2,
    col: 'cards', series: ['cards'],
    about: 'cards placed that week, by when they were made',
  },
  cardsTotal: {
    key: 'cardsTotal', name: 'Cards that exist', kind: 'line', family: 2, stock: true, area: true,
    col: 'cards_total', series: ['cards'],
    about: 'cards on clusters that still exist, at the end of each week',
  },
  clusters: {
    key: 'clusters', name: 'Clusters made', kind: 'col', family: 2,
    col: 'clusters_made', series: [],
    about: 'clusters people made that week, not the Studio every workspace starts with',
  },
  d1: {
    key: 'd1', name: 'Card on day one', kind: 'rate', family: 2,
    n: 'day_one_n', k: 'day_one_activated', mature: 'day_one_complete', series: ['signups'],
    about: 'of each week’s signups, the share who placed a card within 24 hours',
  },
  r7: {
    key: 'r7', name: 'Back within 7 days', kind: 'rate', family: 1, series: [],
    about: 'of each week’s first visits, the share who came back within 7 days',
  },
  time: {
    key: 'time', name: 'Time in app', kind: 'col', family: 'ink',
    col: 'seconds_in_app', measurable: 'seconds_measurable', series: ['seconds_in_app'], hours: true,
    about: 'hours in the app each week',
  },
});

/** Measures in the order they stack, each group led by a sentence and closed by its own date axis. */
export const GROWTH_GROUPS = Object.freeze([
  { key: 'people', name: 'People', rows: ['accounts', 'signups'] },
  { key: 'back', name: 'Coming back', rows: ['active', 'work'] },
  { key: 'making', name: 'Making things', rows: ['cards', 'cardsTotal', 'clusters'] },
  { key: 'first', name: 'First week', rows: ['d1', 'r7'] },
  { key: 'time', name: 'Time in app', rows: ['time'] },
]);

// Definition breaks about something no chart here reads. They stay off the
// charts and off the list, and are counted in one line instead.
const OFF_BAND = { metrics_daily: 'the daily snapshot table', events: 'the raw event log' };
const BAND_SERIES = new Set(Object.values(GROWTH_MEASURES).flatMap((m) => m.series));

// ── Small helpers ─────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** 'Oct 12' for an ISO day, from its parts, so the viewer's zone never moves it. '' for anything else. */
export function monthDay(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
}

export const formatCount = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));

// A number, or null. A bigint column (seconds_in_app) can arrive as a string of
// digits, which is a number; anything else that is not finite is a gap.
function numberOrNull(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return Number(v);
  return null;
}

const byWeek = (a, b) => (a.week_start < b.week_start ? -1 : a.week_start > b.week_start ? 1 : 0);

// ── The series ────────────────────────────────────────────────────────────
/**
 * admin_return_fixed_horizon rows -> Map(Monday -> { n, back }) for its week rows.
 * Only the `week:` dims; the device, source and band splits are another panel's.
 */
export function returnByWeek(rows) {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const m = typeof r?.dim === 'string' ? /^week:(\d{4}-\d{2}-\d{2})$/.exec(r.dim) : null;
    const n = numberOrNull(r?.n);
    const back = numberOrNull(r?.returned);
    if (!m || mondayOf(m[1]) !== m[1] || n == null || back == null) continue;
    out.set(m[1], { n, back });
  }
  return out;
}

/**
 * Whether a week of first visits has had its whole horizon. The read counts a
 * first visit only once it is p_horizon_days old, so a week fills in day by day
 * until its Sunday is: Monday + 6 + 7 days on or before today.
 */
export function returnSettled(week, today, horizon = RETURN_HORIZON_DAYS) {
  const end = addDays(week, 6 + horizon);
  return end != null && typeof today === 'string' && end <= today;
}

/**
 * Wide RPC rows -> one calendar and one set of arrays per measure:
 *   { weeks, n, P, L, today, floors, series: { [measureKey]: { v?, back?, fresh?, n?, k?, mature?, measured } } }
 * P is the week so far (or -1), L the newest complete week (or -1). Values are
 * null where nothing was counted, never 0. A returns read that failed (null) is
 * different from one that found nobody: r7 then carries `failed: true`.
 *
 * Only an unbroken run of weeks can be drawn by position, so a hole in the rows
 * keeps the run that ends at the newest week and drops what came before it.
 */
export function buildGrowth(rows, returnRows, { today } = {}) {
  const sorted = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && typeof r.week_start === 'string' && mondayOf(r.week_start) === r.week_start)
    .sort(byWeek);
  let start = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    if (addDays(sorted[i - 1].week_start, 7) !== sorted[i].week_start) start = i;
  }
  const list = sorted.slice(start);
  const weeks = list.map((r) => r.week_start);
  const n = weeks.length;
  const P = n > 0 && list[n - 1].complete !== true ? n - 1 : -1;
  const L = P === -1 ? n - 1 : n - 2;
  const last = list[n - 1] || {};

  const col = (name) => list.map((r) => numberOrNull(r[name]));
  const flag = (name) => list.map((r) => r[name] === true);
  const series = {};
  for (const m of Object.values(GROWTH_MEASURES)) {
    if (m.kind === 'rate') continue;
    const measured = m.measurable ? flag(m.measurable) : weeks.map(() => true);
    const masked = (vals) => vals.map((v, i) => (measured[i] ? v : null));
    let v = masked(col(m.col));
    if (m.hours) v = v.map((s) => (s == null ? null : s / 3600));
    const s = { v, measured };
    if (m.kind === 'stack') {
      s.back = masked(col(m.back));
      s.fresh = masked(col(m.fresh));
    }
    series[m.key] = s;
  }

  const d1 = GROWTH_MEASURES.d1;
  series.d1 = {
    n: col(d1.n),
    k: col(d1.k),
    mature: list.map((r, i) => r[d1.mature] === true && i !== P),
    measured: weeks.map(() => true),
  };

  // Week-one return. Weeks older than the read reaches have no rate (null), and
  // the oldest week it reaches is cut at its start, so that one is left out too.
  const failed = returnRows == null;
  const ret = returnByWeek(returnRows);
  const reach = typeof today === 'string' ? addDays(today, -7 * RETURN_WEEKS) : null;
  const inReach = (w) => !failed && reach != null && w >= reach;
  series.r7 = {
    n: weeks.map((w) => (inReach(w) ? ret.get(w)?.n ?? 0 : null)),
    k: weeks.map((w) => (inReach(w) ? ret.get(w)?.back ?? 0 : null)),
    mature: weeks.map((w, i) => i !== P && returnSettled(w, today)),
    measured: weeks.map((w) => inReach(w)),
    failed,
  };

  return {
    weeks,
    n,
    P,
    L,
    today: typeof today === 'string' ? today : null,
    floors: {
      active: typeof last.active_floor === 'string' ? last.active_floor : null,
      work: typeof last.work_floor === 'string' ? last.work_floor : null,
      seconds: typeof last.seconds_floor === 'string' ? last.seconds_floor : null,
    },
    series,
  };
}

/** The weeks the band draws: the last thirteen complete and the week so far, or all of them. */
export function rangeOf(growth, range) {
  const n = growth?.n ?? 0;
  const i1 = n - 1;
  const newest = growth?.L >= 0 ? growth.L : i1;
  const i0 = range === RANGES.thirteen ? Math.max(0, newest - (THIRTEEN - 1)) : 0;
  return { i0, i1 };
}

/** Index of the first week on or after the measure's latest definition cut, or null. */
export function cutIndex(growth, measure, cuts) {
  if (!measure?.cut || !Array.isArray(cuts) || !cuts.length) return null;
  const week = cuts.at(-1)?.week;
  if (typeof week !== 'string') return null;
  const i = growth.weeks.findIndex((w) => w >= week);
  return i === -1 ? growth.n : i;
}

// ── One week of one measure, in words ─────────────────────────────────────
/** A rate measure's percentage for week i, or null when nobody is in its cohort. */
export const rateOf = (s, i) => (s?.n?.[i] > 0 && s.k?.[i] != null ? (100 * s.k[i]) / s.n[i] : null);

const hoursText = (h) => `${formatCount(h)}h`;

/**
 * The week a row reads when nothing is pointed at: what exists now for a running
 * total, the newest complete week for a flow, and for a rate the newest week
 * whose cohort has finished filling.
 */
export function defaultIndex(growth, key) {
  const m = GROWTH_MEASURES[key];
  const { P, L } = growth;
  if (m?.stock) return P >= 0 ? P : L;
  if (m?.kind === 'rate') {
    const s = growth.series[key];
    for (let i = L; i >= 0; i -= 1) if (s?.mature?.[i] && s.n?.[i] > 0) return i;
    return L;
  }
  return L;
}

/**
 * What a row's label column says for week i: { value, sub, when }.
 * `pointed` is true while the reader is pointing at a week, which is when a
 * running total stops saying "now" for the week so far.
 */
export function readout(growth, key, i, { pointed = false } = {}) {
  const m = GROWTH_MEASURES[key];
  const s = growth?.series?.[key];
  const w = growth?.weeks?.[i];
  if (!m || !s || typeof w !== 'string') return { value: '—', sub: '', when: '' };
  const partial = i === growth.P;
  const when = partial ? (m.stock && !pointed ? 'now' : `${monthDay(w)} · so far`) : `wk of ${monthDay(w)}`;

  if (m.kind === 'rate') {
    if (s.failed) return { value: '—', sub: '', when: 'did not load' };
    if (!s.measured[i]) return { value: '—', sub: '', when: 'not measured' };
    const p = rateOf(s, i);
    if (p == null) return { value: '—', sub: '', when: `${when} · nobody yet` };
    return {
      value: `${Math.round(p)}%`,
      sub: `${formatCount(s.k[i])}/${formatCount(s.n[i])}`,
      // "so far" already says the week so far is still filling.
      when: s.mature[i] || partial ? when : `${when} · filling`,
    };
  }
  if (!s.measured[i] || s.v[i] == null) {
    const floor = key === 'time' ? growth.floors?.seconds : null;
    return { value: '—', sub: '', when: floor && w < floor ? `starts ${monthDay(floor)}` : 'not measured yet' };
  }
  if (m.kind === 'stack') {
    return { value: formatCount(s.v[i]), sub: s.back[i] != null ? `${formatCount(s.back[i])} back` : '', when };
  }
  return { value: m.hours ? hoursText(s.v[i]) : formatCount(s.v[i]), sub: '', when };
}

// ── The sentence each group leads with ────────────────────────────────────
// Every number in a sentence is a figure drawn on the chart under it, and every
// comparison is with something drawn in the same window.

/**
 * The first whole calendar month in view, before the newest complete week, whose
 * every week was measured and which holds at least SMALL_N between its weeks.
 * A week belongs to the month its Monday is in. `pick(i)` is { n, k } or null.
 */
export function baselineMonth(growth, i0, pick) {
  const { weeks, L } = growth;
  const byMonth = new Map();
  for (let i = Math.max(0, i0); i < L; i += 1) {
    const key = weeks[i].slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(i);
  }
  for (const [key, idx] of byMonth) {
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(5, 7));
    const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
    // Whole: the window holds the month's first Monday and its last one.
    if (weeks[idx[0]] !== mondayOnOrAfter(`${key}-01`) || weeks[idx.at(-1)] !== mondayOf(addDays(next, -1))) continue;
    const picks = idx.map(pick);
    if (picks.some((p) => p == null)) continue;
    const n = picks.reduce((a, p) => a + p.n, 0);
    const k = picks.reduce((a, p) => a + p.k, 0);
    if (n < SMALL_N) continue;
    return { month: MONTH_NAMES[Number(key.slice(5, 7)) - 1], weeks: idx.length, n, k };
  }
  return null;
}

// How the newest complete week sits against the weeks before it in view. A
// window that starts at the first week is every week there has been. `fmt`
// writes the week before in the measure's own unit.
function standing(values, weeks, i0, L, range, fmt = formatCount) {
  const v = values[L];
  const prior = values.slice(i0, L).filter((x) => x != null);
  if (v == null || !prior.length) return '';
  if (v > Math.max(...prior)) {
    return range === RANGES.all || i0 === 0 ? ', the most of any week' : `, the most in ${THIRTEEN} weeks`;
  }
  let j = L - 1;
  while (j >= i0 && !(values[j] != null && values[j] >= v)) j -= 1;
  if (j >= i0 && L - j >= 4) return `, the most since the week of ${monthDay(weeks[j])}`;
  const before = values[L - 1];
  if (before == null || L - 1 < i0) return '';
  if (before === v) return ', the same as the week before';
  return `, ${v > before ? 'up' : 'down'} from ${fmt(before)} the week before`;
}

const t = (text) => ({ text, strong: false });
const b = (text) => ({ text, strong: true });

/** The sentence a group leads with, as [{ text, strong }]. [] when there is nothing to say. */
export function groupHeadline(growth, groupKey, { i0 = 0, range = RANGES.all } = {}) {
  const { weeks, L, series } = growth || {};
  if (!weeks || L == null || L < 0 || L < i0) {
    return groupKey === 'time' ? timeOpening(growth) : [];
  }
  const wk = monthDay(weeks[L]);

  if (groupKey === 'people') {
    const v = series.signups.v;
    if (v[L] == null) return [];
    return [b(formatCount(v[L])), t(` signed up in the week of ${wk}${standing(v, weeks, i0, L, range)}`)];
  }
  if (groupKey === 'making') {
    const v = series.cards.v;
    if (v[L] == null) return [];
    return [b(formatCount(v[L])), t(` cards made in the week of ${wk}${standing(v, weeks, i0, L, range)}`)];
  }
  if (groupKey === 'back') {
    const back = series.active.back;
    if (back[L] == null) return [];
    const base = baselineMonth(growth, i0, (i) => (back[i] == null ? null : { n: back[i], k: back[i] }));
    const head = [b(formatCount(back[L])), t(` came back in the week of ${wk}`)];
    if (!base) return head;
    const avg = base.n / base.weeks;
    const ratio = back[L] / avg;
    if (ratio >= 1.05) return [...head, t(', '), b(`${ratio.toFixed(1)}×`), t(` ${base.month}’s weekly average`)];
    if (ratio <= 0.95) return [...head, t(`, under ${base.month}’s weekly average of `), b(avg.toFixed(1))];
    return [...head, t(`, about ${base.month}’s weekly average`)];
  }
  if (groupKey === 'first') {
    const s = series.d1;
    let j = L;
    while (j >= i0 && !(s.mature[j] && s.n[j] > 0)) j -= 1;
    if (j < i0) return [];
    const head = [b(`${formatCount(s.k[j])} of ${formatCount(s.n[j])}`), t(' made a card on day one')];
    if (j !== L) head.push(t(` in the week of ${monthDay(weeks[j])}`));
    const base = baselineMonth(growth, i0, (i) => (s.n[i] == null ? null : { n: s.n[i], k: s.k[i] }));
    if (!base) return head;
    return [...head, t(`; in ${base.month} it was `), b(`${Math.round((100 * base.k) / base.n)}%`)];
  }
  if (groupKey === 'time') {
    const v = series.time.v;
    const measuredWeek = weeks.findIndex((w, i) => i >= i0 && i <= L && v[i] != null);
    if (measuredWeek === -1 || v[L] == null) return timeOpening(growth);
    return [b(hoursText(v[L])), t(` in the app in the week of ${wk}${standing(v, weeks, i0, L, range, hoursText)}`)];
  }
  return [];
}

// Before a complete week of per-day time exists, the sentence says when one will.
function timeOpening(growth) {
  const floor = growth?.floors?.seconds;
  if (!floor) return [t('Time in app per day is not recorded yet')];
  return [t('Per-day history starts '), b(monthDay(floor)), t(', and the first full week is '), b(monthDay(mondayOnOrAfter(floor)))];
}

/** The plot's own message when a measure has no measured week in view, or null. */
export function emptyMessage(growth, key, { i0, i1 }) {
  const s = growth?.series?.[key];
  if (!s) return null;
  if (key === 'r7' && s.failed) return 'Week-one return did not load';
  const any = s.measured.slice(i0, i1 + 1).some(Boolean);
  if (any) return null;
  if (key === 'time') {
    const floor = growth.floors?.seconds;
    return floor
      ? `Per-day time in app starts ${monthDay(floor)} · the first full week is ${monthDay(mondayOnOrAfter(floor))}`
      : 'Time in app per day is not recorded yet';
  }
  return 'Not measured in these weeks';
}

// ── Markers ───────────────────────────────────────────────────────────────
/** One id per marker, from what it is: the list and the charts light the same one. */
export function markerId(m) {
  return [m?.source ?? '', m?.ref_id ?? m?.anchor ?? m?.migration ?? '', m?.day ?? '', m?.label ?? ''].join('|');
}

const DAY_MS = 86400000;
const dayNumber = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS;

/**
 * Merged markers (lib/weeklySeries.js mergeMarkers) -> what the band shows:
 *   placed:  every marker in view but the breaks below, with `at` (the middle of
 *            its day, in week units on the band's axis), `id`, and `cut` for a
 *            break that cuts its series. The charts draw these and the list
 *            lists them.
 *   offBand: the breaks about something no chart here reads, counted, with the
 *            tables they are about
 * `breaks` is DEFINITION_BREAKS (or the harness's copy): it says which cut.
 */
export function bandMarkers(markers, growth, { i0, i1, breaks = [] } = {}) {
  const weeks = growth?.weeks || [];
  if (!weeks.length) return { placed: [], offBand: { count: 0, tables: [] } };
  const origin = dayNumber(weeks[0]);
  const cutMigrations = new Set((Array.isArray(breaks) ? breaks : [])
    .filter((c) => c?.cut === true).map((c) => c.migration));
  const placed = [];
  const off = [];
  for (const m of Array.isArray(markers) ? markers : []) {
    if (!m || typeof m.day !== 'string' || mondayOf(m.day) == null) continue;
    const d = dayNumber(m.day) - origin;
    const week = Math.floor(d / 7);
    if (week < i0 || week > i1) continue;
    const isBreak = m.kind === 'break';
    const about = Array.isArray(m.series) ? m.series : [];
    if (isBreak && !about.some((s) => BAND_SERIES.has(s))) {
      off.push(m);
      continue;
    }
    placed.push({ ...m, id: markerId(m), at: week + ((d - week * 7) + 0.5) / 7, cut: isBreak && cutMigrations.has(m.migration) });
  }
  const tables = [];
  for (const m of off) {
    for (const s of m.series || []) {
      const name = OFF_BAND[s] || s;
      if (!tables.includes(name)) tables.push(name);
    }
  }
  return { placed, offBand: { count: off.length, tables } };
}

/** The markers one measure's chart draws: every change about the product, and the breaks about its own series. */
export function marksFor(placed, key) {
  const m = GROWTH_MEASURES[key];
  if (!m) return [];
  return placed.filter((p) => p.kind !== 'break'
    || (Array.isArray(p.series) && p.series.some((s) => m.series.includes(s))));
}

/** "Not listed: five definition changes to …, which these charts don't read." or ''. */
export function offBandNote({ count, tables } = {}) {
  if (!count) return '';
  const many = count > 1;
  const list = tables.length > 1 ? `${tables.slice(0, -1).join(', ')} and ${tables.at(-1)}` : tables[0];
  return `Not listed: ${NUMBER_WORDS[count] || count} definition change${many ? 's' : ''} to ${list}, which these charts don’t read.`;
}
