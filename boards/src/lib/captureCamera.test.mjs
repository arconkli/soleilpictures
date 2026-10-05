// captureCamera.test.mjs — the fit solver and the camera tween.
//
// solveFit replaces three hand-copied versions of the same eight lines in
// CanvasSurface (fitToContent / zoomToSelection / frameCards). The value of
// having one is only real if it behaves identically to what it replaced, so the
// framing property is asserted directly: whatever you ask it to frame comes
// back centred in the viewport at the solved zoom.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveFit, easeInOutCubic, sampleTween, fitMargin, selectionMargin } from './captureCamera.js';

const VP = { x: 0, y: 0, w: 1200, h: 800 };

// Where a board-space point lands on screen under a given camera.
const project = (p, cam) => ({
  x: p.x * cam.zoom + cam.pan.x,
  y: p.y * cam.zoom + cam.pan.y,
});

// ── solveFit ───────────────────────────────────────────────────────────────

test('the framed rect comes back centred in the viewport', () => {
  const rect = { x: 500, y: 300, w: 400, h: 200 };
  const cam = solveFit(rect, VP, { margin: 80 });
  const tl = project({ x: rect.x, y: rect.y }, cam);
  const br = project({ x: rect.x + rect.w, y: rect.y + rect.h }, cam);
  assert.ok(Math.abs((tl.x + br.x) / 2 - VP.w / 2) < 0.001, 'not horizontally centred');
  assert.ok(Math.abs((tl.y + br.y) / 2 - VP.h / 2) < 0.001, 'not vertically centred');
});

test('the framed rect fits inside the viewport with its margin', () => {
  const rect = { x: -200, y: 40, w: 3000, h: 500 };
  const margin = 80;
  const cam = solveFit(rect, VP, { margin });
  const tl = project({ x: rect.x, y: rect.y }, cam);
  const br = project({ x: rect.x + rect.w, y: rect.y + rect.h }, cam);
  assert.ok(tl.x >= margin - 0.001 && br.x <= VP.w - margin + 0.001, 'overflowed horizontally');
  assert.ok(tl.y >= margin - 0.001 && br.y <= VP.h - margin + 0.001, 'overflowed vertically');
});

test('zoom is clamped to the injected bounds, both ends', () => {
  // A single tiny card would otherwise solve to an enormous zoom.
  const huge = solveFit({ x: 0, y: 0, w: 1, h: 1 }, VP, { zoomMax: 5 });
  assert.equal(huge.zoom, 5);
  // An enormous board would solve to an invisible one.
  const tiny = solveFit({ x: 0, y: 0, w: 1e6, h: 1e6 }, VP, { zoomMin: 0.1 });
  assert.equal(tiny.zoom, 0.1);
});

test('bounds are injected, not baked in — the canvas keeps owning its limits', () => {
  const cam = solveFit({ x: 0, y: 0, w: 1, h: 1 }, VP, { zoomMax: 2 });
  assert.equal(cam.zoom, 2);
});

test('a margin larger than the viewport cannot solve to a negative zoom', () => {
  const cam = solveFit({ x: 0, y: 0, w: 100, h: 100 }, { w: 200, h: 200 }, { margin: 500 });
  assert.ok(cam.zoom > 0, `got ${cam.zoom}`);
  assert.ok(Number.isFinite(cam.pan.x) && Number.isFinite(cam.pan.y));
});

test('degenerate input still produces finite numbers', () => {
  for (const rect of [null, {}, { x: 0, y: 0, w: 0, h: 0 }, { w: NaN, h: NaN }]) {
    const cam = solveFit(rect, VP);
    assert.ok(Number.isFinite(cam.zoom) && cam.zoom > 0, `zoom ${cam.zoom}`);
    assert.ok(Number.isFinite(cam.pan.x) && Number.isFinite(cam.pan.y));
  }
});

// ── Easing ─────────────────────────────────────────────────────────────────

test('the ease pins both ends exactly', () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(1), 1);
  assert.equal(easeInOutCubic(0.5), 0.5);
});

test('the ease is monotone and stays in range', () => {
  let prev = -1;
  for (let i = 0; i <= 100; i++) {
    const v = easeInOutCubic(i / 100);
    assert.ok(v >= prev, `not monotone at ${i / 100}`);
    assert.ok(v >= 0 && v <= 1, `left the unit range at ${i / 100}`);
    prev = v;
  }
});

test('the ease clamps out-of-range time rather than overshooting', () => {
  assert.equal(easeInOutCubic(-5), 0);
  assert.equal(easeInOutCubic(5), 1);
});

// ── The tween ──────────────────────────────────────────────────────────────

