// growthSeries.test.mjs — node --test src/lib/growthSeries.test.mjs
//
// The long-run band's data layer: one calendar of weeks, a reading per measure,
// the sentence each group leads with, and where each dated marker goes. Every
// expected date was counted on a calendar (2026-06-01 is a Monday), never copied
// from the function's own answer.
//
// Dates are real; every count is synthetic, because this repo is public and
// real figures do not belong in it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROWTH_GROUPS, GROWTH_MEASURES, RANGES, SMALL_N, bandMarkers, baselineMonth, buildGrowth,
  cutIndex, defaultIndex, emptyMessage, groupHeadline, markerId, marksFor, monthDay, offBandNote,
  rangeOf, readout, returnByWeek, returnSettled,
} from './growthSeries.js';

const DAY_MS = 86400000;
const plus = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

// 21 weeks: Jun 1 (0) … Oct 12 (19, the newest complete one), and Oct 19 (20),
// this week so far when today is Tuesday 2026-10-20.
const START = '2026-06-01';
const TODAY = '2026-10-20';
const WEEKS = Array.from({ length: 21 }, (_, i) => plus(START, 7 * i));
const L = 19;
const P = 20;

function row(week_start, over = {}) {
  return {
    week_start,
    complete: true,
    settling: false,
    signups: 10,
    active_users: 20,
    active_measurable: true,
    work_users: 5,
    work_measurable: true,
    cards: 100,
    active_floor: '2026-05-19',
    work_floor: '2026-08-17',
    users_total: 100,
    new_active: 8,
    returning_active: 12,
    clusters_made: 4,
    cards_total: 1000,
    day_one_n: 10,
    day_one_activated: 4,
    day_one_complete: true,
    seconds_in_app: null,
    seconds_measurable: false,
    seconds_floor: '2026-10-20',
    ...over,
  };
}

/** Every week a plain row; `per(i)` overrides week i, and the last week is the one so far. */
function rows(per = () => ({})) {
  return WEEKS.map((w, i) => row(w, { ...(i === P ? { complete: false, settling: true } : {}), ...per(i) }));
}

const grow = (per, returns = [], today = TODAY) => buildGrowth(rows(per), returns, { today });

// ── The calendar ──────────────────────────────────────────────────────────
test('the calendar: the week so far is P, the newest complete week L', () => {
  const g = grow();
  assert.equal(g.n, 21);
  assert.equal(g.P, P);
  assert.equal(g.L, L);
  assert.equal(g.weeks[0], '2026-06-01');
  assert.equal(g.weeks[L], '2026-10-12');
  assert.equal(g.weeks[P], '2026-10-19');
});

test('with every week complete there is no week so far', () => {
  const g = buildGrowth(WEEKS.slice(0, 20).map((w) => row(w)), [], { today: TODAY });
  assert.equal(g.P, -1);
  assert.equal(g.L, 19);
});

test('rows arrive in any order and are drawn in week order', () => {
  const shuffled = rows().slice().reverse();
  assert.deepEqual(buildGrowth(shuffled, [], { today: TODAY }).weeks, WEEKS);
});

