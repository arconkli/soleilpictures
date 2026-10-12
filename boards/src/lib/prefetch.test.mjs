// prefetch.js — the result cache is capped and evicts expired entries, and
// the idle lane stops growing once the user has interacted (PERF-11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  prefetch, peek, firstInteraction, prefetchCacheSize, idleQueueLength, prefetchDebug, CACHE_MAX,
} from './prefetch.js';

const here = dirname(fileURLToPath(import.meta.url));

test('the cache never holds more than CACHE_MAX results, dropping the least recently used', async () => {
  for (let i = 0; i < CACHE_MAX + 20; i++) await prefetch(`k:${i}`, async () => i, { cacheTtl: 60_000 });
  assert.equal(prefetchCacheSize(), CACHE_MAX);
  assert.equal(peek('k:0'), null, 'the oldest went first');
  assert.equal(peek(`k:${CACHE_MAX + 19}`), CACHE_MAX + 19);
});

test('an expired result is evicted when it is looked at', async () => {
  const before = prefetchCacheSize();
  await prefetch('short', async () => 'v', { cacheTtl: 1 });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(peek('short'), null);
  assert.ok(prefetchCacheSize() <= before, 'the dead entry is gone, not just skipped');
});

test('after the first interaction the idle lane enqueues nothing', async () => {
  firstInteraction();
  const n = idleQueueLength();
  for (let i = 0; i < 20; i++) await prefetch(`idle:${i}`, async () => i, { lane: 'idle' });
  assert.equal(idleQueueLength(), n);
});

test('logging is off outside dev unless asked for', () => {
  assert.equal(prefetchDebug(), false, 'no window in node');
  const hook = readFileSync(join(here, '..', 'hooks', 'useIdlePrefetch.js'), 'utf8');
  assert.match(hook, /if \(prefetchDebug\(\)\)/);
  assert.match(hook, /\}, \[picksKey\]\);/, 're-runs on the top-N ids, not every boards refresh');
});
