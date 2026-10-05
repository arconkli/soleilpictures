// canvasScale — the settled zoom, and the boosted read that is NOT it.
//
// The bug these pin: Capture Mode's 2x image boost was folded into
// getCanvasScale(), which had four callers and only two of them were about
// images. So arming the mode halved a grid divider's drag speed and pushed a
// schedule card to the wrong level of detail — in the one mode whose entire
// purpose is that the app looks exactly like itself.
//
// A zero-import leaf (see the file header), so this runs under bare Node.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  setCanvasScale, setCaptureScaleBoost, getCanvasScale, getImageTierScale,
  onCanvasSettle, emitCanvasSettle,
} from './canvasScale.js';

test('with no boost the two reads agree', () => {
  setCaptureScaleBoost(1);
  setCanvasScale(0.5);
  assert.equal(getCanvasScale(), 0.5);
  assert.equal(getImageTierScale(), 0.5);
});

test('the boost reaches image tiers and nothing else', () => {
  setCanvasScale(0.5);
  setCaptureScaleBoost(2);
  assert.equal(getCanvasScale(), 0.5, 'the settled zoom is the settled zoom');
  assert.equal(getImageTierScale(), 1, 'tiers are chosen a step sharper');
  setCaptureScaleBoost(1);
});

test('a settle after the boost does not clobber it — the read is where it applies', () => {
  setCaptureScaleBoost(2);
  setCanvasScale(0.25);
  assert.equal(getImageTierScale(), 0.5);
  setCanvasScale(2);
  assert.equal(getImageTierScale(), 4);
  setCaptureScaleBoost(1);
});

test('junk is refused rather than propagated as NaN', () => {
  setCanvasScale(1);
  for (const bad of [0, -1, NaN, null, undefined, '2', {}]) {
    setCanvasScale(bad);
    assert.equal(getCanvasScale(), 1, `setCanvasScale(${String(bad)})`);
    setCaptureScaleBoost(bad);
    assert.equal(getImageTierScale(), 1, `setCaptureScaleBoost(${String(bad)})`);
  }
});

test('leaving capture mode puts the tier read back where it was', () => {
  setCanvasScale(0.8);
  setCaptureScaleBoost(2);
  setCaptureScaleBoost(1);
  assert.equal(getImageTierScale(), 0.8);
  assert.equal(getCanvasScale(), 0.8);
});

test('a settle subscriber that throws does not stop the others', () => {
  const seen = [];
  const offA = onCanvasSettle(() => { throw new Error('boom'); });
  const offB = onCanvasSettle(() => seen.push('b'));
  emitCanvasSettle();
  assert.deepEqual(seen, ['b']);
  offA(); offB();
  emitCanvasSettle();
  assert.deepEqual(seen, ['b'], 'unsubscribed listeners stay unsubscribed');
});