test('a hole in the weeks keeps the run that ends at the newest week, and nothing is drawn across it', () => {
  // Sep 21 (16) is missing: Jun 1 … Sep 14 is a run, Sep 28 … Oct 19 is the newest.
  const g = buildGrowth(rows().filter((r) => r.week_start !== '2026-09-21'), [], { today: TODAY });
  assert.deepEqual(g.weeks, ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']);
  assert.equal(g.P, 3);
  assert.equal(g.L, 2);
});

test('a row whose week_start is not a Monday is not a week', () => {
  const bad = [...rows(), row('2026-10-21')];
  assert.equal(buildGrowth(bad, [], { today: TODAY }).n, 21);
});

test('nothing to draw degrades to an empty calendar, never a throw', () => {
  for (const input of [null, undefined, 'nope', {}, [null, 3, 'x']]) {
    const g = buildGrowth(input, null, { today: TODAY });
    assert.equal(g.n, 0, String(input));
    assert.equal(g.L, -1);
    assert.equal(g.P, -1);
  }
});

// ── What a week holds ─────────────────────────────────────────────────────
test('a week nothing was counting is null, not zero, even when the row says 0', () => {
  const g = grow((i) => (i < 3 ? { active_measurable: false, active_users: 0, new_active: 0, returning_active: 0 } : {}));
  const s = g.series.active;
  assert.deepEqual(s.v.slice(0, 4), [null, null, null, 20]);
  assert.deepEqual(s.back.slice(0, 4), [null, null, null, 12]);
  assert.deepEqual(s.fresh.slice(0, 4), [null, null, null, 8]);
  assert.deepEqual(s.measured.slice(0, 4), [false, false, false, true]);
});

test('a measured zero stays a zero', () => {
  const g = grow((i) => (i === 4 ? { signups: 0 } : {}));
  assert.equal(g.series.signups.v[4], 0);
});

test('time in app: a bigint arrives as a string of digits and is drawn in hours', () => {
  const g = grow((i) => (i >= 18 ? { seconds_measurable: true, seconds_in_app: i === 18 ? '7200' : 5400 } : {}));
  assert.equal(g.series.time.v[18], 2);
  assert.equal(g.series.time.v[19], 1.5);
  assert.equal(g.series.time.v[17], null);
  assert.equal(g.floors.seconds, '2026-10-20');
});

test('a value that is not a number is a gap', () => {
  const g = grow((i) => (i === 2 ? { cards: 'lots' } : i === 3 ? { cards: Number.NaN } : {}));
  assert.equal(g.series.cards.v[2], null);
  assert.equal(g.series.cards.v[3], null);
});

test('day one: the week so far is never a finished cohort, whatever the row says', () => {
  const g = grow((i) => (i === P ? { day_one_complete: true } : {}));
  assert.equal(g.series.d1.mature[P], false);
  assert.equal(g.series.d1.mature[L], true);
});

// ── Week-one return ───────────────────────────────────────────────────────
test('returnByWeek reads only week rows, on a Monday, with numbers', () => {
  const m = returnByWeek([
    { dim: 'all', n: 50, returned: 10 },
    { dim: 'week:2026-10-05', n: 20, returned: 5 },
    { dim: 'week:2026-10-06', n: 9, returned: 1 }, // a Tuesday
    { dim: 'week:2026-09-28', n: null, returned: 2 },
    { dim: 'device:desktop', n: 30, returned: 7 },
  ]);
  assert.deepEqual([...m.entries()], [['2026-10-05', { n: 20, back: 5 }]]);
});

test('a week of first visits has had its horizon once its Sunday is seven days old', () => {
  // Oct 5 + 6 = Sunday Oct 11; + 7 = Oct 18.
  assert.equal(returnSettled('2026-10-05', '2026-10-17'), false);
  assert.equal(returnSettled('2026-10-05', '2026-10-18'), true);
});

test('a returns read that failed is not a week where nobody came back', () => {
  const failed = grow(undefined, null);
  assert.equal(failed.series.r7.failed, true);
  assert.equal(failed.series.r7.measured.some(Boolean), false);
  assert.equal(emptyMessage(failed, 'r7', { i0: 0, i1: P }), 'Week-one return did not load');
  assert.equal(readout(failed, 'r7', L).when, 'did not load');

  const nobody = grow(undefined, []);
  assert.equal(nobody.series.r7.failed, false);
  assert.equal(nobody.series.r7.n[L], 0);
  assert.equal(emptyMessage(nobody, 'r7', { i0: 0, i1: P }), null);
  assert.equal(readout(nobody, 'r7', L).when, 'wk of Oct 12 · nobody yet');
});

test('a week older than the return read reaches has no rate', () => {
  // A year on, the read's 52 weeks reach back to 2026-07-02: Jun 29 (4) is out, Jul 6 (5) in.
  const g = grow(undefined, [{ dim: 'week:2026-06-29', n: 20, returned: 5 }, { dim: 'week:2026-07-06', n: 20, returned: 6 }], '2027-07-01');
  assert.equal(g.series.r7.measured[4], false);
  assert.equal(g.series.r7.n[4], null);
  assert.equal(g.series.r7.measured[5], true);
  assert.equal(g.series.r7.k[5], 6);
});

test('the newest complete week of first visits is still filling', () => {
  const g = grow(undefined, [{ dim: 'week:2026-10-12', n: 4, returned: 1 }, { dim: 'week:2026-10-05', n: 20, returned: 6 }]);
  assert.equal(g.series.r7.mature[L], false); // Oct 12 settles on Oct 25
  assert.equal(g.series.r7.mature[18], true); // Oct 5 settled on Oct 18
});

// ── The window ────────────────────────────────────────────────────────────
test('thirteen weeks is the last thirteen complete and the week so far', () => {
  const g = grow();
  assert.deepEqual(rangeOf(g, RANGES.thirteen), { i0: L - 12, i1: P });
  assert.deepEqual(rangeOf(g, RANGES.all), { i0: 0, i1: P });
  const young = buildGrowth(rows().slice(-5), [], { today: TODAY });
  assert.deepEqual(rangeOf(young, RANGES.thirteen), { i0: 0, i1: 4 });
});

test('the cut index is the first week on or after the latest cut', () => {
  const g = grow();
  const work = GROWTH_MEASURES.work;
  assert.equal(cutIndex(g, work, [{ week: '2026-08-17' }, { week: '2026-10-05' }]), 18);
  assert.equal(cutIndex(g, work, [{ week: '2026-10-07' }]), 19);
  assert.equal(cutIndex(g, work, []), null);
  assert.equal(cutIndex(g, GROWTH_MEASURES.cards, [{ week: '2026-10-05' }]), null);
});

// ── One reading ───────────────────────────────────────────────────────────
test('a running total reads "now" for the week so far, until a week is pointed at', () => {
  const g = grow((i) => ({ users_total: 100 + i }));
  assert.equal(defaultIndex(g, 'accounts'), P);
  assert.deepEqual(readout(g, 'accounts', P), { value: '120', sub: '', when: 'now' });
  assert.deepEqual(readout(g, 'accounts', P, { pointed: true }), { value: '120', sub: '', when: 'Oct 19 · so far' });
  assert.equal(readout(g, 'accounts', L).when, 'wk of Oct 12');
});

test('a flow reads the newest complete week by default', () => {
  const g = grow();
  assert.equal(defaultIndex(g, 'signups'), L);
  assert.deepEqual(readout(g, 'active', L), { value: '20', sub: '12 back', when: 'wk of Oct 12' });
});

test('a rate reads the newest finished cohort by default, and says when one is filling', () => {
  const g = grow((i) => (i === L ? { day_one_complete: false } : {}));
  assert.equal(defaultIndex(g, 'd1'), 18);
  assert.deepEqual(readout(g, 'd1', 18), { value: '40%', sub: '4/10', when: 'wk of Oct 5' });
  assert.deepEqual(readout(g, 'd1', L), { value: '40%', sub: '4/10', when: 'wk of Oct 12 · filling' });
});

test('time before its first recorded day says when it starts', () => {
  const g = grow();
  assert.deepEqual(readout(g, 'time', L), { value: '—', sub: '', when: 'starts Oct 20' });
  assert.equal(readout(g, 'work', L).when, 'wk of Oct 12');
  const unmeasured = grow((i) => (i === L ? { work_measurable: false } : {}));
  assert.deepEqual(readout(unmeasured, 'work', L), { value: '—', sub: '', when: 'not measured yet' });
});

// ── The sentences ─────────────────────────────────────────────────────────
const words = (parts) => parts.map((p) => p.text).join('');
const strong = (parts) => parts.filter((p) => p.strong).map((p) => p.text);

test('a record week is the most of any week across the whole history', () => {
  const g = grow((i) => (i === L ? { signups: 30 } : {}));
  const head = groupHeadline(g, 'people', { i0: 0, range: RANGES.all });
  assert.equal(words(head), '30 signed up in the week of Oct 12, the most of any week');
  assert.deepEqual(strong(head), ['30']);
});

test('a record inside thirteen weeks says thirteen, not "any week"', () => {
  const g = grow((i) => (i === 2 ? { signups: 50 } : i === L ? { signups: 30 } : {}));
  const { i0 } = rangeOf(g, RANGES.thirteen);
  assert.equal(words(groupHeadline(g, 'people', { i0, range: RANGES.thirteen })),
    '30 signed up in the week of Oct 12, the most in 13 weeks');
});

test('short of a record, the sentence names the last week that was higher, if it was a while ago', () => {
  // Jul 6 (5) had 40; nothing since reached 30.
  const g = grow((i) => (i === 5 ? { signups: 40 } : i === L ? { signups: 30 } : {}));
  assert.equal(words(groupHeadline(g, 'people', { i0: 0 })),
    '30 signed up in the week of Oct 12, the most since the week of Jul 6');
});

test('otherwise it compares with the week before', () => {
  const down = grow((i) => (i === 18 ? { signups: 35 } : i === L ? { signups: 30 } : {}));
  assert.equal(words(groupHeadline(down, 'people', { i0: 0 })),
    '30 signed up in the week of Oct 12, down from 35 the week before');
  const same = grow((i) => (i === 5 ? { signups: 40 } : i >= 17 && i <= L ? { signups: 30 } : {}));
  assert.equal(words(groupHeadline(same, 'people', { i0: 0 })),
    '30 signed up in the week of Oct 12, the same as the week before');
});

test('cards made lead the making group the same way', () => {
  const g = grow((i) => (i === L ? { cards: 1500 } : {}));
  assert.equal(words(groupHeadline(g, 'making', { i0: 0 })),
    '1,500 cards made in the week of Oct 12, the most of any week');
});

test('the first whole month in view, measured and big enough, is the comparison', () => {
  const g = grow();
  const back = (i) => ({ n: g.series.active.back[i], k: g.series.active.back[i] });
  // From Jun 1, June is whole: its first Monday (Jun 1) and its last (Jun 29) are in view.
  assert.deepEqual(baselineMonth(g, 0, back), { month: 'June', weeks: 5, n: 60, k: 60 });
  // From Jul 20 (thirteen weeks), July is cut short; August (Aug 3 … Aug 31) is whole.
  assert.equal(baselineMonth(g, 7, back).month, 'August');
  // A month with an unmeasured week is not a baseline.
  const gap = grow((i) => (i === 2 ? { active_measurable: false } : {}));
  const gapBack = (i) => (gap.series.active.back[i] == null ? null : { n: gap.series.active.back[i], k: 0 });
  assert.equal(baselineMonth(gap, 0, gapBack).month, 'July');
});

test(`a month under ${SMALL_N} between its weeks is not a baseline`, () => {
  const g = grow((i) => (i <= 4 ? { returning_active: 2 } : {}));
  const back = (i) => ({ n: g.series.active.back[i], k: g.series.active.back[i] });
  assert.equal(baselineMonth(g, 0, back).month, 'July');
});

test('coming back is compared with the baseline month’s weekly average', () => {
  const twice = grow((i) => (i === L ? { returning_active: 24 } : {}));
  const head = groupHeadline(twice, 'back', { i0: 0 });
  assert.equal(words(head), '24 came back in the week of Oct 12, 2.0× June’s weekly average');
  assert.deepEqual(strong(head), ['24', '2.0×']);

  const under = grow((i) => (i === L ? { returning_active: 6 } : {}));
  assert.equal(words(groupHeadline(under, 'back', { i0: 0 })),
    '6 came back in the week of Oct 12, under June’s weekly average of 12.0');

  const about = grow();
  assert.equal(words(groupHeadline(about, 'back', { i0: 0 })),
    '12 came back in the week of Oct 12, about June’s weekly average');
});

test('day one names the newest finished cohort, and the baseline month’s rate', () => {
  const g = grow((i) => (i === L ? { day_one_complete: false } : i <= 4 ? { day_one_activated: 5 } : {}));
  const head = groupHeadline(g, 'first', { i0: 0 });
  // Oct 12 is still filling, so Oct 5 is the newest finished week; June was 25 of 50.
  assert.equal(words(head), '4 of 10 made a card on day one in the week of Oct 5; in June it was 50%');
  assert.deepEqual(strong(head), ['4 of 10', '50%']);
});

test('before a full week of time exists, the sentence says when one will', () => {
  const g = grow();
  const head = groupHeadline(g, 'time', { i0: 0 });
  assert.equal(words(head), 'Per-day history starts Oct 20, and the first full week is Oct 26');
  assert.equal(emptyMessage(g, 'time', { i0: 0, i1: P }),
    'Per-day time in app starts Oct 20 · the first full week is Oct 26');
});

test('once time is measured, it leads with hours, and compares in hours', () => {
  const secs = { 18: '43200', 19: '36000', 20: '3600' };
  const g = grow((i) => (i >= 18 ? { seconds_measurable: true, seconds_in_app: secs[i] } : {}));
  assert.equal(emptyMessage(g, 'time', { i0: 0, i1: P }), null);
  assert.equal(words(groupHeadline(g, 'time', { i0: 0 })), '10h in the app in the week of Oct 12, down from 12h the week before');
  assert.deepEqual(readout(g, 'time', L), { value: '10h', sub: '', when: 'wk of Oct 12' });
});

test('every group has a sentence or nothing, never a throw, on an empty calendar', () => {
  const g = buildGrowth([], null, { today: TODAY });
  for (const group of GROWTH_GROUPS) {
    assert.ok(Array.isArray(groupHeadline(g, group.key, { i0: 0 })), group.key);
  }
});

// ── Markers ───────────────────────────────────────────────────────────────
const BREAKS = [
  { migration: '0347', cut: true },
  { migration: '0254', cut: false },
];

const MARKERS = [
  { day: '2026-06-10', kind: 'ship', label: 'Import', source: 'note', ref_id: 7 },
  { day: '2026-10-01', kind: 'break', label: 'Work redefined', source: 'definition', migration: '0347', series: ['work_users'] },
  { day: '2026-08-22', kind: 'break', label: 'Cards get a time', source: 'definition', migration: '0254', series: ['cards'] },
  { day: '2026-07-01', kind: 'break', label: 'Snapshot fixed', source: 'definition', migration: '0332', series: ['metrics_daily'] },
  { day: '2026-07-02', kind: 'break', label: 'Bots set aside', source: 'definition', migration: '0294', series: ['events'] },
  { day: '2026-05-20', kind: 'changelog', label: 'Before the first week', source: 'changelog', anchor: 'early' },
];

test('a marker sits in the middle of its day, in weeks along the band', () => {
  const g = grow();
  const { placed } = bandMarkers(MARKERS, g, { i0: 0, i1: P, breaks: BREAKS });
  const ship = placed.find((m) => m.label === 'Import');
  // Wednesday Jun 10 is day 2 of week 1 (Jun 8): 1 + 2.5/7.
  assert.ok(Math.abs(ship.at - (1 + 2.5 / 7)) < 1e-9);
  assert.equal(ship.id, markerId(MARKERS[0]));
});

test('a definition break about a table no chart reads is counted, not drawn', () => {
  const g = grow();
  const { placed, offBand } = bandMarkers(MARKERS, g, { i0: 0, i1: P, breaks: BREAKS });
  assert.deepEqual(placed.map((m) => m.label).sort(), ['Cards get a time', 'Import', 'Work redefined']);
  assert.deepEqual(offBand, { count: 2, tables: ['the daily snapshot table', 'the raw event log'] });
  assert.equal(offBandNote(offBand),
    'Not listed: two definition changes to the daily snapshot table and the raw event log, which these charts don’t read.');
  assert.equal(offBandNote({ count: 1, tables: ['the raw event log'] }),
    'Not listed: one definition change to the raw event log, which these charts don’t read.');
  assert.equal(offBandNote({ count: 0, tables: [] }), '');
});

test('only a break the list of breaks calls a cut is a cut', () => {
  const g = grow();
  const { placed } = bandMarkers(MARKERS, g, { i0: 0, i1: P, breaks: BREAKS });
  assert.equal(placed.find((m) => m.migration === '0347').cut, true);
  assert.equal(placed.find((m) => m.migration === '0254').cut, false);
  assert.equal(placed.find((m) => m.label === 'Import').cut, false);
});

test('markers outside the weeks in view are left out', () => {
  const g = grow();
  const { i0 } = rangeOf(g, RANGES.thirteen); // from Jul 20
  const { placed, offBand } = bandMarkers(MARKERS, g, { i0, i1: P, breaks: BREAKS });
  assert.deepEqual(placed.map((m) => m.label).sort(), ['Cards get a time', 'Work redefined']);
  assert.equal(offBand.count, 0);
});

test('a chart draws every change, and only the breaks about its own series', () => {
  const g = grow();
  const { placed } = bandMarkers(MARKERS, g, { i0: 0, i1: P, breaks: BREAKS });
  const labels = (key) => marksFor(placed, key).map((m) => m.label).sort();
  assert.deepEqual(labels('work'), ['Import', 'Work redefined']);
  assert.deepEqual(labels('cards'), ['Cards get a time', 'Import']);
  assert.deepEqual(labels('cardsTotal'), ['Cards get a time', 'Import']);
  assert.deepEqual(labels('signups'), ['Import']);
  assert.deepEqual(labels('r7'), ['Import']);
});

test('a marker id is what the marker is, so the list and the charts agree', () => {
  assert.equal(markerId({ source: 'note', ref_id: 3, day: '2026-10-01', label: 'x' }), 'note|3|2026-10-01|x');
  assert.equal(markerId({ source: 'changelog', anchor: 'a', day: '2026-10-01', label: 'x' }), 'changelog|a|2026-10-01|x');
  assert.equal(markerId({ source: 'definition', migration: '0347', day: '2026-10-01', label: 'x' }), 'definition|0347|2026-10-01|x');
});

// ── The measures themselves ───────────────────────────────────────────────
test('every measure is in exactly one group, and every group names real measures', () => {
  const listed = GROWTH_GROUPS.flatMap((g) => g.rows);
  assert.deepEqual([...listed].sort(), Object.keys(GROWTH_MEASURES).sort());
  assert.equal(new Set(listed).size, listed.length);
});

test('monthDay reads the date from its parts, so no zone moves it', () => {
  assert.equal(monthDay('2026-10-01'), 'Oct 1');
  assert.equal(monthDay('2026-12-31'), 'Dec 31');
  assert.equal(monthDay('soon'), '');
  assert.equal(monthDay(null), '');
});
