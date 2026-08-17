// analyticsQueue.test.mjs — the delivery rules that decide whether an event
// survives.
//
//   node --test src/lib/analyticsQueue.test.mjs
//
// Every case here corresponds to a way the previous implementation lost data
// without saying so. The point of the module is that loss becomes countable;
// the point of these tests is that the counts are right, because a wrong count
// is just silent loss with extra steps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beaconChunks, backoffFor, pruneStale, capQueue, partitionRetries, wireRow,
  FLUSH_INTERVAL_MS, BACKOFF_MS, MAX_ATTEMPTS, MAX_ROW_AGE_MS,
} from './analyticsQueue.js';

const NOW = 1_760_000_000_000;
const row = (event, at = NOW, extra = {}) => ({
  event, occurred_at: new Date(at).toISOString(), props: {}, ...extra,
});

// ── chunking ───────────────────────────────────────────────────────────

test('a small batch goes out as a single chunk', () => {
  const rows = [row('a'), row('b'), row('c')];
  const chunks = beaconChunks(rows, 50_000);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 3);
});

test('chunks stay under the byte cap and lose nothing', () => {
  const rows = Array.from({ length: 200 }, (_, i) => row(`e${i}`, NOW, { pad: 'x'.repeat(300) }));
  const cap = 5_000;
  const chunks = beaconChunks(rows, cap);

  assert.ok(chunks.length > 1, 'a 200-row batch must actually split');
  for (const c of chunks) {
    assert.ok(JSON.stringify(c).length <= cap + 64,
      `chunk of ${JSON.stringify(c).length}b exceeds the ${cap}b cap`);
  }
  assert.equal(chunks.flat().length, rows.length, 'every row is in exactly one chunk');
  assert.deepEqual(chunks.flat().map((r) => r.event), rows.map((r) => r.event), 'order preserved');
});

test('a single oversized row is still sent, alone', () => {
  const rows = [row('small'), row('huge', NOW, { pad: 'x'.repeat(80_000) }), row('after')];
  const chunks = beaconChunks(rows, 5_000);
  assert.equal(chunks.flat().length, 3, 'nothing is discarded for being too big');
  const huge = chunks.find((c) => c.some((r) => r.event === 'huge'));
  assert.equal(huge.length, 1, 'the oversized row is not dragging neighbours down with it');
});

test('an empty batch produces no requests', () => {
  assert.deepEqual(beaconChunks([], 5_000), []);
});

// ── backoff ────────────────────────────────────────────────────────────

test('backoff is the normal interval while healthy, then escalates', () => {
  assert.equal(backoffFor(0), FLUSH_INTERVAL_MS);
  assert.equal(backoffFor(1), BACKOFF_MS[0]);
  assert.equal(backoffFor(3), BACKOFF_MS[2]);
});

test('backoff saturates instead of running off the end of the table', () => {
  const last = BACKOFF_MS[BACKOFF_MS.length - 1];
  assert.equal(backoffFor(BACKOFF_MS.length), last);
  assert.equal(backoffFor(999), last, 'a long outage must not produce undefined');
  assert.ok(Number.isFinite(backoffFor(999)));
});

// ── ageing ─────────────────────────────────────────────────────────────

test('pruneStale keeps fresh rows and counts what it drops', () => {
  const rows = [
    row('fresh', NOW - 1000),
    row('old', NOW - MAX_ROW_AGE_MS - 1),
    row('edge', NOW - MAX_ROW_AGE_MS + 1000),
  ];
  const { kept, dropped } = pruneStale(rows, NOW);
  assert.deepEqual(kept.map((r) => r.event), ['fresh', 'edge']);
  assert.equal(dropped, 1, 'the drop is reported, not swallowed');
});

test('pruneStale rejects malformed rows rather than shipping them', () => {
  const rows = [row('ok'), null, { event: 'no-date' }, { occurred_at: new Date(NOW).toISOString() }];
  const { kept, dropped } = pruneStale(rows, NOW);
  assert.deepEqual(kept.map((r) => r.event), ['ok']);
  assert.equal(dropped, 3);
});

test('pruneStale tolerates a non-array (corrupt localStorage)', () => {
  assert.deepEqual(pruneStale(null, NOW), { kept: [], dropped: 0 });
  assert.deepEqual(pruneStale('{"rows":1}', NOW), { kept: [], dropped: 0 });
});

// ── the cap ────────────────────────────────────────────────────────────

test('capQueue drops the OLDEST rows, keeping the most recent', () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(`e${i}`));
  const { kept, dropped } = capQueue(rows, 4);
  assert.equal(dropped, 6);
  assert.deepEqual(kept.map((r) => r.event), ['e6', 'e7', 'e8', 'e9']);
});

test('capQueue is a no-op under the ceiling', () => {
  const rows = [row('a'), row('b')];
  const { kept, dropped } = capQueue(rows, 10);
  assert.equal(dropped, 0);
  assert.equal(kept, rows, 'no needless copy');
});

// ── retries ────────────────────────────────────────────────────────────

test('a failing batch is retried until its attempts are exhausted', () => {
  let batch = [row('a'), row('b')];
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    const { retry, exhausted } = partitionRetries(batch);
    assert.equal(exhausted, 0, `attempt ${i} should still be retryable`);
    assert.equal(retry.length, 2);
    batch = retry;
  }
  const final = partitionRetries(batch);
  assert.equal(final.retry.length, 0, 'it gives up rather than blocking the queue forever');
  assert.equal(final.exhausted, 2, 'and says how many it gave up on');
});

test('a row that has succeeded before carries no attempt count', () => {
  const r = row('a');
  assert.equal(r._try, undefined);
  partitionRetries([r]);
  assert.equal(r._try, 1);
});

// ── the wire ───────────────────────────────────────────────────────────

test('wireRow strips the retry counter, which is not a column', () => {
  const r = { ...row('a'), _try: 3 };
  const wire = wireRow(r);
  assert.equal('_try' in wire, false,
    'PostgREST rejects unknown columns — sending _try would make a transient failure permanent');
  assert.equal(wire.event, 'a');
  assert.equal(wire.occurred_at, r.occurred_at);
});

test('wireRow leaves an untouched row alone, by identity', () => {
  const r = row('a');
  assert.equal(wireRow(r), r, 'the common path allocates nothing');
});

test('a batch round-trips through partitionRetries and wireRow cleanly', () => {
  const batch = [row('a'), row('b')];
  partitionRetries(batch);
  const wire = batch.map(wireRow);
  for (const w of wire) {
    assert.deepEqual(Object.keys(w).sort(), ['event', 'occurred_at', 'props']);
  }
});
