// adminCohortWeeks.test.mjs — node --test src/lib/adminCohortWeeks.test.mjs
//
// The cohort matrix drew each cohort's in-progress week as a measured cell, so
// on a Monday the whole newest diagonal read as a collapse. weekComplete is the
// line between a measured week and one still being counted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekComplete, utcToday } from '../pages/admin/viz/cohortWeeks.js';

test('a week is complete from the day after its seventh day', () => {
  // Cohort week of Monday 2026-10-05: W0 is 10-05..10-11.
  assert.equal(weekComplete('2026-10-05', 0, '2026-10-11'), false);
  assert.equal(weekComplete('2026-10-05', 0, '2026-10-12'), true);
  assert.equal(weekComplete('2026-10-05', 1, '2026-10-12'), false);
  assert.equal(weekComplete('2026-09-28', 1, '2026-10-12'), true);
});

test('the current week of every cohort is incomplete', () => {
  const today = '2026-10-14'; // a Wednesday
  for (const [wk, off] of [['2026-10-12', 0], ['2026-10-05', 1], ['2026-07-20', 12]]) {
    assert.equal(weekComplete(wk, off, today), false, `${wk} W${off}`);
  }
});

test('a bad date is never called complete', () => {
  assert.equal(weekComplete('not a date', 0, '2026-10-12'), false);
});

test('today is the UTC calendar day', () => {
  assert.equal(utcToday(Date.parse('2026-10-12T23:30:00-05:00')), '2026-10-13');
});
