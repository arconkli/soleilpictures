// Frame / second / timecode arithmetic (lib/timecode.js). Off-by-one frames
// are the bug a film tool can't have; these pin every rounding choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  snapFps, toRate, nominalRate, canDropFrame, timeToFrame, frameStart, frameCentre, frameCount,
  frameToTC, tcToFrame, parseJump,
} from './timecode.js';

const R2398 = [24000, 1001];
const R2997 = [30000, 1001];
const R5994 = [60000, 1001];

test('snapping measured or container rates to standard ones', () => {
  assert.deepEqual(snapFps(23.976), R2398);
  assert.deepEqual(snapFps(23.9760001), R2398);
  assert.deepEqual(snapFps(29.97), R2997);
  assert.deepEqual(snapFps(25.0004), [25, 1]);
  assert.deepEqual(snapFps(24000, 1001), R2398);
  assert.deepEqual(snapFps(90000, 3750), [24, 1]);       // timescale / delta
  assert.deepEqual(snapFps(1000, 37), [1000, 37]);       // odd but exact: kept
  assert.equal(snapFps(0), null);
  assert.deepEqual(toRate(25), [25, 1]);
  assert.deepEqual(toRate([25, 1]), [25, 1]);
  assert.equal(nominalRate(R2398), 24);
  assert.equal(nominalRate(R2997), 30);
  assert.equal(canDropFrame(R2997), true);
  assert.equal(canDropFrame(R5994), true);
  assert.equal(canDropFrame([30, 1]), false);
  assert.equal(canDropFrame(R2398), false);
});

test('a time maps to the frame on screen, and seeking aims at a frame\'s centre', () => {
  assert.equal(timeToFrame(0, [24, 1]), 0);
  assert.equal(timeToFrame(1 / 24 - 1e-9, [24, 1]), 1);    // within float noise of the edge: the next frame
  assert.equal(timeToFrame(1 / 24 + 0.001, [24, 1]), 1);
  assert.equal(timeToFrame(1.0, R2398), 23);                // 23.976 frames in a second
  assert.equal(timeToFrame(1001 / 24000 * 100, R2398), 100);
  assert.equal(timeToFrame(-1, [24, 1]), 0);
  // With a start offset t0.
  assert.equal(timeToFrame(0.5 + 2 / 24, [24, 1], 0.5), 2);
  // Every frame centre maps back to its own frame — across a long clip, at awkward rates.
  for (const r of [[24, 1], [25, 1], R2398, R2997, R5994]) {
    for (const n of [0, 1, 2, 999, 100000, 215999]) {
      assert.equal(timeToFrame(frameCentre(n, r), r), n, `rate ${r} frame ${n}`);
      assert.equal(timeToFrame(frameStart(n, r) + 1e-7, r), n);
    }
  }
  // The last frame's centre never seeks past the end.
  assert.ok(frameCentre(239, [24, 1], 0, 10) < 10);
  assert.equal(frameCount(10, [24, 1]), 240);
  assert.equal(frameCount(10.01, R2398), 240);
});

test('non-drop timecode', () => {
  assert.equal(frameToTC(0, [24, 1]), '00:00:00:00');
  assert.equal(frameToTC(23, [24, 1]), '00:00:00:23');
  assert.equal(frameToTC(24, [24, 1]), '00:00:01:00');
  assert.equal(frameToTC(24 * 3600, [24, 1]), '01:00:00:00');
  assert.equal(frameToTC(25 * 61 + 3, [25, 1]), '00:01:01:03');
  // 23.976 counts 24 frames per timecode second.
  assert.equal(frameToTC(24, R2398), '00:00:01:00');
  // A start timecode is added first.
  assert.equal(frameToTC(5, [24, 1], { start: 24 * 3600 }), '01:00:00:05');
  // Wraps at 24 hours, as a timecode does.
  assert.equal(frameToTC(24 * 3600 * 24, [24, 1]), '00:00:00:00');
  assert.equal(tcToFrame('01:00:00:05', [24, 1]), 24 * 3600 + 5);
  assert.equal(tcToFrame('00:00:00:24', [24, 1]), null);   // no 25th frame in a 24 fps second
  assert.equal(tcToFrame('nope', [24, 1]), null);
});

test('drop-frame timecode at 29.97 and 59.94', () => {
  assert.equal(frameToTC(0, R2997, { df: true }), '00:00:00;00');
  assert.equal(frameToTC(1799, R2997, { df: true }), '00:00:59;29');
  assert.equal(frameToTC(1800, R2997, { df: true }), '00:01:00;02');   // ;00 and ;01 are skipped
  assert.equal(frameToTC(17982, R2997, { df: true }), '00:10:00;00');  // every tenth minute keeps them
  assert.equal(frameToTC(107892, R2997, { df: true }), '01:00:00;00'); // an hour of real time
  assert.equal(frameToTC(3600, R5994, { df: true }), '00:01:00;04');
  // df on a rate that can't drop is ignored.
  assert.equal(frameToTC(1800, [30, 1], { df: true }), '00:01:00:00');
  // Round trip across a day.
  for (let f = 0; f < 107892 * 24; f += 997) {
    assert.equal(tcToFrame(frameToTC(f, R2997, { df: true }), R2997, { df: true }), f, `frame ${f}`);
  }
  for (let f = 0; f < 24 * 3600 * 24; f += 4999) {
    assert.equal(tcToFrame(frameToTC(f, [24, 1]), [24, 1]), f);
  }
});

test('typing a jump: timecode, frames, seconds, relative', () => {
  const o = { fps: [24, 1], current: 100, frames: 2400 };
  assert.equal(parseJump('00:00:02:00', o), 48);
  assert.equal(parseJump('240', o), 240);
  assert.equal(parseJump('f240', o), 240);
  assert.equal(parseJump('10.5s', o), 252);
  assert.equal(parseJump('+12', o), 112);
  assert.equal(parseJump('-1s', o), 76);
  assert.equal(parseJump('-500', o), 0);           // clamped to the clip
  assert.equal(parseJump('99999', o), 2399);
  assert.equal(parseJump('garbage', o), null);
  assert.equal(parseJump('', o), null);
  // A clip that starts at 01:00:00:00: timecode means its own timecode.
  assert.equal(parseJump('01:00:01:00', { ...o, startFrames: 24 * 3600 }), 24);
});
