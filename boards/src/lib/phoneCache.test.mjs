import test from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from './phoneCache.js';

function clock(start = 1000) {
  const c = { t: start, now: () => c.t, tick: (ms) => { c.t += ms; } };
  return c;
}
// A fetcher that answers each call with the next result (the last one repeats);
// an Error is thrown instead of returned.
function counted(results) {
  const f = { calls: 0 };
  f.fn = async () => {
    f.calls += 1;
    const r = results[Math.min(f.calls - 1, results.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  };
  return f;
}

test('concurrent callers share one in-flight fetch', async () => {
  const c = clock();
  const cache = createCache({ now: c.now });
  let release;
  let calls = 0;
  const fetcher = () => { calls += 1; return new Promise((res) => { release = () => res({ data: 7 }); }); };
  const a = cache.get('k', fetcher);
  const b = cache.get('k', fetcher);
  release();
  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.deepEqual(ra, rb);
  assert.equal(ra.data, 7);
  assert.equal(ra.stale, false);
  assert.equal(ra.error, null);
});

test('a fresh value inside the ttl is returned without fetching, and expires after it', async () => {
  const c = clock();
  const cache = createCache({ now: c.now });
  const f = counted([{ data: 1 }, { data: 2 }]);
  const first = await cache.get('k', f.fn, { ttl: 1000 });
  assert.equal(first.data, 1);
  c.tick(999);
  const hit = await cache.get('k', f.fn, { ttl: 1000 });
  assert.equal(hit.data, 1);
  assert.equal(hit.at, first.at);
  assert.equal(f.calls, 1);
  c.tick(1);
  const fresh = await cache.get('k', f.fn, { ttl: 1000 });
  assert.equal(fresh.data, 2);
  assert.equal(f.calls, 2);
});

test('ttl 0 always fetches', async () => {
  const c = clock();
  const cache = createCache({ now: c.now });
  const f = counted([{ data: 1 }, { data: 2 }]);
  await cache.get('k', f.fn, { ttl: 0 });
  const second = await cache.get('k', f.fn);
  assert.equal(second.data, 2);
  assert.equal(f.calls, 2);
});

test('force fetches inside the ttl', async () => {
  const c = clock();
  const cache = createCache({ now: c.now });
  const f = counted([{ data: 'a' }, { data: 'b' }]);
  await cache.get('k', f.fn, { ttl: 60000 });
  const forced = await cache.get('k', f.fn, { ttl: 60000, force: true });
  assert.equal(forced.data, 'b');
  assert.equal(f.calls, 2);
  const hit = await cache.get('k', f.fn, { ttl: 60000 });
  assert.equal(hit.data, 'b');
  assert.equal(f.calls, 2);
});

test('a failed fetch keeps the last good data, with the error and stale true', async () => {
  const c = clock();
  const cache = createCache({ now: c.now });
  const boom = { message: 'boom' };
  const f = counted([{ data: { n: 5 } }, { error: boom }]);
  const good = await cache.get('k', f.fn);
  c.tick(50);
  const bad = await cache.get('k', f.fn);
  assert.deepEqual(bad.data, { n: 5 });
  assert.equal(bad.error, boom);
  assert.equal(bad.stale, true);
  assert.equal(bad.at, good.at);
  assert.deepEqual(cache.peek('k'), { data: { n: 5 }, at: good.at, seeded: false });
});

test('a thrown fetch is handled the same way', async () => {
  const c = clock();
  const cache = createCache({ now: c.now });
  const err = new Error('network');
  const f = counted([{ data: 'ok' }, err]);
  await cache.get('k', f.fn);
  const bad = await cache.get('k', f.fn);
  assert.equal(bad.data, 'ok');
  assert.equal(bad.error, err);
  assert.equal(bad.stale, true);
});

test('a failure with nothing stored resolves null data and the error, and stores nothing', async () => {
  const cache = createCache({ now: clock().now });
  const f = counted([new Error('down'), { data: 3 }]);
  const bad = await cache.get('k', f.fn);
  assert.equal(bad.data, null);
  assert.equal(bad.error.message, 'down');
  assert.equal(bad.stale, false);
  assert.equal(cache.peek('k'), null);
  const ok = await cache.get('k', f.fn);
  assert.equal(ok.data, 3);
  assert.equal(ok.error, null);
});

test('a failed fetch does not poison the in-flight slot', async () => {
  const cache = createCache({ now: clock().now });
  const f = counted([{ error: { message: 'x' } }, { data: 9 }]);
  await cache.get('k', f.fn);
  const again = await cache.get('k', f.fn);
  assert.equal(again.data, 9);
  assert.equal(f.calls, 2);
});

test('keys are independent, and clear forgets values and ignores a fetch already in flight', async () => {
  const cache = createCache({ now: clock().now });
  await cache.get('a', async () => ({ data: 1 }), { ttl: 1000 });
  await cache.get('b', async () => ({ data: 2 }), { ttl: 1000 });
  assert.equal(cache.peek('a').data, 1);
  assert.equal(cache.peek('b').data, 2);
  cache.clear();
  assert.equal(cache.peek('a'), null);

  let release;
  const slow = cache.get('c', () => new Promise((res) => { release = () => res({ data: 'late' }); }));
  cache.clear();
  release();
  const r = await slow;
  assert.equal(r.data, 'late');
  assert.equal(cache.peek('c'), null);
});

test('a seed is stored only when the key holds nothing, and peek marks it', async () => {
  const c = clock();
  const cache = createCache({ now: c.now });
  assert.equal(cache.seed('k', { n: 1 }, 400), true);
  assert.deepEqual(cache.peek('k'), { data: { n: 1 }, at: 400, seeded: true });
  assert.equal(cache.seed('k', { n: 2 }, 500), false);
  assert.deepEqual(cache.peek('k').data, { n: 1 });
  // Nothing to paint is not a seed.
  assert.equal(cache.seed('empty', null, 400), false);
  assert.equal(cache.peek('empty'), null);

  await cache.get('fresh', async () => ({ data: 'live' }));
  assert.equal(cache.seed('fresh', 'old', 400), false);
  assert.equal(cache.peek('fresh').data, 'live');
  assert.equal(cache.peek('fresh').seeded, false);
});

test('get always fetches over a seed, even one younger than the ttl, and the fetch replaces it', async () => {
  const c = clock();
  const cache = createCache({ now: c.now });
  cache.seed('k', 'last visit', c.now());
  const f = counted([{ data: 'fresh' }]);
  const r = await cache.get('k', f.fn, { ttl: 60000 });
  assert.equal(f.calls, 1);
  assert.equal(r.data, 'fresh');
  assert.equal(r.stale, false);
  assert.deepEqual(cache.peek('k'), { data: 'fresh', at: c.now(), seeded: false });
  // Now it is a real value: inside the ttl it is served without fetching.
  c.tick(10);
  const hit = await cache.get('k', f.fn, { ttl: 60000 });
  assert.equal(hit.data, 'fresh');
  assert.equal(f.calls, 1);
});

test('a failed fetch keeps the seed: its data, the error, stale true, and it is still a seed', async () => {
  const c = clock(5000);
  const cache = createCache({ now: c.now });
  cache.seed('k', { n: 3 }, 1200);
  const boom = { message: 'boom' };
  const f = counted([{ error: boom }, new Error('again'), { data: { n: 4 } }]);
  const bad = await cache.get('k', f.fn, { ttl: 60000 });
  assert.deepEqual(bad, { data: { n: 3 }, error: boom, at: 1200, stale: true });
  assert.equal(cache.peek('k').seeded, true);
  // Still fetched over the next time, ttl or not.
  const worse = await cache.get('k', f.fn, { ttl: 60000 });
  assert.equal(worse.stale, true);
  assert.equal(f.calls, 2);
  const ok = await cache.get('k', f.fn, { ttl: 60000 });
  assert.deepEqual(ok.data, { n: 4 });
  assert.equal(cache.peek('k').seeded, false);
});

test('clear forgets seeds too, and a fetch in flight over a seed writes nothing back', async () => {
  const cache = createCache({ now: clock().now });
  cache.seed('a', 1, 10);
  let release;
  const slow = cache.get('a', () => new Promise((res) => { release = () => res({ data: 2 }); }));
  cache.clear();
  assert.equal(cache.peek('a'), null);
  release();
  await slow;
  assert.equal(cache.peek('a'), null);
  // Cleared, so a seed can go in again.
  assert.equal(cache.seed('a', 3, 20), true);
});
