// refetchQueue.test.mjs: the realtime refetch pattern (SHARE-10).
//   cd boards && node --test src/lib/refetchQueue.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefetchQueue } from './refetchQueue.js';

// A fetch whose resolution the test controls, one deferred per call.
function controlledFetch() {
  const calls = [];
  const fetchRows = () => new Promise((resolve, reject) => { calls.push({ resolve, reject }); });
  return { calls, fetchRows };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('an event during a refetch is not dropped: one trailing refetch follows', async () => {
  const { calls, fetchRows } = controlledFetch();
  const applied = [];
  const q = createRefetchQueue(fetchRows, (rows) => applied.push(rows));
  q.request();
  await tick();
  assert.equal(calls.length, 1);
  q.request();          // a second comment lands while the first refetch runs
  q.request();          // and a third: still only one trailing run
  await tick();
  assert.equal(calls.length, 1, 'never two refetches at once');
  calls[0].resolve(['a']);
  await tick(); await tick();
  assert.deepEqual(applied, [['a']]);
  assert.equal(calls.length, 2, 'the trailing refetch ran, so the later writes show');
  calls[1].resolve(['a', 'b', 'c']);
  await tick(); await tick();
  assert.deepEqual(applied.at(-1), ['a', 'b', 'c']);
  assert.equal(calls.length, 2, 'and nothing more after it');
});

test('after stop(), a late result is never applied (board A over board B)', async () => {
  const { calls, fetchRows } = controlledFetch();
  const applied = [];
  const q = createRefetchQueue(fetchRows, (rows) => applied.push(rows));
  q.request();
  await tick();
  q.request();          // queued trailing run
  q.stop();             // the effect cleaned up: the board changed
  calls[0].resolve(['from board A']);
  await tick(); await tick();
  assert.deepEqual(applied, [], "board A's refetch landed after the switch and was ignored");
  assert.equal(calls.length, 1, 'and the trailing run did not start');
  q.request();
  await tick();
  assert.equal(calls.length, 1, 'a stopped queue starts nothing');
});

test('a failed refetch reports, keeps the list, and still runs the trailing one', async () => {
  const { calls, fetchRows } = controlledFetch();
  const applied = []; const errors = [];
  const q = createRefetchQueue(fetchRows, (rows) => applied.push(rows), (e) => errors.push(e));
  q.request();
  await tick();
  q.request();
  calls[0].reject(new Error('offline'));
  await tick(); await tick();
  assert.equal(errors.length, 1);
  assert.deepEqual(applied, []);
  assert.equal(calls.length, 2);
  calls[1].resolve(['ok']);
  await tick(); await tick();
  assert.deepEqual(applied, [['ok']]);
});

test('a fetch that throws synchronously is reported, not thrown into the event handler', async () => {
  const errors = [];
  const q = createRefetchQueue(() => { throw new Error('boom'); }, () => {}, (e) => errors.push(e));
  assert.doesNotThrow(() => q.request());
  await tick(); await tick();
  assert.equal(errors.length, 1);
});
