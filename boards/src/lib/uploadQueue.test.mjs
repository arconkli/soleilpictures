// Message uploads run a few at a time, in the order they were dropped, and a
// failure doesn't hold up the rest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTaskQueue, UPLOAD_CONCURRENCY } from './uploadQueue.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

test('no more than the limit run at once, and they start in order', async () => {
  const q = createTaskQueue(3);
  const started = [];
  const releases = [];
  let peak = 0;
  const jobs = Array.from({ length: 7 }, (_, i) => q.run(() => new Promise((resolve) => {
    started.push(i);
    peak = Math.max(peak, q.running);
    releases[i] = () => resolve(i);
  })));
  await tick();
  assert.deepEqual(started, [0, 1, 2]);
  assert.equal(q.waiting, 4);
  releases[1]();
  await tick(); await tick();
  assert.deepEqual(started, [0, 1, 2, 3], 'one lands, the next starts');
  for (let i = 0; i < 7; i += 1) { releases[i]?.(); await tick(); await tick(); }
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(peak, 3);
  assert.equal(UPLOAD_CONCURRENCY, 3);
});

test('a task that throws rejects its own promise and the queue goes on', async () => {
  const q = createTaskQueue(1);
  const bad = q.run(() => { throw new Error('nope'); });
  const good = q.run(() => 'fine');
  await assert.rejects(bad, /nope/);
  assert.equal(await good, 'fine');
  await tick();
  assert.equal(q.running, 0);
});
