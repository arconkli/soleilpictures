import test from 'node:test';
import assert from 'node:assert/strict';
import { togetherReduce, togetherShown, TOGETHER_OFF, TOGETHER_STALE_MS } from './togetherState.js';

const msg = (o = {}) => ({ on: true, peers: ['b'], boost: 1, earned: 0, month: 4, cap: 25, capped: false, progress: 0.3, ...o });

test('a first message starts a stretch', () => {
  const s = togetherReduce(TOGETHER_OFF, msg(), 1000);
  assert.equal(s.on, true);
  assert.equal(s.since, 1000);
  assert.equal(s.at, 1000);
  assert.equal(s.base, 0);
  assert.equal(s.earned, 0);
  assert.equal(s.startedCapped, false);
  assert.deepEqual(s.peers, ['b']);
});

test('the next message continues it', () => {
  const a = togetherReduce(TOGETHER_OFF, msg(), 1000);
  const b = togetherReduce(a, msg({ earned: 2, progress: 0.5, boost: 2 }), 61_000);
  assert.equal(b.since, 1000);
  assert.equal(b.at, 61_000);
  assert.equal(b.earned, 2);
  assert.equal(b.boost, 2);
  assert.equal(b.progress, 0.5);
});

test('a room that restarted keeps the count', () => {
  let s = togetherReduce(TOGETHER_OFF, msg(), 0);
  s = togetherReduce(s, msg({ earned: 3 }), 60_000);
  s = togetherReduce(s, msg({ earned: 1 }), 120_000);
  assert.equal(s.earned, 4);
  assert.equal(s.since, 0);
  s = togetherReduce(s, msg({ earned: 2 }), 180_000);
  assert.equal(s.earned, 5);
});

test('ended and null turn it off', () => {
  const s = togetherReduce(TOGETHER_OFF, msg(), 0);
  assert.equal(togetherReduce(s, { on: false }, 10), TOGETHER_OFF);
  assert.equal(togetherReduce(s, null, 10), TOGETHER_OFF);
});

test('a stale state starts a new stretch', () => {
  let s = togetherReduce(TOGETHER_OFF, msg({ earned: 3 }), 0);
  s = togetherReduce(s, msg({ earned: 4 }), TOGETHER_STALE_MS + 1);
  assert.equal(s.since, TOGETHER_STALE_MS + 1);
  assert.equal(s.earned, 4);
  assert.equal(s.base, 0);
});

test('startedCapped is only capped with nothing earned on the first message', () => {
  assert.equal(togetherReduce(TOGETHER_OFF, msg({ capped: true, month: 25 }), 0).startedCapped, true);
  assert.equal(togetherReduce(TOGETHER_OFF, msg({ capped: true, earned: 2 }), 0).startedCapped, false);
  let s = togetherReduce(TOGETHER_OFF, msg({ earned: 1 }), 0);
  s = togetherReduce(s, msg({ earned: 2, capped: true, month: 25 }), 60_000);
  assert.equal(s.startedCapped, false);
  assert.equal(togetherShown(s, 60_000), true);
  let c = togetherReduce(TOGETHER_OFF, msg({ capped: true }), 0);
  c = togetherReduce(c, msg({ capped: true }), 60_000);
  assert.equal(c.startedCapped, true);
});

test('togetherShown is false when off, stale or started capped', () => {
  const s = togetherReduce(TOGETHER_OFF, msg(), 0);
  assert.equal(togetherShown(s, 1000), true);
  assert.equal(togetherShown(s, TOGETHER_STALE_MS + 1), false);
  assert.equal(togetherShown(TOGETHER_OFF, 0), false);
  assert.equal(togetherShown(togetherReduce(TOGETHER_OFF, msg({ capped: true }), 0), 0), false);
});

test('a stretch that began capped shows once a new month lets it earn', () => {
  let s = togetherReduce(TOGETHER_OFF, msg({ capped: true, month: 25 }), 0);
  assert.equal(togetherShown(s, 0), false);
  s = togetherReduce(s, msg({ capped: false, month: 0, earned: 1 }), 60_000);
  assert.equal(s.startedCapped, false);
  assert.equal(togetherShown(s, 60_000), true);
  s = togetherReduce(s, msg({ capped: true, month: 25, earned: 9 }), 120_000);
  assert.equal(togetherShown(s, 120_000), true, 'capped again mid-stretch: it stays');
});
