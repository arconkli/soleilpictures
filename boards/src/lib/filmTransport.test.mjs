// The film player's transport (lib/filmTransport.js) and key map
// (lib/playerKeys.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shuttle, reverseStepFrames, clampFrame, normalizeRange, loopTarget, nextMarker, frameAtX, xOfFrame, zoomWindow,
} from './filmTransport.js';
import { playerAction, PLAYER_KEYS } from './playerKeys.js';

test('J/K/L shuttle: doubling, reversing, stopping', () => {
  let s = { dir: 0, rate: 1 };
  s = shuttle(s, 'l'); assert.deepEqual(s, { dir: 1, rate: 1 });
  s = shuttle(s, 'l'); assert.deepEqual(s, { dir: 1, rate: 2 });
  s = shuttle(s, 'L'); assert.deepEqual(s, { dir: 1, rate: 4 });
  s = shuttle(s, 'l'); s = shuttle(s, 'l'); assert.deepEqual(s, { dir: 1, rate: 8 });   // capped
  s = shuttle(s, 'j'); assert.deepEqual(s, { dir: -1, rate: 1 });                        // reverses at 1×
  s = shuttle(s, 'j'); assert.deepEqual(s, { dir: -1, rate: 2 });
  s = shuttle(s, 'k'); assert.deepEqual(s, { dir: 0, rate: 1 });
  assert.deepEqual(shuttle(s, 'x'), s);
});

test('reverse play steps by the time elapsed, at least a frame, at most a second', () => {
  assert.equal(reverseStepFrames(0, 1, [24, 1]), 1);
  assert.equal(reverseStepFrames(125, 1, [24, 1]), 3);
  assert.equal(reverseStepFrames(125, 2, [24, 1]), 6);
  assert.equal(reverseStepFrames(5000, 1, [24, 1]), 24);
  assert.equal(reverseStepFrames(100, 1, null), 1);
});

test('frames clamp to the clip; in/out normalise; loops wrap the right way', () => {
  assert.equal(clampFrame(-3, 48), 0);
  assert.equal(clampFrame(60, 48), 47);
  assert.equal(clampFrame(12.4, 48), 12);
  assert.deepEqual(normalizeRange(30, 10, 48), { in: 10, out: 30 });
  assert.deepEqual(normalizeRange(null, 99, 48), { in: null, out: 47 });
  const r = { in: 10, out: 20 };
  assert.equal(loopTarget(21, r, 1, 48), 10);
  assert.equal(loopTarget(15, r, 1, 48), null);
  assert.equal(loopTarget(9, r, -1, 48), 20);
  // Only an in point: loops at the clip's end.
  assert.equal(loopTarget(48, { in: 5, out: null }, 1, 48), 5);
});

test('next and previous comment markers', () => {
  const m = [40, 12, 30, 12];
  assert.equal(nextMarker(m, 12, 1), 30);
  assert.equal(nextMarker(m, 12, -1), null);
  assert.equal(nextMarker(m, 35, -1), 30);
  assert.equal(nextMarker(m, 40, 1), null);
  assert.equal(nextMarker([], 0, 1), null);
});

test('timeline geometry: x ↔ frame, and zooming around the pointer', () => {
  const g = { left: 100, width: 480, viewStart: 0, viewEnd: 48, frames: 48 };
  assert.equal(frameAtX(100, g), 0);
  assert.equal(frameAtX(100 + 479, g), 47);
  assert.equal(frameAtX(100 + 240, g), 24);
  assert.equal(frameAtX(1000, g), 47);
  assert.equal(xOfFrame(24, g), 240);
  const z = zoomWindow({ viewStart: 0, viewEnd: 2400, frames: 2400 }, 1200, 0.5);
  assert.deepEqual(z, { viewStart: 600, viewEnd: 1800 });
  // Never narrower than 24 frames, never wider than the clip, never off its ends.
  assert.deepEqual(zoomWindow({ viewStart: 0, viewEnd: 30, frames: 2400 }, 10, 0.1), { viewStart: 2, viewEnd: 26 });
  assert.deepEqual(zoomWindow({ viewStart: 600, viewEnd: 1800, frames: 2400 }, 1200, 4), { viewStart: 0, viewEnd: 2400 });
});

test('the player key map', () => {
  const k = (key, more = {}) => playerAction({ key, ...more });
  assert.equal(k(' '), 'toggle');
  assert.equal(k('ArrowRight'), 'fwd1f');
  assert.equal(k('ArrowLeft', { shiftKey: true }), 'back1s');
  assert.equal(k('j'), 'shuttleBack');
  assert.equal(playerAction({ key: 'j' }, { kHeld: true }), 'back1f');
  assert.equal(playerAction({ key: 'L' }, { kHeld: true }), 'fwd1f');
  assert.equal(k('k'), 'stop');
  assert.equal(k('i'), 'markIn');
  assert.equal(k('O'), 'markOut');
  assert.equal(playerAction({ key: '¬', code: 'KeyL', altKey: true }), 'loop');
  assert.equal(playerAction({ key: '≈', code: 'KeyX', altKey: true }), 'clearInOut');
  assert.equal(k('ArrowDown'), 'nextComment');
  assert.equal(k('\\'), 'compare');
  assert.equal(k('Escape'), 'escape');
  // ⌘/Ctrl combinations belong to the app (⌘I, ⌘Z…).
  assert.equal(k('i', { metaKey: true }), null);
  assert.equal(k('z'), null);
  assert.ok(PLAYER_KEYS.length >= 15);
});
