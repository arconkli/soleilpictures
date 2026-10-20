// formatDurationPrecise: two units, so a profile's time in app says 1h 29m
// rather than rounding it to "1h" the way the one-token ticker format does.

import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration, formatDurationPrecise } from './formatDuration.js';

test('two units, largest first', () => {
  assert.equal(formatDurationPrecise(1 * 3600 + 29 * 60 + 12), '1h 29m');
  assert.equal(formatDurationPrecise(3 * 86400 + 4 * 3600 + 5), '3d 4h');
  assert.equal(formatDurationPrecise(400 * 86400), '1y 1mo');
  assert.equal(formatDurationPrecise(61), '1m 1s');
});

test('a single unit when that is all there is, or the second is zero', () => {
  assert.equal(formatDurationPrecise(45), '45s');
  assert.equal(formatDurationPrecise(0), '0s');
  assert.equal(formatDurationPrecise(2 * 86400), '2d');
  assert.equal(formatDurationPrecise(3600 + 7), '1h');
});

test('junk input reads as zero, never NaN', () => {
  assert.equal(formatDurationPrecise(null), '0s');
  assert.equal(formatDurationPrecise(undefined), '0s');
  assert.equal(formatDurationPrecise('abc'), '0s');
  assert.equal(formatDurationPrecise(-30), '0s');
});

test('the ticker format is unchanged, and is the one that rounds', () => {
  assert.equal(formatDuration(1 * 3600 + 29 * 60), '1h');
});
