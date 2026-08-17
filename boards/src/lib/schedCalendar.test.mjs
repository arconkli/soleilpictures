// The calendar half's pure models.
//
// The load-bearing properties:
//
// A WEEK IS MONDAY-FIRST AND CLIPPED. Tiles lay out in columns, so the leading
// and trailing out-of-range days have to be kept as padding or the grid
// staggers. A list has no columns and drops them, because a row about a day
// outside the range is a row about nothing.
//
// THE WALL CHART SPANS THE PRODUCTION, NOT THE MONTH YOU ARE LOOKING AT. Its
// entire job is the shape of the shoot; clipping it to the visible range would
// answer a question nobody asked. But it also has to be bounded, or one stray
// date years out turns it into a column of empty bands.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calWeeks, calTracks, wallMonths, productionSpan, productionTally, emptyDates,
  normalizeDensity, CAL_DENSITIES, DEFAULT_DENSITY, CAL_TUNING,
} from './schedCalendar.js';

// September 2026: the 1st is a Tuesday, the 30th a Wednesday.
const SEP = { from: '2026-09-01', to: '2026-09-30' };

test('weeks are Monday-first and cover the range', () => {
  const w = calWeeks({ ...SEP, todayIso: '2026-09-08' });
  assert.equal(w[0].days[0].date, '2026-08-31', 'the Monday before the 1st');
  assert.equal(w[0].days[0].outside, true);
  assert.equal(w[0].days[1].date, '2026-09-01');
  assert.equal(w[0].from, '2026-09-01', 'from/to are the in-range edges');
  assert.equal(w[w.length - 1].to, '2026-09-30');
  assert.ok(w.every((x) => x.days.length === 7), 'padded weeks are always 7 wide');
});

test('a padded week keeps its columns; an unpadded one drops the strays', () => {
  const padded = calWeeks({ ...SEP, pad: true })[0];
  const bare = calWeeks({ ...SEP, pad: false })[0];
  assert.equal(padded.days.length, 7);
  assert.equal(bare.days.length, 6, 'Tue–Sun; the Monday belongs to August');
  assert.ok(bare.days.every((d) => !d.outside));
});

test('weekends and today are flagged, once each', () => {
  const w = calWeeks({ ...SEP, todayIso: '2026-09-08' });
  const days = w.flatMap((x) => x.days).filter((d) => !d.outside);
  assert.equal(days.filter((d) => d.isToday).length, 1);
  assert.equal(days.find((d) => d.isToday).date, '2026-09-08');
  // Sept 2026 has 4 Saturdays and 4 Sundays.
  assert.equal(days.filter((d) => d.weekend).length, 8);
  assert.ok(days.filter((d) => d.weekend).every((d) => d.dow >= 5));
});

test('week labels read as a person would write them, across a month boundary', () => {
  const w = calWeeks({ from: '2026-08-28', to: '2026-09-10' });
  assert.equal(w[0].label, 'Aug 28–30');
  assert.equal(w[1].label, 'Aug 31 – Sep 6');
  assert.equal(w[2].label, 'Sep 7–10');
});

test('a backwards or unparseable range is empty, not a spin', () => {
  assert.deepEqual(calWeeks({ from: '2026-09-30', to: '2026-09-01' }), []);
  assert.deepEqual(calWeeks({ from: 'nope', to: '2026-09-01' }), []);
});

test('weekend columns are narrower but still there', () => {
  // Productions shoot Saturdays. Dropping the columns would strand real days;
  // narrowing them recovers most of the width and keeps weekday alignment.
  assert.match(calTracks(), /repeat\(5, 1fr\)/);
  assert.ok(CAL_TUNING.WEEKEND_FR > 0 && CAL_TUNING.WEEKEND_FR < 1);
});

// ── the wall chart ──────────────────────────────────────────────────────────

test('the chart is one row per month with every real day', () => {
  const m = wallMonths({ from: '2026-08-01', to: '2026-10-31' });
  assert.deepEqual(m.map((x) => x.short), ['Aug', 'Sep', 'Oct']);
  assert.deepEqual(m.map((x) => x.days.length), [31, 30, 31]);
  assert.equal(m[0].label, 'August 2026');
});

