// videoSync — autoplay clips on a board line up on one shared start time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  syncTarget, timeDiff, driftFix, earliestEpoch, offsetFromSamples,
  getBoardEpoch, setBoardEpoch, subscribeBoardEpoch, SEEK_OVER_S, NUDGE_RATE,
} from './videoSync.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('a board just opened puts every clip at its first frame', () => {
  assert.deepEqual(syncTarget({ now: 1000, epoch: 1000, dur: 8, loop: true }), { time: 0, ended: false });
  assert.deepEqual(syncTarget({ now: 1000, epoch: 1000, dur: 8, loop: false }), { time: 0, ended: false });
});

test('a loop wraps round; two viewers with the same epoch get the same frame', () => {
  near(syncTarget({ now: 21_500, epoch: 1_000, dur: 8, loop: true }).time, 4.5);   // 20.5s into an 8s loop
  const a = syncTarget({ now: 50_250, epoch: 1_000, dur: 6, loop: true });
  const b = syncTarget({ now: 50_250, epoch: 1_000, dur: 6, loop: true });
  assert.deepEqual(a, b);
});

test('a play-once clip holds its last frame once it is over, for everyone', () => {
  near(syncTarget({ now: 4_000, epoch: 1_000, dur: 8, loop: false }).time, 3);
  assert.deepEqual(syncTarget({ now: 20_000, epoch: 1_000, dur: 8, loop: false }), { time: 8, ended: true });
});

test('an epoch a little in the future (a fast clock) starts at zero, never negative', () => {
  assert.deepEqual(syncTarget({ now: 900, epoch: 1_000, dur: 8, loop: true }), { time: 0, ended: false });
});

test('no target until the duration and the epoch are both known', () => {
  assert.equal(syncTarget({ now: 1, epoch: null, dur: 8, loop: true }), null);
  assert.equal(syncTarget({ now: 1, epoch: 0, dur: NaN, loop: true }), null);
  assert.equal(syncTarget({ now: 1, epoch: 0, dur: Infinity, loop: true }), null);
  assert.equal(syncTarget({ now: 1, epoch: 0, dur: 0, loop: false }), null);
});

test('drift across a loop seam is measured the short way round', () => {
  near(timeDiff(0.1, 7.9, 8, true), 0.2);     // target just past the seam: 0.2s behind
  near(timeDiff(7.9, 0.1, 8, true), -0.2);    // 0.2s ahead
  near(timeDiff(3, 2.5, 8, true), 0.5);
  near(timeDiff(0.1, 7.9, 8, false), -7.8);   // no wrapping on a play-once clip
});

test('big drift jumps, small drift nudges the speed, tiny drift is left alone', () => {
  assert.deepEqual(driftFix(SEEK_OVER_S + 0.01), { seek: true });
  assert.deepEqual(driftFix(-2), { seek: true });
  assert.deepEqual(driftFix(0.2), { rate: 1 + NUDGE_RATE });     // behind: play a touch faster
  assert.deepEqual(driftFix(-0.2), { rate: 1 - NUDGE_RATE });    // ahead: a touch slower
  assert.deepEqual(driftFix(0.01), { rate: 1 });
  assert.deepEqual(driftFix(NaN), { rate: 1 });
});

test('a joiner takes the earliest epoch on the board', () => {
  assert.equal(earliestEpoch(5_000, [3_000, 9_000]), 3_000);
  assert.equal(earliestEpoch(2_000, [3_000]), 2_000);
  assert.equal(earliestEpoch(null, [7_000, null, NaN, 4_000]), 4_000);
  assert.equal(earliestEpoch(null, []), null);
});

test('the server clock offset comes from the quickest round trip', () => {
  // Device clock 10s behind the server. The 40ms trip wins over the 400ms one.
  const off = offsetFromSamples([
    { sent: 0, received: 400, t: 10_350 },
    { sent: 1_000, received: 1_040, t: 11_020 },
  ]);
  near(off, 11_020 + 20 - 1_040);   // 10_000
  assert.equal(offsetFromSamples([]), null);
  assert.equal(offsetFromSamples([{ sent: 0, received: 10, t: NaN }]), null);
});

test('each board keeps its own epoch and tells its listeners when it moves', () => {
  const seen = [];
  const off = subscribeBoardEpoch('b1', (v) => seen.push(v));
  setBoardEpoch('b1', 5_000);
  setBoardEpoch('b1', 5_000);           // unchanged: no call
  setBoardEpoch('b2', 9_000);           // another board: not ours
  setBoardEpoch('b1', 3_000);
  assert.deepEqual(seen, [5_000, 3_000]);
  assert.equal(getBoardEpoch('b1'), 3_000);
  assert.equal(getBoardEpoch('b2'), 9_000);
  off();
  setBoardEpoch('b1', null);
  assert.deepEqual(seen, [5_000, 3_000]);
  assert.equal(getBoardEpoch('b1'), null);
});