const A = { zoom: 0.5, pan: { x: 0, y: 0 } };
const B = { zoom: 2.0, pan: { x: -400, y: 120 } };

test('the tween lands exactly on its endpoints', () => {
  const start = sampleTween(A, B, 0);
  assert.ok(Math.abs(start.zoom - A.zoom) < 1e-9);
  assert.deepEqual(start.pan, A.pan);

  const end = sampleTween(A, B, 1);
  assert.ok(Math.abs(end.zoom - B.zoom) < 1e-9, `zoom landed at ${end.zoom}`);
  assert.ok(Math.abs(end.pan.x - B.pan.x) < 1e-9);
  assert.ok(Math.abs(end.pan.y - B.pan.y) < 1e-9);
});

test('zoom is interpolated geometrically, not linearly', () => {
  // Halfway through a 0.5 → 2 move, the geometric mean is 1.0. A linear blend
  // would give 1.25, which is why a linearly-tweened zoom looks like it
  // accelerates into the target and then stops dead.
  const mid = sampleTween(A, B, 0.5);
  assert.ok(Math.abs(mid.zoom - 1.0) < 1e-9, `got ${mid.zoom}, expected the geometric mean 1.0`);
});

test('zoom is monotone across the whole move', () => {
  let prev = 0;
  for (let i = 0; i <= 60; i++) {
    const { zoom } = sampleTween(A, B, i / 60);
    assert.ok(zoom >= prev - 1e-12, `zoom reversed at t=${i / 60}`);
    assert.ok(Number.isFinite(zoom));
    prev = zoom;
  }
});

test('a zero or negative zoom cannot produce NaN', () => {
  const s = sampleTween({ zoom: 0, pan: { x: 0, y: 0 } }, { zoom: -1, pan: { x: 0, y: 0 } }, 0.5);
  assert.ok(Number.isFinite(s.zoom) && s.zoom > 0);
});

test('missing pans are treated as the origin rather than throwing', () => {
  const s = sampleTween({ zoom: 1 }, { zoom: 2 }, 0.5);
  assert.ok(Number.isFinite(s.pan.x) && Number.isFinite(s.pan.y));
});

// ── Margins ────────────────────────────────────────────────────────────────
//
// The bug these pin: a flat 120px selection margin left 150px of usable width
// on a 390pt phone, so "push in" solved a LOWER zoom than the "fit" it came
// from — the flagship move of punch and establish, running backwards.

const vp = (width, height = 800) => ({ width, height });

test('a selection always leaves more air than a whole-board fit', () => {
  for (const w of [320, 390, 428, 640, 641, 834, 1024, 1440, 1920]) {
    const r = vp(w);
    assert.ok(selectionMargin(r) > fitMargin(r),
      `at ${w}px wide: selection ${selectionMargin(r)} is not more than fit ${fitMargin(r)}`);
  }
});

test('desktop margins are unchanged — a phone fix must not move a desktop pixel', () => {
  for (const w of [641, 1024, 1440, 1920]) {
    assert.equal(fitMargin(vp(w)), 80);
    assert.equal(selectionMargin(vp(w)), 120);
  }
});

test('neither margin can eat the phone viewport it is framing inside', () => {
  for (const w of [320, 390, 428, 640]) {
    // Both sides together, against the width they are carved out of. Above a
    // third and the content being framed is the minority of the frame.
    assert.ok(selectionMargin(vp(w)) * 2 < w / 3,
      `at ${w}px wide the selection margins take ${selectionMargin(vp(w)) * 2}px`);
  }
});

test('a push-in on a phone actually pushes in', () => {
  // A selection that is 60% of the board — the range where the flat 120 went
  // backwards. Solve the fit, then solve the selection against the same
  // viewport, and the selection must be the closer of the two.
  const r = vp(390, 800);
  const board = { x: 0, y: 0, w: 2000, h: 1600 };
  const sel = { x: 200, y: 200, w: 1200, h: 960 };
  const fit = solveFit(board, { w: r.width, h: r.height }, { margin: fitMargin(r) });
  const push = solveFit(sel, { w: r.width, h: r.height }, { margin: selectionMargin(r) });
  assert.ok(push.zoom > fit.zoom,
    `push-in solved ${push.zoom} against a fit of ${fit.zoom} — that is a pull-back`);
});

test('the margin clamp inside solveFit still protects a tiny viewport', () => {
  // selectionMargin is a fraction of width, but solveFit is handed a height
  // too — a very short viewport must not solve to a negative zoom.
  const s = solveFit({ x: 0, y: 0, w: 500, h: 500 }, { w: 390, h: 40 },
                     { margin: selectionMargin(vp(390)) });
  assert.ok(Number.isFinite(s.zoom) && s.zoom > 0, `got ${s.zoom}`);
});
