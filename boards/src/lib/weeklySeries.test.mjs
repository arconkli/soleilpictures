// weeklySeries.test.mjs — node --test src/lib/weeklySeries.test.mjs
//
// Most of what is under test is arithmetic on a calendar, and calendars are
// where plausible code is quietly wrong: a Sunday that belongs to the PREVIOUS
// Monday's week, a day that lands in the right column only in some timezones, a
// partial week that must not be drawn as if it were whole, a zero that turns
// into a gap on its way through. Each of those is a case below, and each
// expected date was worked out by counting on a calendar, never by running the
// function and copying its answer.
//
// Dates are real; every count is synthetic, because this repo is public and
// real figures do not belong in it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFINITION_BREAKS, WEEKLY_SERIES_KEYS } from './adminDefinitionBreaks.js';
import { CHANGELOG_ENTRIES } from './changelogIndex.js';
import {
  WEEKLY_METRICS, mondayOf, mondayOnOrAfter, addDays, toWeekPoints, breaksFor, markerIndex,
  mergeMarkers, weekLabel, streakSlots,
} from './weeklySeries.js';

// ── Calendar ──────────────────────────────────────────────────────────────
test('mondayOf: a Sunday belongs to the week that began the PREVIOUS Monday', () => {
  assert.equal(mondayOf('2026-10-04'), '2026-09-28'); // Sunday
});

test('mondayOf: a Monday is its own week', () => {
  assert.equal(mondayOf('2026-09-28'), '2026-09-28');
});

