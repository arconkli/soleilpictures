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
  assert.equal(k('z'), 'pictureZoom');   // Z zooms the picture (fit · 100% · 200%)
  assert.ok(PLAYER_KEYS.length >= 15);
});

// ── The review player (stepRate, loops, reverse pacing, follow, scrub, ruler) ──
import {
  RATES, stepRate, shouldLoopNow, reverseAdvance, playStartFrame, followView, scrubFrame, FINE_PX,
  rulerTicks, previewSize, clampRegion,
} from './filmTransport.js';

test('speed steps through the menu’s rates and stops at the ends', () => {
  assert.equal(stepRate(1, 1), 1.25);
  assert.equal(stepRate(1, -1), 0.75);
  assert.equal(stepRate(2, 1), 2);
  assert.equal(stepRate(0.25, -1), 0.25);
  assert.equal(stepRate(1.1, 1), 1.25);   // off the list: the next one up
  assert.equal(stepRate(1.1, -1), 1);
  assert.deepEqual(RATES, [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]);
});

test('a range loop jumps back on the out frame, not after it', () => {
  assert.equal(shouldLoopNow({ frame: 19, outFrame: 20 }), false);
  assert.equal(shouldLoopNow({ frame: 20, outFrame: 20 }), true);
  assert.equal(shouldLoopNow({ frame: 18, rate: 2, outFrame: 20 }), false);
  assert.equal(shouldLoopNow({ frame: 19, rate: 2, outFrame: 20 }), true);
  assert.equal(shouldLoopNow({ frame: 5, outFrame: null }), false);
});

test('reverse play owes frames with time, so a slow decoder keeps the speed', () => {
  let r = reverseAdvance(0, 20, 24, 1);          // under a frame's worth
  assert.equal(r.n, 0);
  r = reverseAdvance(r.owed, 30, 24, 1);          // 50ms in all = 1.2 frames
  assert.equal(r.n, 1);
  assert.ok(Math.abs(r.owed - 0.2) < 1e-9);
  assert.equal(reverseAdvance(0, 1000, 24, 2).n, 48);
  assert.equal(reverseAdvance(0, 60000, 24, 1).n, 24, 'never more than a second at once');
  assert.deepEqual(reverseAdvance(0, 10, 0, 1), { n: 1, owed: 0 });
});

test('play starts from the top at the end, and inside the range when looping', () => {
  assert.equal(playStartFrame({ here: 47, frames: 48 }), 0);
  assert.equal(playStartFrame({ here: 47, frames: 48, range: { in: 10, out: 20 } }), 10);
  assert.equal(playStartFrame({ here: 30, frames: 48, range: { in: 10, out: 20 } }), null, 'past out, not looping: plays on');
  assert.equal(playStartFrame({ here: 30, frames: 48, range: { in: 10, out: 20 }, looping: true }), 10);
  assert.equal(playStartFrame({ here: 5, frames: 48, range: { in: 10, out: 20 }, looping: true }), 10);
  assert.equal(playStartFrame({ here: 15, frames: 48, range: { in: 10, out: 20 }, looping: true }), null);
});

test('a zoomed timeline follows the playhead', () => {
  const v = { viewStart: 100, viewEnd: 200 };
  assert.equal(followView(v, 150, 1000), null);
  assert.deepEqual(followView(v, 193, 1000), { viewStart: 180, viewEnd: 280 });
  assert.deepEqual(followView(v, 500, 1000), { viewStart: 450, viewEnd: 550 });
  assert.deepEqual(followView({ viewStart: 900, viewEnd: 1000 }, 995, 1000), null, 'at the end it stays');
  assert.equal(followView({ viewStart: 0, viewEnd: 1000 }, 999, 1000), null, 'not zoomed');
});

test('fine scrub moves a frame per few pixels and never jumps when ⇧ changes', () => {
  const geo = { left: 0, width: 1000, viewStart: 0, viewEnd: 1000, frames: 1000 };
  let s = scrubFrame(null, { x: 500, shift: false, geo });
  assert.equal(s.frame, 500);
  s = scrubFrame(s, { x: 500, shift: true, geo });
  assert.equal(s.frame, 500, 'pressing ⇧ keeps the frame');
  s = scrubFrame(s, { x: 500 + FINE_PX * 3, shift: true, geo });
  assert.equal(s.frame, 503);
  s = scrubFrame(s, { x: 500 + FINE_PX * 3, shift: false, geo });
  assert.equal(s.frame, 518, 'letting go of ⇧: the pointer takes over again');
});

test('ruler labels never crowd; frame ticks only when a frame is wide enough', () => {
  const r = rulerTicks({ viewStart: 0, viewEnd: 240 }, 24, 1200);   // 10s across 1200px
  assert.deepEqual(r.major.map((m) => m.sec), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(r.minor.length, 0, '5px a frame: no frame ticks');
  const far = rulerTicks({ viewStart: 0, viewEnd: 24 * 600 }, 24, 1200);  // 10 minutes
  const gaps = far.major.slice(1).map((m, i) => (m.sec - far.major[i].sec) * (1200 / 600));
  assert.ok(gaps.every((g) => g >= 80), 'labels ≥ 80px apart');
  const close = rulerTicks({ viewStart: 10, viewEnd: 34 }, 24, 1200);
  assert.ok(close.minor.length >= 24);
  assert.deepEqual(rulerTicks({ viewStart: 0, viewEnd: 10 }, 0, 100), { major: [], minor: [] });
});

test('the hover preview follows the clip’s shape', () => {
  assert.deepEqual(previewSize(16 / 9, 1440), { w: 240, h: 135 });
  assert.deepEqual(previewSize(9 / 16, 1440), { w: 90, h: 160 });
  assert.deepEqual(previewSize(16 / 9, 800), { w: 160, h: 90 });
  assert.deepEqual(previewSize(16 / 9, 1440, { fine: true }), { w: 284, h: 160 });
  assert.deepEqual(previewSize(0, 1440), { w: 240, h: 135 });
});

test('the in/out region stays inside the visible window', () => {
  const view = { viewStart: 100, viewEnd: 200 };
  const r = clampRegion({ in: 50, out: 149 }, view, 1000, 1000);
  assert.equal(r.left, 0);
  assert.equal(r.width, 500);
  assert.equal(clampRegion({ in: null, out: null }, view, 1000, 1000), null);
  const whole = clampRegion({ in: 10, out: null }, { viewStart: 0, viewEnd: 100 }, 1000, 100);
  assert.equal(whole.left, 100);
  assert.equal(whole.width, 900);
});
