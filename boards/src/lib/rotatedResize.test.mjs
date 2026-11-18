import test from 'node:test';
import assert from 'node:assert/strict';
import { deltaInCardFrame, anchoredResizeOffset } from './rotatedResize.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

// The card's own top-left corner in board space (rotation about the centre).
function topLeft({ x, y, w, h }, deg) {
  const r = deg * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const cx = x + w / 2, cy = y + h / 2;
  return { x: cx + cos * (-w / 2) - sin * (-h / 2), y: cy + sin * (-w / 2) + cos * (-h / 2) };
}

test('rotation 0 is exactly the old behaviour', () => {
  assert.deepEqual(deltaInCardFrame(12, -7, 0), { dx: 12, dy: -7 });
  assert.deepEqual(anchoredResizeOffset(40, 30, 0), { dx: 0, dy: 0 });
  assert.deepEqual(anchoredResizeOffset(40, 30, undefined), { dx: 0, dy: 0 });
  assert.deepEqual(anchoredResizeOffset(40, 30, 360), { dx: 0, dy: 0 });
});

test('a drag along the turned edge grows the card, not shrinks it', () => {
  // Turned 90° clockwise: the card's own +x points down the screen.
  const d = deltaInCardFrame(0, 50, 90);
  close(d.dx, 50); close(d.dy, 0);
  // 180°: the corner sits top-left on screen; dragging up-left grows it.
  const e = deltaInCardFrame(-20, -10, 180);
  close(e.dx, 20); close(e.dy, 10);
});

test('the opposite corner stays fixed in board space', () => {
  for (const deg of [15, 45, 90, 137, 180, -30, 270]) {
    const card = { x: 100, y: 200, w: 160, h: 90 };
    const dw = 37, dh = -22;
    const off = anchoredResizeOffset(dw, dh, deg);
    const after = { x: card.x + off.dx, y: card.y + off.dy, w: card.w + dw, h: card.h + dh };
    const a = topLeft(card, deg), b = topLeft(after, deg);
    close(a.x, b.x); close(a.y, b.y);
  }
});
