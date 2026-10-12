// clusterOpen — what App says when asked to open a cluster that isn't in the
// live boards map, and the wait that replaced navHandlers' fixed 200 ms.

import test from 'node:test';
import assert from 'node:assert/strict';
import { unopenableClusterNotice, waitUntil } from './clusterOpen.js';

test('a trashed cluster in this workspace says so and offers the Trash', () => {
  const n = unopenableClusterNotice({ workspace_id: 'w1', deleted_at: '2026-10-01T00:00:00Z' }, 'w1');
  assert.equal(n.message, 'That cluster is in the Trash.');
  assert.equal(n.openTrash, true);
});

test("a trashed cluster in another workspace says so, without a Trash button that would show this workspace's", () => {
  const n = unopenableClusterNotice({ workspace_id: 'w2', deleted_at: '2026-10-01T00:00:00Z' }, 'w1');
  assert.equal(n.message, 'That cluster is in the Trash.');
  assert.equal(n.openTrash, false);
});

test('no row (gone, or not yours to read) is "not available"', () => {
  const n = unopenableClusterNotice(null, 'w1');
  assert.match(n.message, /isn't available/);
  assert.equal(n.openTrash, false);
});

test('a live row the map does not hold is not called trashed', () => {
  const n = unopenableClusterNotice({ workspace_id: 'w1', deleted_at: null }, 'w1');
  assert.doesNotMatch(n.message, /Trash/);
});

// A fake clock: schedule() advances time instead of waiting.
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    schedule: (fn, ms) => { t += ms; queueMicrotask(fn); },
  };
}

test('waitUntil resolves true at once when already ready', async () => {
  const c = fakeClock();
  assert.equal(await waitUntil(() => true, c), true);
});

test('waitUntil resolves true when the condition turns true later', async () => {
  const c = fakeClock();
  let calls = 0;
  const ok = await waitUntil(() => ++calls >= 5, { ...c, interval: 50, timeout: 5000 });
  assert.equal(ok, true);
  assert.equal(calls, 5);
  assert.equal(c.now(), 200, 'polled every interval, no longer');
});

test('waitUntil gives up with false at the timeout', async () => {
  const c = fakeClock();
  const ok = await waitUntil(() => false, { ...c, interval: 50, timeout: 300 });
  assert.equal(ok, false);
  assert.equal(c.now(), 300);
});

test('a condition that throws counts as not ready, not as a crash', async () => {
  const c = fakeClock();
  let n = 0;
  const ok = await waitUntil(() => { if (++n < 3) throw new Error('not mounted'); return true; }, c);
  assert.equal(ok, true);
});