test('the chart lays out by date, so weekdays do NOT line up between months', () => {
  // Aug 1 2026 is a Saturday, Sep 1 a Tuesday. This is how a paper wall chart
  // works; the faded weekend cells carry the rhythm instead of the columns.
  const m = wallMonths({ from: '2026-08-01', to: '2026-09-30' });
  assert.equal(m[0].days[0].dow, 5, 'Aug 1 = Saturday');
  assert.equal(m[1].days[0].dow, 1, 'Sep 1 = Tuesday');
  assert.equal(m[0].days[0].weekend, true);
  assert.equal(m[1].days[0].weekend, false);
});

test('the chart handles a leap February and a year boundary', () => {
  const m = wallMonths({ from: '2024-01-01', to: '2024-03-31' });
  assert.deepEqual(m.map((x) => x.days.length), [31, 29, 31]);
  const y = wallMonths({ from: '2026-12-01', to: '2027-01-31' });
  assert.deepEqual(y.map((x) => x.label), ['December 2026', 'January 2027']);
});

test('today is marked exactly once across the whole chart', () => {
  const days = wallMonths({ from: '2026-08-01', to: '2026-10-31', todayIso: '2026-09-08' })
    .flatMap((m) => m.days);
  assert.equal(days.filter((d) => d.isToday).length, 1);
});

test('the chart spans the PRODUCTION, not the month in view', () => {
  const shootDays = { '2026-08-17': [{ id: 'a' }], '2026-10-09': [{ id: 'b' }] };
  const span = productionSpan(shootDays, { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(span, { from: '2026-08-01', to: '2026-10-31' }, 'whole months, both ends');
});

test('with nothing dated, the chart falls back to what is on screen', () => {
  assert.deepEqual(productionSpan({}, SEP), SEP);
  assert.deepEqual(productionSpan(null, SEP), SEP);
});

test('one stray date years out does not turn the chart into empty bands', () => {
  const span = productionSpan({ '2031-04-02': [{ id: 'x' }] }, SEP);
  assert.deepEqual(span, SEP, 'bounded — falls back rather than drawing 55 rows');
});

// ── counts ──────────────────────────────────────────────────────────────────

test('a multi-day block counts once, and a cancelled day not at all', () => {
  const block = { id: 'travel', day_type: 'travel' };
  const shootDays = {
    '2026-09-07': [{ id: 'd1', day_type: 'main' }],
    '2026-09-08': [{ id: 'd2', day_type: 'main' }],
    '2026-09-09': [block],
    '2026-09-10': [block],                                     // same cluster, two dates
    '2026-09-11': [{ id: 'x', day_type: 'main', sched_status: 'cancelled' }],
  };
  const t = productionTally(shootDays);
  assert.equal(t.total, 3);
  assert.deepEqual(t.byType, { main: 2, travel: 1 });
});

test('a day with no type still counts, under a name that is not a colour', () => {
  const t = productionTally({ '2026-09-07': [{ id: 'a' }] });
  assert.equal(t.total, 1);
  assert.deepEqual(t.byType, { untyped: 1 });
});

test('empty dates are the ones with neither a cluster nor loose content', () => {
  const e = emptyDates({
    from: '2026-09-01', to: '2026-09-05',
    shootDays: { '2026-09-02': [{ id: 'a' }] },
    dayCounts: { '2026-09-04': 3 },
  });
  assert.deepEqual(e, ['2026-09-01', '2026-09-03', '2026-09-05']);
});

// ── the density control ─────────────────────────────────────────────────────

test('density falls back rather than rendering an unknown surface', () => {
  assert.deepEqual([...CAL_DENSITIES], ['grid', 'tiles', 'list']);
  assert.equal(normalizeDensity('tiles'), 'tiles');
  assert.equal(normalizeDensity('grid'), 'grid');
  for (const junk of ['gallery', '', null, undefined, 7, {}]) {
    assert.equal(normalizeDensity(junk), DEFAULT_DENSITY, String(junk));
  }
});
