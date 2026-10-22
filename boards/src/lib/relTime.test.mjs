// Message times say how long ago, and one shared clock keeps them moving.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRelTime } from './relTime.js';
import { subscribeMinute, minuteListenerCount } from './minuteTick.js';

const NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const ago = (sec) => new Date(NOW - sec * 1000).toISOString();

test('just now, minutes, hours, days, then the date', () => {
  assert.equal(formatRelTime(ago(5), NOW), 'just now');
  assert.equal(formatRelTime(ago(59), NOW), 'just now', 'no seconds that the shared clock could not keep up with');
  assert.equal(formatRelTime(ago(-30), NOW), 'just now', 'a clock a little ahead of ours');
  assert.equal(formatRelTime(ago(5 * 60), NOW), '5m ago');
  assert.equal(formatRelTime(ago(3 * 3600), NOW), '3h ago');
  assert.equal(formatRelTime(ago(2 * 86400), NOW), '2d ago');
  assert.match(formatRelTime(ago(30 * 86400), NOW), /Sep/);
  assert.equal(formatRelTime(null, NOW), '');
  assert.equal(formatRelTime('nonsense', NOW), '');
});

test('one timer while anything listens, none after', () => {
  const offA = subscribeMinute(() => {});
  const offB = subscribeMinute(() => {});
  assert.equal(minuteListenerCount(), 2);
  offA(); offB();
  assert.equal(minuteListenerCount(), 0);
});
