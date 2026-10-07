// adminDefinitionBreaks.test.mjs — node --test src/lib/adminDefinitionBreaks.test.mjs
//
// The list is data, so what is worth pinning is the shape the rest of the
// feature leans on without saying so: dates that compare correctly as plain
// strings (weeklySeries.js orders and windows them without parsing), migration
// numbers someone can grep for, series names the dashboard actually has, and
// exactly one cut.
//
// That last one matters most. A `cut` removes weeks from every trend that reads
// the series, so a second one added casually is a trend that quietly stops
// reading, and none at all is the one real discontinuity scored straight
// through. Both fail silently, which is why they are asserted here rather than
// left to review.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFINITION_BREAKS, WEEKLY_SERIES_KEYS } from './adminDefinitionBreaks.js';

// Every name a break may carry in `series`: the four weekly columns, plus the
// two feeds that have definition changes worth a marker but are not trended
// weekly (the raw event stream and the daily metrics table).
const KNOWN_SERIES = ['signups', 'active_users', 'work_users', 'cards', 'events', 'metrics_daily'];

// A real calendar day, not just something shaped like one: '2026-02-30' matches
// the pattern and would roll over to March in a naive Date.
function isRealIsoDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

test('every break is dated with a real ISO day, strictly oldest first', () => {
  assert.ok(DEFINITION_BREAKS.length > 0, 'an empty list would make every other test vacuous');
  for (const b of DEFINITION_BREAKS) {
    assert.ok(isRealIsoDay(b.date), `${b.migration}: ${JSON.stringify(b.date)} is not an ISO day`);
  }
  for (let i = 1; i < DEFINITION_BREAKS.length; i += 1) {
    const prev = DEFINITION_BREAKS[i - 1];
    const cur = DEFINITION_BREAKS[i];
    assert.ok(
      prev.date < cur.date,
      `${cur.migration} (${cur.date}) must come after ${prev.migration} (${prev.date})`,
    );
  }
});

test('every migration is a four-digit number that can be grepped for', () => {
  for (const b of DEFINITION_BREAKS) {
    assert.match(b.migration, /^\d{4}$/, `bad migration id ${JSON.stringify(b.migration)}`);
  }
});

test('every break names at least one series, all of them ones the dashboard has', () => {
  for (const b of DEFINITION_BREAKS) {
    assert.ok(Array.isArray(b.series) && b.series.length > 0, `${b.migration}: series must be a non-empty array`);
    for (const s of b.series) {
      assert.ok(KNOWN_SERIES.includes(s), `${b.migration}: unknown series ${JSON.stringify(s)}`);
    }
  }
});

test('every weekly series key is one a break can name', () => {
  assert.deepEqual(WEEKLY_SERIES_KEYS, ['signups', 'active_users', 'work_users', 'cards']);
  for (const key of WEEKLY_SERIES_KEYS) {
    assert.ok(KNOWN_SERIES.includes(key), `${key} is trended weekly but no break could ever name it`);
  }
});

test('exactly one break cuts the trend, and it is the did_work stamping fix', () => {
  // `cut` is read with === true, so anything that is not a real boolean is a
  // cut that silently never happens.
  for (const b of DEFINITION_BREAKS) {
    assert.equal(typeof b.cut, 'boolean', `${b.migration}: cut must be a boolean`);
  }
  const cuts = DEFINITION_BREAKS.filter((b) => b.cut);
  assert.equal(cuts.length, 1, 'one discontinuity makes weeks incomparable; more needs a reason written down');
  assert.equal(cuts[0].migration, '0347');
  assert.deepEqual(cuts[0].series, ['work_users']);
});

test('a cut targets a series that is trended weekly, or it could never cut anything', () => {
  for (const b of DEFINITION_BREAKS.filter((x) => x.cut)) {
    assert.ok(
      b.series.some((s) => WEEKLY_SERIES_KEYS.includes(s)),
      `${b.migration} cuts ${b.series.join(', ')}, none of which is a weekly series`,
    );
  }
});

test('labels are short enough to sit on a chart and never empty', () => {
  for (const b of DEFINITION_BREAKS) {
    assert.equal(typeof b.label, 'string', `${b.migration}: label must be a string`);
    assert.ok(b.label.trim().length > 0, `${b.migration}: label is empty`);
    assert.ok(b.label.length <= 80, `${b.migration}: label is ${b.label.length} chars, limit 80`);
  }
});
