// stuckSync.test.mjs — a watchdog that fires late because the device slept
// re-arms instead of reporting a stuck sync.
//
//   node --test src/lib/stuckSync.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stuckVerdict } from './stuckSync.js';

test('a watchdog that fires on time or a little late reports', () => {
  assert.equal(stuckVerdict(20_000, 20_000), 'report');
  assert.equal(stuckVerdict(31_000, 20_000), 'report');
  assert.equal(stuckVerdict(40_000, 20_000), 'report', 'exactly twice is still awake');
});

test('one that fires more than twice late was asleep, and re-arms', () => {
  assert.equal(stuckVerdict(40_001, 20_000), 'rearm');
  assert.equal(stuckVerdict(8 * 3_600_000, 20_000), 'rearm');
});