test('mondayOf: all seven days of a week agree, and the next Monday starts the next week', () => {
  for (const day of [
    '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  ]) {
    assert.equal(mondayOf(day), '2026-09-28', day);
  }
  assert.equal(mondayOf('2026-10-05'), '2026-10-05');
});

test('mondayOf: crosses a year boundary and lands on a leap day', () => {
  assert.equal(mondayOf('2027-01-01'), '2026-12-28'); // a Friday
  assert.equal(mondayOf('2028-02-29'), '2028-02-28'); // a Tuesday, the leap day
});

test('mondayOnOrAfter: a Monday is itself, any other day rolls forward to the next', () => {
  assert.equal(mondayOnOrAfter('2026-10-05'), '2026-10-05'); // Monday
  assert.equal(mondayOnOrAfter('2026-10-01'), '2026-10-05'); // Thursday
  assert.equal(mondayOnOrAfter('2026-10-02'), '2026-10-05'); // Friday
  assert.equal(mondayOnOrAfter('2026-10-03'), '2026-10-05'); // Saturday
  assert.equal(mondayOnOrAfter('2026-10-04'), '2026-10-05'); // Sunday: the very next day
});

test('mondayOnOrAfter: crosses a year boundary and a leap day', () => {
  assert.equal(mondayOnOrAfter('2026-12-31'), '2027-01-04'); // a Thursday
  assert.equal(mondayOnOrAfter('2028-02-29'), '2028-03-06'); // a Tuesday
});

test('addDays adds and subtracts whole days across month, year and leap boundaries', () => {
  assert.equal(addDays('2026-09-14', 0), '2026-09-14');
  assert.equal(addDays('2026-09-14', 7), '2026-09-21');
  assert.equal(addDays('2026-09-14', -1), '2026-09-13');
  assert.equal(addDays('2026-09-14', 7 * 13), '2026-12-14');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29'); // leap year has the day
  assert.equal(addDays('2026-02-28', 1), '2026-03-01'); // and an ordinary one does not
});

// CI runs in UTC, where a calendar built on local time is indistinguishable from
// a correct one, so the zone is set here instead of hoped for. process.env.TZ is
// honoured at runtime; fn is synchronous, so restoring it in `finally` cannot
// leak into another test.
function inZone(tz, fn) {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

test('the calendar is UTC: the same answers in zones either side of UTC and across daylight saving', () => {
  // Two ways to get this wrong, and the zones below catch both. Read through a
  // local getter, a UTC-midnight Monday is a Sunday west of UTC. And arithmetic
  // done in local time lands an hour off midnight when US clocks change
  // (2026-03-08 and 2026-11-01), which can slide a day.
  const springAxis = ['2026-03-02', '2026-03-09', '2026-03-16'];
  const autumnAxis = ['2026-10-26', '2026-11-02', '2026-11-09'];
  for (const tz of [
    'UTC', 'America/Los_Angeles', 'America/New_York', 'Pacific/Auckland', 'Pacific/Pago_Pago', 'Pacific/Kiritimati',
  ]) {
    inZone(tz, () => {
      assert.equal(mondayOf('2026-09-14'), '2026-09-14', tz);
      assert.equal(mondayOf('2026-10-04'), '2026-09-28', tz);
      assert.equal(mondayOnOrAfter('2026-10-01'), '2026-10-05', tz);
      assert.equal(addDays('2026-03-07', 1), '2026-03-08', tz);
      assert.equal(addDays('2026-03-08', 1), '2026-03-09', tz);
      assert.equal(addDays('2026-10-31', 2), '2026-11-02', tz);
      assert.equal(mondayOf('2026-03-08'), '2026-03-02', tz);
      assert.equal(mondayOf('2026-11-01'), '2026-10-26', tz);
      assert.equal(mondayOnOrAfter('2026-03-08'), '2026-03-09', tz);
      assert.equal(weekLabel('2026-09-15'), 'wk of Sep 15', tz);
      // A marker's position must not stretch by an hour of the day when clocks change.
      assert.deepEqual(markerIndex('2026-03-10', springAxis), { index: 1 + 1 / 7, edge: false }, tz);
      assert.deepEqual(markerIndex('2026-11-04', autumnAxis), { index: 1 + 2 / 7, edge: false }, tz);
    });
  }
});

test('a date that is not a real ISO day is null, never an exception or a rolled-over date', () => {
  for (const bad of [
    null, undefined, '', 'tomorrow', '2026-9-4', '2026-02-30', '2026-13-01', '20260904',
    '2026-09-04T00:00:00Z', 20260904,
  ]) {
    assert.equal(mondayOf(bad), null, `mondayOf(${JSON.stringify(bad)})`);
    assert.equal(mondayOnOrAfter(bad), null, `mondayOnOrAfter(${JSON.stringify(bad)})`);
    assert.equal(addDays(bad, 1), null, `addDays(${JSON.stringify(bad)}, 1)`);
  }
  // n must be a real number of days: null would multiply to 0 and quietly hand
  // the same day back, '7' and true would coerce to 7 and 1.
  for (const badN of [NaN, undefined, null, '7', true, Infinity, -Infinity]) {
    assert.equal(addDays('2026-09-14', badN), null, `addDays(day, ${String(badN)})`);
  }
});

test('the edges of the calendar are null too: a result that cannot print as YYYY-MM-DD never throws', () => {
  assert.equal(addDays('2026-09-14', 1e12), null); // past the end of what a Date can hold
  assert.equal(addDays('2026-09-14', -1e12), null);
  assert.equal(addDays('9999-12-31', 1), null); // year 10000 would print with a sign
  // Date.UTC reads a year below 100 as 19xx, so '0050-06-15' would quietly become 1950.
  assert.equal(mondayOf('0050-06-15'), null);
});

// ── Rows to points ────────────────────────────────────────────────────────
const metric = (key) => WEEKLY_METRICS.find((m) => m.key === key);

// One row as admin_weekly_series returns it. The counts are synthetic.
const wide = (week_start, over = {}) => ({
  week_start,
  complete: true,
  settling: false,
  signups: 12,
  active_users: 30,
  active_measurable: true,
  work_users: 8,
  work_measurable: true,
  cards: 140,
  active_floor: '2026-07-06',
  work_floor: '2026-08-17',
  ...over,
});

test('the four weekly metrics are exactly what the trend read and the charts are told they are', () => {
  assert.deepEqual(WEEKLY_METRICS, [
    { key: 'signups', col: 'signups', label: 'Signups', family: 0, dispersion: 'poisson' },
    { key: 'active', col: 'active_users', label: 'Weekly active', family: 1, dispersion: 'poisson', measurableCol: 'active_measurable' },
    { key: 'work', col: 'work_users', label: 'Did real work', family: 1, dispersion: 'poisson', measurableCol: 'work_measurable' },
    { key: 'cards', col: 'cards', label: 'Cards created', family: 2, dispersion: 'mad' },
  ]);
});

test('every metric reads a column the definition-break list can name', () => {
  // breaksFor() matches a metric to its cuts by column name; a metric whose
  // column is not in this list could never be cut, whatever the data said.
  assert.deepEqual(WEEKLY_METRICS.map((m) => m.col), WEEKLY_SERIES_KEYS);
});

test('a wide row becomes one point per metric, carrying only what the trend needs', () => {
  const rows = [wide('2026-09-14')];
  const point = (value) => [
    { week: '2026-09-14', value, measurable: true, complete: true, settling: false },
  ];
  assert.deepEqual(toWeekPoints(rows, metric('signups')), point(12));
  assert.deepEqual(toWeekPoints(rows, metric('active')), point(30));
  assert.deepEqual(toWeekPoints(rows, metric('work')), point(8));
  assert.deepEqual(toWeekPoints(rows, metric('cards')), point(140));
});

test('a week before a counter existed is unmeasurable, and only for the counter that did not exist', () => {
  const rows = [wide('2026-07-27', { work_users: null, work_measurable: false })];
  assert.deepEqual(toWeekPoints(rows, metric('work')), [
    { week: '2026-07-27', value: null, measurable: false, complete: true, settling: false },
  ]);
  // The same row is perfectly measurable for everything that did exist.
  assert.equal(toWeekPoints(rows, metric('active'))[0].measurable, true);
  assert.equal(toWeekPoints(rows, metric('signups'))[0].measurable, true);
  assert.equal(toWeekPoints(rows, metric('cards'))[0].measurable, true);
  // And the flag of one counter never leaks into a metric that names no flag.
  const noActive = [wide('2026-06-01', { active_users: null, active_measurable: false })];
  assert.equal(toWeekPoints(noActive, metric('active'))[0].measurable, false);
  assert.equal(toWeekPoints(noActive, metric('signups'))[0].measurable, true);
});

test('a null on a measurable week is a gap that stays null; a real zero stays a zero', () => {
  const rows = [wide('2026-09-07', { signups: null }), wide('2026-09-14', { signups: 0 })];
  const [gap, zero] = toWeekPoints(rows, metric('signups'));
  assert.equal(gap.value, null, 'a null is not zero: Number(null) is 0, and that is the bug to avoid');
  assert.equal(gap.measurable, true);
  assert.equal(zero.value, 0, 'a zero-filled week is a measurement, not a gap');
});

test('rows come back oldest first, and the caller\'s array is left alone', () => {
  const rows = [wide('2027-01-04'), wide('2026-09-07'), wide('2026-12-28')];
  const before = rows.map((r) => r.week_start);
  assert.deepEqual(
    toWeekPoints(rows, metric('signups')).map((p) => p.week),
    ['2026-09-07', '2026-12-28', '2027-01-04'],
  );
  assert.deepEqual(rows.map((r) => r.week_start), before);
});

test('the partial-week and settling flags pass through; settling absent means not settling', () => {
  const partial = wide('2026-10-05', { complete: false, settling: true });
  assert.deepEqual(toWeekPoints([partial], metric('signups')), [
    { week: '2026-10-05', value: 12, measurable: true, complete: false, settling: true },
  ]);
  const noFlag = wide('2026-09-28');
  delete noFlag.settling;
  assert.equal(toWeekPoints([noFlag], metric('signups'))[0].settling, false);
});

test('anything that is not an array of rows is [] and does not throw', () => {
  const m = metric('signups');
  for (const junk of [null, undefined, 0, 7, 'rows', true, {}, { week_start: '2026-09-14' }]) {
    assert.deepEqual(toWeekPoints(junk, m), [], JSON.stringify(junk));
  }
  assert.deepEqual(toWeekPoints([], m), []);
});

test('rows with no usable week are dropped, and a list of nothing else is []', () => {
  const m = metric('signups');
  const junkRows = [null, undefined, 3, 'x', [], {}, { signups: 4 }, { week_start: 'soon' }, { week_start: '2026-02-30' }];
  assert.deepEqual(toWeekPoints(junkRows, m), []);
  // The good rows around a bad one survive it.
  const mixed = [wide('2026-09-14'), null, { signups: 4 }, wide('2026-09-21')];
  assert.deepEqual(toWeekPoints(mixed, m).map((p) => p.week), ['2026-09-14', '2026-09-21']);
});

test('without a metric to read there is nothing to return', () => {
  const rows = [wide('2026-09-14')];
  assert.deepEqual(toWeekPoints(rows), []);
  assert.deepEqual(toWeekPoints(rows, null), []);
  assert.deepEqual(toWeekPoints(rows, {}), []);
});

test('a row with only a week is an incomplete gap, so a half-formed row can never score', () => {
  assert.deepEqual(toWeekPoints([{ week_start: '2026-09-14' }], metric('signups')), [
    { week: '2026-09-14', value: null, measurable: true, complete: false, settling: false },
  ]);
});

test('a value that is not a finite number is a gap, never NaN or a string poisoning the sums', () => {
  for (const bad of ['12', 'abc', '', NaN, Infinity, {}, [], true]) {
    const [p] = toWeekPoints([wide('2026-09-14', { signups: bad })], metric('signups'));
    assert.equal(p.value, null, `value ${JSON.stringify(bad)}`);
  }
});

// ── Definition breaks ─────────────────────────────────────────────────────
// A cut point is a Monday. The trend read excludes every week that STARTS
// before it, so the week that straddles the change (which is half one
// definition and half the other) goes with the old side. That is why a break
// on a Thursday cuts at the NEXT Monday and not the one before it.
test('the did_work fix cuts the work series at the first Monday after it', () => {
  const fix = DEFINITION_BREAKS.find((b) => b.migration === '0347');
  assert.equal(fix.date, '2026-10-01'); // a Thursday: the week of 09-28 straddles it
  assert.deepEqual(breaksFor('work_users'), [
    { week: '2026-10-05', label: fix.label, migration: '0347' },
  ]);
});

test('a series with no cut has no cut points: a dated marker is not a cut', () => {
  assert.deepEqual(breaksFor('signups'), []);
  assert.deepEqual(breaksFor('cards'), []); // 0254 is real, but it is a marker (cut: false)
  assert.deepEqual(breaksFor('active_users'), []);
  assert.deepEqual(breaksFor('metrics_daily'), []);
  assert.deepEqual(breaksFor('not_a_series'), []);
});

test('an override list replaces the real one: empty turns every cut off, a relative one moves the Monday', () => {
  assert.deepEqual(breaksFor('work_users', []), []);

  const wed = { date: '2026-09-09', migration: '9999', series: ['work_users'], cut: true, label: 'synthetic' };
  assert.deepEqual(breaksFor('work_users', [wed]), [
    { week: '2026-09-14', label: 'synthetic', migration: '9999' },
  ]);
  // A cut that lands on a Monday keeps that Monday: the whole week is the new definition.
  assert.equal(breaksFor('work_users', [{ ...wed, date: '2026-09-14' }])[0].week, '2026-09-14');
  // A Sunday cuts at the very next day.
  assert.equal(breaksFor('work_users', [{ ...wed, date: '2026-09-13' }])[0].week, '2026-09-14');
});

test('only a cut that names the series asked for counts, and one entry can name several', () => {
  const entry = (migration, series, cut) => ({
    date: '2026-09-09', migration, series, cut, label: `entry ${migration}`,
  });
  const list = [
    entry('1001', ['work_users'], true),
    entry('1002', ['work_users'], false), // a marker only
    entry('1003', ['cards'], true),
    entry('1004', ['cards', 'work_users'], true), // one change, two series
  ];
  assert.deepEqual(breaksFor('work_users', list).map((b) => b.migration), ['1001', '1004']);
  assert.deepEqual(breaksFor('cards', list).map((b) => b.migration), ['1003', '1004']);
  assert.deepEqual(breaksFor('signups', list), []);
});

test('several cuts come back oldest first, whatever order they were listed in', () => {
  const list = [
    { date: '2026-09-23', migration: '2002', series: ['cards'], cut: true, label: 'later' },
    { date: '2026-09-02', migration: '2001', series: ['cards'], cut: true, label: 'earlier' },
  ];
  assert.deepEqual(breaksFor('cards', list).map((b) => b.week), ['2026-09-07', '2026-09-28']);
});

test('a cut is only ever an explicit true, and a malformed list degrades to no cuts, not an error', () => {
  const base = { date: '2026-09-09', migration: '3001', series: ['cards'], label: 'x' };
  // 'yes' and 1 are truthy; neither is a decision to cut.
  assert.deepEqual(breaksFor('cards', [{ ...base, cut: 'yes' }, { ...base, cut: 1 }, base]), []);
  // series must be a list: a bare string would substring-match ('cards'.includes('card')).
  assert.deepEqual(breaksFor('card', [{ ...base, series: 'cards', cut: true }]), []);
  // An entry whose date is not a day cannot be placed on a calendar.
  assert.deepEqual(breaksFor('cards', [{ ...base, date: 'soon', cut: true }]), []);
  assert.deepEqual(breaksFor('cards', [null, 3, 'x', {}, { cut: true }]), []);
  for (const notAList of [null, 'x', 7, {}]) {
    assert.deepEqual(breaksFor('cards', notAList), [], JSON.stringify(notAList));
  }
});

// ── Marker placement ──────────────────────────────────────────────────────
// Four Mondays, the last of which is the partial "this week". A day's column is
// its week's index plus the fraction of the way through the week it falls.
const AXIS = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05'];

test('a day lands a seventh of a column per day past its Monday', () => {
  assert.deepEqual(markerIndex('2026-09-14', AXIS), { index: 0, edge: false }); // the Monday itself
  assert.deepEqual(markerIndex('2026-09-17', AXIS), { index: 3 / 7, edge: false }); // Thursday
  assert.deepEqual(markerIndex('2026-09-20', AXIS), { index: 6 / 7, edge: false }); // Sunday, last day of week 0
  assert.deepEqual(markerIndex('2026-09-21', AXIS), { index: 1, edge: false }); // next Monday: exactly the next column
  assert.deepEqual(markerIndex('2026-09-24', AXIS), { index: 1 + 3 / 7, edge: false });
  assert.deepEqual(markerIndex('2026-09-28', AXIS), { index: 2, edge: false });
  assert.deepEqual(markerIndex('2026-10-04', AXIS), { index: 2 + 6 / 7, edge: false }); // last day before the partial week
});

test('anywhere inside the LAST week is one hollow point at the right rule', () => {
  // Clamped to the final column, not drawn a fraction of the way along it: the
  // partial week has no extent of its own to be a fraction of.
  for (const day of ['2026-10-05', '2026-10-08', '2026-10-11']) {
    assert.deepEqual(markerIndex(day, AXIS), { index: 3, edge: true }, day);
  }
});

test('before the first week or from the Monday after the last, there is nowhere to draw: null', () => {
  assert.equal(markerIndex('2026-09-13', AXIS), null); // the day before the first week
  assert.equal(markerIndex('2026-09-01', AXIS), null);
  assert.equal(markerIndex('2026-10-12', AXIS), null); // exactly last + 7
  assert.equal(markerIndex('2027-01-01', AXIS), null);
});

test('a one-week axis is all edge', () => {
  assert.deepEqual(markerIndex('2026-09-14', ['2026-09-14']), { index: 0, edge: true });
  assert.deepEqual(markerIndex('2026-09-20', ['2026-09-14']), { index: 0, edge: true });
  assert.equal(markerIndex('2026-09-21', ['2026-09-14']), null);
  assert.equal(markerIndex('2026-09-13', ['2026-09-14']), null);
});

test('a fourteen-week axis built the way the dashboard builds it, across month boundaries', () => {
  const weeks = Array.from({ length: 14 }, (_, i) => addDays('2026-07-06', 7 * i)); // ... 2026-10-05
  assert.equal(weeks.at(-1), '2026-10-05');
  assert.deepEqual(markerIndex('2026-09-17', weeks), { index: 10 + 3 / 7, edge: false });
  assert.deepEqual(markerIndex('2026-08-01', weeks), { index: 3 + 5 / 7, edge: false }); // Sat, week of 07-27
  assert.deepEqual(markerIndex('2026-07-06', weeks), { index: 0, edge: false });
  assert.equal(markerIndex('2026-07-05', weeks), null);
  assert.deepEqual(markerIndex('2026-10-11', weeks), { index: 13, edge: true });
  assert.equal(markerIndex('2026-10-12', weeks), null);
});

test('input that cannot be placed is null, not an exception or a NaN column', () => {
  assert.equal(markerIndex('soon', AXIS), null);
  assert.equal(markerIndex(null, AXIS), null);
  assert.equal(markerIndex('2026-09-17', []), null);
  assert.equal(markerIndex('2026-09-17', null), null);
  assert.equal(markerIndex('2026-09-17', 'weeks'), null);
  assert.equal(markerIndex('2026-09-17', ['nope', 'still-nope']), null);
});

test('an axis that is not consecutive weeks has no columns to measure against', () => {
  assert.equal(markerIndex('2026-09-17', ['2026-09-14', '2026-09-28']), null); // a week missing
  assert.equal(markerIndex('2026-09-17', ['2026-09-21', '2026-09-14']), null); // backwards
  assert.equal(markerIndex('2026-09-17', ['2026-09-14', '2026-09-14']), null); // a repeat
});

// ── Marker merging ────────────────────────────────────────────────────────
// Three sources feed one list: rows the database sends (notes and alerts),
// release notes, and the definition breaks. Each arrives in its own shape and
// leaves in one.
const NOTE = { day: '2026-09-17', kind: 'note', label: 'Newsletter went out', source: 'note', ref_id: 41 };
const OPS = { day: '2026-09-15', kind: 'alert', label: 'embed_backlog', source: 'ops', ref_id: null };
const DISCOVERY = { day: '2026-09-10', kind: 'alert', label: 'discovery_fetch (3 days)', source: 'discovery', ref_id: null };
const RELEASE = {
  date: '2026-09-12', anchor: '2026-09-12', title: 'A synthetic release',
  summary: 'What shipped that week.', headings: ['One', 'Two'],
};
const BREAK = {
  date: '2026-09-15', migration: '0327', series: ['metrics_daily'], cut: false,
  label: 'Money counters become trial-aware',
};

test('every source comes out in one shape, tagged with where it came from', () => {
  const out = mergeMarkers({ rpc: [NOTE], changelog: [RELEASE], breaks: [BREAK] });
  assert.deepEqual(out, [
    // changelog: the release note's title becomes the label; only the anchor rides along
    { day: '2026-09-12', kind: 'changelog', label: 'A synthetic release', source: 'changelog', anchor: '2026-09-12' },
    // break: tagged 'definition'; the series and migration ride along, the cut flag does not
    { day: '2026-09-15', kind: 'break', label: 'Money counters become trial-aware', source: 'definition', series: ['metrics_daily'], migration: '0327' },
    // rpc: already in marker shape, kept exactly as sent (ref_id included)
    { day: '2026-09-17', kind: 'note', label: 'Newsletter went out', source: 'note', ref_id: 41 },
  ]);
});

test('rows are ordered by day, then source, then label', () => {
  const note = (label) => ({ day: '2026-09-15', kind: 'note', label, source: 'note', ref_id: 1 });
  const out = mergeMarkers({
    rpc: [NOTE, note('B second'), OPS, note('A first'), DISCOVERY],
    changelog: [{ ...RELEASE, date: '2026-09-15' }],
    breaks: [BREAK],
  });
  assert.deepEqual(out.map((r) => [r.day, r.source, r.label]), [
    ['2026-09-10', 'discovery', 'discovery_fetch (3 days)'],
    ['2026-09-15', 'changelog', 'A synthetic release'],
    ['2026-09-15', 'definition', 'Money counters become trial-aware'],
    ['2026-09-15', 'note', 'A first'],
    ['2026-09-15', 'note', 'B second'],
    ['2026-09-15', 'ops', 'embed_backlog'],
    ['2026-09-17', 'note', 'Newsletter went out'],
  ]);
});

test('from and to are inclusive: a marker ON either edge is kept, one a day outside is not', () => {
  const rpc = [
    { day: '2026-09-09', kind: 'note', label: 'before', source: 'note', ref_id: 1 },
    { day: '2026-09-10', kind: 'note', label: 'on from', source: 'note', ref_id: 2 },
    { day: '2026-09-14', kind: 'note', label: 'inside', source: 'note', ref_id: 3 },
    { day: '2026-09-20', kind: 'note', label: 'on to', source: 'note', ref_id: 4 },
    { day: '2026-09-21', kind: 'note', label: 'after', source: 'note', ref_id: 5 },
  ];
  const labels = (opts) => mergeMarkers({ rpc, ...opts }).map((r) => r.label);
  assert.deepEqual(labels({ from: '2026-09-10', to: '2026-09-20' }), ['on from', 'inside', 'on to']);
  assert.deepEqual(labels({ from: '2026-09-14' }), ['inside', 'on to', 'after']);
  assert.deepEqual(labels({ to: '2026-09-14' }), ['before', 'on from', 'inside']);
  assert.deepEqual(labels({}), ['before', 'on from', 'inside', 'on to', 'after']);
  assert.deepEqual(labels({ from: '2026-09-22', to: '2026-09-30' }), []);
});

test('the window applies to every source, not just the database rows', () => {
  const out = mergeMarkers({
    rpc: [NOTE], changelog: [RELEASE], breaks: [BREAK],
    from: '2026-09-13', to: '2026-09-16',
  });
  assert.deepEqual(out.map((r) => r.source), ['definition']); // 09-12 and 09-17 are outside
});

test('what a source carries is preserved: ref_id (even null), anchor, series, migration, and unknown extras', () => {
  const out = mergeMarkers({
    rpc: [{ ...NOTE, extra: 'kept' }, OPS],
    changelog: [RELEASE],
    breaks: [BREAK],
  });
  const by = (source, label) => out.find((r) => r.source === source && (!label || r.label === label));
  assert.equal(by('note').ref_id, 41);
  assert.equal(by('note').extra, 'kept');
  assert.ok('ref_id' in by('ops') && by('ops').ref_id === null, 'a null ref_id is data, not absence');
  assert.equal(by('changelog').anchor, '2026-09-12');
  assert.deepEqual(by('definition').series, ['metrics_daily']);
  assert.equal(by('definition').migration, '0327');
});

test('every row carries a day, kind, label and source', () => {
  const out = mergeMarkers({ rpc: [NOTE, OPS, DISCOVERY], changelog: [RELEASE], breaks: DEFINITION_BREAKS });
  assert.equal(out.length, 3 + 1 + DEFINITION_BREAKS.length, 'nothing is dropped when there is no window');
  for (const r of out) {
    for (const key of ['day', 'kind', 'label', 'source']) {
      assert.equal(typeof r[key], 'string', `${JSON.stringify(r)} lacks ${key}`);
      assert.ok(r[key].length > 0, `${JSON.stringify(r)} has an empty ${key}`);
    }
  }
});

test('the real definition breaks and the real release notes both map cleanly', () => {
  const out = mergeMarkers({ changelog: CHANGELOG_ENTRIES, breaks: DEFINITION_BREAKS });
  assert.equal(out.length, CHANGELOG_ENTRIES.length + DEFINITION_BREAKS.length);
  for (const entry of CHANGELOG_ENTRIES) {
    const row = out.find((r) => r.source === 'changelog' && r.day === entry.date && r.label === entry.title);
    assert.ok(row, `release note ${entry.date} did not map`);
    assert.equal(row.anchor, entry.anchor);
  }
  // The window the weekly dashboard uses is a few weeks wide; spot-check the cut lands in it.
  const sept = mergeMarkers({ breaks: DEFINITION_BREAKS, from: '2026-09-01', to: '2026-10-01' });
  assert.deepEqual(sept.map((r) => r.migration), ['0294', '0327', '0332', '0347']);
});

test('merging leaves its inputs alone and hands back rows the caller may edit freely', () => {
  const rpc = [{ ...NOTE }, { ...OPS }];
  const snapshot = JSON.stringify(rpc);
  const out = mergeMarkers({ rpc, breaks: [BREAK] });
  assert.equal(JSON.stringify(rpc), snapshot, 'the input array and its rows are untouched');
  out.find((r) => r.source === 'note').label = 'edited';
  assert.equal(rpc[0].label, 'Newsletter went out', 'an output row is a copy, not the input row');
});

test('nothing, or junk, merges to no markers rather than an error', () => {
  assert.deepEqual(mergeMarkers(), []);
  assert.deepEqual(mergeMarkers({}), []);
  assert.deepEqual(mergeMarkers({ rpc: null, changelog: 'x', breaks: 7 }), []);
  // A marker with no real day cannot be placed on any axis, so it does not survive the merge.
  const junk = [null, 3, 'x', {}, { day: 'soon', kind: 'note', label: 'bad day', source: 'note' }];
  assert.deepEqual(mergeMarkers({ rpc: junk, changelog: junk, breaks: junk }), []);
});

// ── Labels ────────────────────────────────────────────────────────────────
test('weekLabel names a week by its Monday, in the short English the charts use', () => {
  assert.equal(weekLabel('2026-09-15'), 'wk of Sep 15');
  assert.equal(weekLabel('2026-09-07'), 'wk of Sep 7'); // no leading zero
  assert.equal(weekLabel('2026-10-05'), 'wk of Oct 5');
});

test('weekLabel gets all twelve months right', () => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  months.forEach((name, i) => {
    const iso = `2026-${String(i + 1).padStart(2, '0')}-15`;
    assert.equal(weekLabel(iso), `wk of ${name} 15`, iso);
  });
});

test('weekLabel of something that is not a day is empty, not "wk of undefined"', () => {
  for (const bad of [null, undefined, '', 'soon', '2026-02-30', '2026-9-15', 20260915]) {
    assert.equal(weekLabel(bad), '', JSON.stringify(bad));
  }
});

// ── The streak strip ──────────────────────────────────────────────────────
// streakSlots reads exactly two things off a trend read: verdict.code, and the
// per-week steps (oldest first). Steps start on Monday 2026-08-03.
//   dir  1 up, 0 flat, -1 down, null a week with no reading
const stepOf = (i, dir, settling = false) => ({
  week: addDays('2026-08-03', 7 * i),
  from: dir === null ? null : 10,
  to: dir === null ? 12 : 10 + 2 * dir,
  dir,
  settling,
});
const trendOf = (dirs, { code = 'rising', settlingLast = false } = {}) => ({
  verdict: { code },
  steps: dirs.map((dir, i) => stepOf(i, dir, settlingLast && i === dirs.length - 1)),
});
const states = (slots) => slots.map((x) => x.state);

test('seven steps fill seven slots, newest last, one state per direction', () => {
  const slots = streakSlots(trendOf([1, 1, -1, 1, 1, 1, 1]));
  assert.deepEqual(states(slots), ['up', 'up', 'down', 'up', 'up', 'up', 'up']);
});

test('fewer steps than slots are left-padded with unmeasured, so the newest week stays at the right', () => {
  const slots = streakSlots(trendOf([1, 0, -1, 1, 1]));
  assert.deepEqual(states(slots), [
    'unmeasured', 'unmeasured', 'up', 'flat', 'down', 'up', 'up',
  ]);
  assert.equal(slots.length, 7);
});

test('more steps than slots show only the newest', () => {
  const slots = streakSlots(trendOf([1, 1, 1, 1, 1, 1, 1, -1, 0]));
  assert.equal(slots.length, 7);
  assert.deepEqual(states(slots), ['up', 'up', 'up', 'up', 'up', 'down', 'flat']);
  // The window slid: it starts at the third step (week of Aug 17), not the first.
  assert.equal(slots[0].title, 'wk of Aug 17: 10 → 12');
  assert.equal(slots.at(-1).title, 'wk of Sep 28: 10 → 10');
});

test('too few weeks to read is all unmeasured, whatever steps happen to be there', () => {
  const slots = streakSlots(trendOf([1, 1, -1], { code: 'too_few', settlingLast: true }));
  assert.deepEqual(states(slots), Array(7).fill('unmeasured'));
  assert.ok(slots.every((x) => x.settling === false), 'an unmeasured slot is never drawn as settling');
});

test('settling comes from the step, so only the newest week is drawn as still moving', () => {
  const slots = streakSlots(trendOf([1, 1, 1, 1, 1, 1, 1], { settlingLast: true }));
  assert.deepEqual(slots.map((x) => x.settling), [false, false, false, false, false, false, true]);
  // Padding is never settling, even when the last real step is.
  const padded = streakSlots(trendOf([1, -1], { settlingLast: true }));
  assert.deepEqual(padded.map((x) => x.settling), [false, false, false, false, false, false, true]);
});

test('a week with no reading is a gap, in place, not a shortened strip', () => {
  const slots = streakSlots(trendOf([1, null, -1, 1, 1, 1, 1]));
  assert.deepEqual(states(slots), ['up', 'gap', 'down', 'up', 'up', 'up', 'up']);
  assert.equal(slots.length, 7);
});

test('a slot says which week it is and what it went from and to, for a week that has a reading', () => {
  const slots = streakSlots(trendOf([1, 0, -1]));
  assert.equal(slots[4].title, 'wk of Aug 3: 10 → 12'); // up
  assert.equal(slots[5].title, 'wk of Aug 10: 10 → 10'); // flat
  assert.equal(slots[6].title, 'wk of Aug 17: 10 → 8'); // down
});

test('a slot with nothing to report has an empty title (a string, never undefined)', () => {
  const slots = streakSlots(trendOf([1, null]));
  assert.equal(slots[0].title, ''); // padding
  assert.equal(slots[5].title, 'wk of Aug 3: 10 → 12'); // the one real step, for contrast
  assert.equal(slots[6].title, ''); // gap
});

test('the number of slots is the caller\'s to choose', () => {
  const trend = trendOf([1, 1, -1, 1, 1, 1, 1]);
  assert.deepEqual(states(streakSlots(trend, 4)), ['up', 'up', 'up', 'up']);
  assert.deepEqual(states(streakSlots(trend, 10)), [
    'unmeasured', 'unmeasured', 'unmeasured', 'up', 'up', 'down', 'up', 'up', 'up', 'up',
  ]);
  assert.deepEqual(streakSlots(trend, 0), []);
});

test('every padded slot is its own object, so one cannot be edited into another', () => {
  const [a, b] = streakSlots(trendOf([]));
  assert.notEqual(a, b);
});

test('a trend that is not there, or has no steps, is an all-unmeasured strip rather than an error', () => {
  const blank = Array(7).fill('unmeasured');
  assert.deepEqual(states(streakSlots(null)), blank);
  assert.deepEqual(states(streakSlots(undefined)), blank);
  assert.deepEqual(states(streakSlots({})), blank);
  assert.deepEqual(states(streakSlots({ verdict: { code: 'rising' }, steps: 'nope' })), blank);
  assert.deepEqual(states(streakSlots({ verdict: { code: 'rising' }, steps: [] })), blank);
});
