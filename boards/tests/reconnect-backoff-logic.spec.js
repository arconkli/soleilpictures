// Unit tests for the pure reconnect-backoff helpers (lib/reconnectBackoff.js).
// rng is dependency-injected, so these are fully deterministic and run in the
// Playwright node process with no sockets. They prove the herd-spreading
// property a deploy/reset relies on: across many clients (many rng draws) the
// reconnect delays fan out across the window rather than landing together.

import { expect, test } from '@playwright/test';
import { spreadDelayMs, backoffWithJitter } from '../src/lib/reconnectBackoff.js';
import { PRESENCE_TUNING } from '../src/lib/presenceTuning.js';

const { RECONNECT_JITTER_MIN_MS: MIN, RECONNECT_JITTER_MAX_MS: MAX } = PRESENCE_TUNING;

test('spreadDelayMs maps the rng range onto [min, max]', () => {
  expect(spreadDelayMs({ rng: () => 0 })).toBe(MIN);
  expect(spreadDelayMs({ rng: () => 1 })).toBe(MAX);
  expect(spreadDelayMs({ rng: () => 0.5 })).toBe(Math.round(MIN + 0.5 * (MAX - MIN)));
});

test('spreadDelayMs clamps out-of-range rng output', () => {
  expect(spreadDelayMs({ rng: () => -1 })).toBe(MIN);
  expect(spreadDelayMs({ rng: () => 5 })).toBe(MAX);
  expect(spreadDelayMs({ rng: () => NaN })).toBe(MIN);
});

test('a simulated herd of clients fans out across the window', () => {
  // Deterministic pseudo-rng so the test is stable.
  let seed = 12345;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const N = 200;
  const delays = Array.from({ length: N }, () => spreadDelayMs({ rng }));
  // Every delay is inside the window...
  for (const d of delays) { expect(d).toBeGreaterThanOrEqual(MIN); expect(d).toBeLessThanOrEqual(MAX); }
  // ...and they actually spread: no single 200ms bucket holds more than ~40%
  // of the herd (a lockstep schedule would pile everyone into one bucket).
  const buckets = new Map();
  for (const d of delays) { const b = Math.floor(d / 200); buckets.set(b, (buckets.get(b) || 0) + 1); }
  const maxBucket = Math.max(...buckets.values());
  expect(maxBucket).toBeLessThan(N * 0.4);
  expect(buckets.size).toBeGreaterThan(3);
});

test('backoffWithJitter: attempt 0 is already spread across [0, base]', () => {
  expect(backoffWithJitter(0, { rng: () => 0 })).toBe(0);
  expect(backoffWithJitter(0, { rng: () => 1 })).toBe(MIN); // base defaults to MIN
});

test('backoffWithJitter grows with attempt but never exceeds the cap', () => {
  const full = (a) => backoffWithJitter(a, { rng: () => 1 }); // upper edge per attempt
  let prev = -1;
  for (let a = 0; a <= 20; a++) {
    const v = full(a);
    expect(v).toBeGreaterThanOrEqual(prev); // non-decreasing ceiling
    expect(v).toBeLessThanOrEqual(MAX);
    prev = v;
  }
  expect(full(20)).toBe(MAX); // saturated
});

test('backoffWithJitter tolerates junk attempt values', () => {
  for (const bad of [undefined, null, NaN, -3]) {
    const v = backoffWithJitter(bad, { rng: () => 0.5 });
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(MAX);
  }
});
