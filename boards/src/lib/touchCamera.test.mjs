// lib/touchCamera.js: the two-finger camera keeps the board point under the
// fingers, composes across frame sizes, and stretches softly past a limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerAnchor, moveCamera, settleTarget } from './touchCamera.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
const O = { min: 0.1, max: 5 };
const under = (cam, x, y) => [(x - cam.pan.x) / cam.zoom, (y - cam.pan.y) / cam.zoom];
const A = (x, y, span) => ({ x, y, span });

test('fingerAnchor reads the first two points', () => {
  assert.equal(fingerAnchor([]), null);
  assert.equal(fingerAnchor(null), null);
  assert.deepEqual(fingerAnchor([{ x: 3, y: 4 }]), { x: 3, y: 4, span: null });
  assert.deepEqual(fingerAnchor([{ x: 0, y: 0 }, { x: 30, y: 40 }]), { x: 15, y: 20, span: 50 });
  const three = fingerAnchor([{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 900, y: 900 }]);
  assert.deepEqual(three, { x: 15, y: 20, span: 50 });
  assert.equal(fingerAnchor([{ x: 0, y: 0 }, { x: 5, y: 0 }]).span, null);
});

test('pure pinch about a still midpoint', () => {
  const cam = { zoom: 1, pan: { x: 10, y: 20 } };
  const out = moveCamera(cam, A(200, 300, 100), A(200, 300, 150), O);
  close(out.zoom, 1.5);
  const [bx, by] = under(cam, 200, 300);
  const [ax, ay] = under(out, 200, 300);
  close(ax, bx);
  close(ay, by);
});

test('the board follows the hand', () => {
  const cam = { zoom: 1, pan: { x: 10, y: 20 } };
  const out = moveCamera(cam, A(200, 300, 100), A(416, 300, 150), O);
  const [bx, by] = under(cam, 200, 300);
  const [ax, ay] = under(out, 416, 300);
  close(ax, bx);
  close(ay, by);
});

test('two-finger pan leaves zoom alone', () => {
  const cam = { zoom: 2, pan: { x: 10, y: 20 } };
  const out = moveCamera(cam, A(200, 300, 100), A(300, 250, 100), O);
  close(out.zoom, 2);
  close(out.pan.x, 110);
  close(out.pan.y, -30);
});

test('one finger pans 1:1; a lost span does not zoom', () => {
  const cam = { zoom: 1.5, pan: { x: 0, y: 0 } };
  const one = moveCamera(cam, A(50, 50, null), A(80, 40, null), O);
  assert.equal(one.zoom, 1.5);
  close(one.pan.x, 30);
  close(one.pan.y, -10);
  const lost = moveCamera(cam, A(50, 50, 100), A(50, 50, null), O);
  assert.equal(lost.zoom, 1.5);
});

test('small steps compose into one big step', () => {
  let cam = { zoom: 1, pan: { x: 0, y: 0 } };
  let prev = A(100, 100, 100);
  for (let i = 1; i <= 20; i++) {
    const next = A(100, 100, 100 + (200 * i) / 20);
    cam = moveCamera(cam, prev, next, O);
    prev = next;
  }
  const big = moveCamera({ zoom: 1, pan: { x: 0, y: 0 } }, A(100, 100, 100), A(100, 100, 300), O);
  close(cam.zoom, 3);
  close(cam.zoom, big.zoom);
  close(cam.pan.x, big.pan.x);
});

test('the wall resists and never reaches the stretch limit', () => {
  const at5 = { zoom: 5, pan: { x: 0, y: 0 } };
  const two = moveCamera(at5, A(0, 0, 100), A(0, 0, 200), O);
  assert.ok(two.zoom > 5 && two.zoom < 5 * 1.12);
  const huge = moveCamera(at5, A(0, 0, 100), A(0, 0, 100000), O);
  assert.ok(huge.zoom < 5 * 1.12);

  let cam = at5;
  let span = 100;
  for (let i = 0; i < 50; i++) {
    const next = span * Math.pow(2, 1 / 50);
    cam = moveCamera(cam, A(0, 0, span), A(0, 0, next), O);
    span = next;
  }
  close(cam.zoom, two.zoom);

  const from4 = moveCamera({ zoom: 4, pan: { x: 0, y: 0 } }, A(0, 0, 100), A(0, 0, 200), O);
  assert.ok(from4.zoom > 5 && from4.zoom < 5.6);
  assert.ok(from4.zoom >= 5);
});

test('no dead zone coming back from an overshoot', () => {
  const over = moveCamera({ zoom: 5, pan: { x: 0, y: 0 } }, A(0, 0, 100), A(0, 0, 200), O).zoom;
  for (const r of [0.99, 0.9, 0.5]) {
    const back = moveCamera({ zoom: over, pan: { x: 0, y: 0 } }, A(0, 0, 100), A(0, 0, 100 * r), O);
    close(back.zoom, over * r);
  }
});

test('the minimum side mirrors', () => {
  const at = { zoom: 0.1, pan: { x: 0, y: 0 } };
  const out = moveCamera(at, A(0, 0, 100), A(0, 0, 50), O);
  assert.ok(out.zoom < 0.1 && out.zoom > 0.1 / 1.12);
  const back = moveCamera(out, A(0, 0, 100), A(0, 0, 120), O);
  close(back.zoom, out.zoom * 1.2);
});

test('settleTarget glides back into range about the fingers', () => {
  assert.equal(settleTarget({ zoom: 3, pan: { x: 0, y: 0 } }, { x: 1, y: 1 }, O), null);
  const hi = { zoom: 5.4, pan: { x: 12, y: -7 } };
  const t = settleTarget(hi, { x: 100, y: 100 }, O);
  assert.equal(t.zoom, 5);
  const [bx, by] = under(hi, 100, 100);
  const [ax, ay] = under(t, 100, 100);
  close(ax, bx);
  close(ay, by);
  const lo = { zoom: 0.09, pan: { x: 5, y: 5 } };
  const t2 = settleTarget(lo, { x: 100, y: 100 }, O);
  assert.equal(t2.zoom, 0.1);
  const [lx, ly] = under(lo, 100, 100);
  const [mx, my] = under(t2, 100, 100);
  close(mx, lx);
  close(my, ly);
  assert.deepEqual(settleTarget(hi, null, O).pan, { x: 12, y: -7 });
});

test('inputs are not mutated', () => {
  const cam = { zoom: 1, pan: { x: 10, y: 20 } };
  const from = A(200, 300, 100);
  const to = A(250, 310, 150);
  const snap = JSON.stringify([cam, from, to]);
  moveCamera(cam, from, to, O);
  settleTarget({ zoom: 9, pan: { x: 1, y: 2 } }, { x: 3, y: 4 }, O);
  assert.equal(JSON.stringify([cam, from, to]), snap);
  const pts = [{ x: 0, y: 0 }, { x: 20, y: 0 }];
  const ps = JSON.stringify(pts);
  fingerAnchor(pts);
  assert.equal(JSON.stringify(pts), ps);
});
