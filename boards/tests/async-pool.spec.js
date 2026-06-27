// Unit tests for the awaitable concurrency limiter (lib/asyncPool.js). Pure +
// dependency-free, so it runs straight in the Playwright Node process. This is
// the cap that stops a multi-image drop from decoding every photo at once and
// freezing iOS Safari, so the bound is the thing worth pinning down.

import { expect, test } from '@playwright/test';
import { makeLimiter } from '../src/lib/asyncPool.js';

test('never exceeds the concurrency cap', async () => {
  const limit = makeLimiter(2);
  let active = 0, peak = 0;
  await Promise.all(Array.from({ length: 8 }, () => limit(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, 10));
    active--;
  })));
  expect(peak).toBe(2);
});

test('a cap of 1 fully serializes', async () => {
  const limit = makeLimiter(1);
  let active = 0, peak = 0;
  await Promise.all(Array.from({ length: 5 }, () => limit(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, 4));
    active--;
  })));
  expect(peak).toBe(1);
});

test('runs every queued task and resolves with each result in order', async () => {
  const limit = makeLimiter(3);
  const out = await Promise.all(Array.from({ length: 10 }, (_, i) => limit(async () => i * 2)));
  expect(out).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
});

test('a throwing task rejects only its own promise and never wedges the pool', async () => {
  const limit = makeLimiter(2);
  await expect(limit(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  // The slot must be released — subsequent tasks still run.
  expect(await limit(async () => 'ok')).toBe('ok');
  let peak = 0, active = 0;
  await Promise.all(Array.from({ length: 6 }, () => limit(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, 3));
    active--;
  })));
  expect(peak).toBeLessThanOrEqual(2);
});

test('a non-positive cap is clamped to 1 (never 0, which would deadlock)', async () => {
  const limit = makeLimiter(0);
  expect(await limit(async () => 42)).toBe(42);
});
