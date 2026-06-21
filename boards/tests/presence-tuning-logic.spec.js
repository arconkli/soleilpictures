// Unit tests for the pure presence-tuning helpers (lib/presenceTuning.js).
// Pure functions, no page / sockets — runs straight in the Playwright node
// process. These pin the two invariants the "graceful degradation" design
// rests on: (1) the small-room case is byte-for-byte the historical behaviour,
// (2) costs ramp monotonically and stay capped as N grows.

import { expect, test } from '@playwright/test';
import {
  PRESENCE_TUNING,
  cursorIntervalForPeerCount,
  shouldBroadcastOwnCursor,
} from '../src/lib/presenceTuning.js';

test('cursor interval is the historical 16ms for a small room', () => {
  for (let n = 0; n <= PRESENCE_TUNING.CURSOR_SMALL_ROOM; n++) {
    expect(cursorIntervalForPeerCount(n)).toBe(PRESENCE_TUNING.CURSOR_MIN_MS);
  }
});

test('cursor interval ramps monotonically and saturates at the max', () => {
  let prev = -1;
  for (let n = 0; n <= 60; n++) {
    const v = cursorIntervalForPeerCount(n);
    expect(v).toBeGreaterThanOrEqual(prev); // non-decreasing
    expect(v).toBeGreaterThanOrEqual(PRESENCE_TUNING.CURSOR_MIN_MS);
    expect(v).toBeLessThanOrEqual(PRESENCE_TUNING.CURSOR_MAX_MS);
    prev = v;
  }
  expect(cursorIntervalForPeerCount(PRESENCE_TUNING.CURSOR_FULL_ROOM)).toBe(PRESENCE_TUNING.CURSOR_MAX_MS);
  expect(cursorIntervalForPeerCount(10_000)).toBe(PRESENCE_TUNING.CURSOR_MAX_MS);
});

test('cursor interval tolerates junk input (treated as zero peers)', () => {
  for (const bad of [undefined, null, NaN, -5, Infinity * -1]) {
    expect(cursorIntervalForPeerCount(bad)).toBe(PRESENCE_TUNING.CURSOR_MIN_MS);
  }
});

test('spectator hysteresis: enter high, leave low, no flapping on the seam', () => {
  const { SPECTATOR_ON, SPECTATOR_OFF } = PRESENCE_TUNING;
  // Quiet room: always broadcasting.
  expect(shouldBroadcastOwnCursor(1, true)).toBe(true);
  // Cross the ON threshold → stop.
  expect(shouldBroadcastOwnCursor(SPECTATOR_ON, true)).toBe(false);
  // Between OFF and ON while already silenced → STAY silenced (hysteresis).
  const mid = Math.floor((SPECTATOR_OFF + SPECTATOR_ON) / 2);
  expect(shouldBroadcastOwnCursor(mid, false)).toBe(false);
  // Same mid count but previously broadcasting → KEEP broadcasting.
  expect(shouldBroadcastOwnCursor(mid, true)).toBe(true);
  // Drop below OFF → resume.
  expect(shouldBroadcastOwnCursor(SPECTATOR_OFF - 1, false)).toBe(true);
});
