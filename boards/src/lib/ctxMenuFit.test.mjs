import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitMenuAbove, fitMenuTop, placeMenu } from './ctxMenuFit.js';

test('a menu that fits where it was asked opens there', () => {
  assert.equal(fitMenuTop(100, 300, 900), 100);
});

test('a menu opened low moves up so its bottom clears the window by the pad', () => {
  // The sweep's tablet case: 652px menu asked at 168 in a 768px window.
  const top = fitMenuTop(168, 652, 768);
  assert.equal(top + 652, 768 - 8);
});

test('content still loading is reserved, so the menu does not jump when it lands', () => {
  assert.equal(fitMenuTop(600, 300, 900, 44), 900 - 8 - 344);
  assert.equal(fitMenuTop(600, 300, 900), 900 - 8 - 300);
});

test('a menu taller than the window starts at the top pad (and scrolls)', () => {
  assert.equal(fitMenuTop(300, 2000, 768), 8);
  assert.equal(fitMenuTop(-40, 100, 768), 8);
});

test('a menu asked to end above a point (a bar at the foot of the window) sits right over it', () => {
  assert.equal(fitMenuAbove(800, 300), 500);
  // Content still loading is reserved above, so the bottom stays put.
  assert.equal(fitMenuAbove(800, 300 + 44), 456);
});

test('a menu taller than the room above starts at the top pad (and scrolls)', () => {
  assert.equal(fitMenuAbove(400, 900), 8);
});

const BOX = { w: 200, h: 300, vw: 1000, vh: 800 };

test('a menu that fits where it was asked opens there, from its top left', () => {
  assert.deepEqual(
    placeMenu({ x: 100, y: 100, ...BOX }),
    { left: 100, top: 100, maxHeight: undefined, originX: 'left', originY: 'top' },
  );
});

test('a menu asked near the right edge flips to the left of the press', () => {
  const m = placeMenu({ x: 900, y: 100, ...BOX });
  assert.equal(m.left, 700);
  assert.equal(m.originX, 'right');
});

test('a menu asked near the bottom edge flips up from the press', () => {
  const m = placeMenu({ x: 100, y: 700, ...BOX });
  assert.equal(m.top, 400);
  assert.equal(m.originY, 'bottom');
});

test('a press inside the margin at the right and bottom still leaves the menu the pad from those edges', () => {
  const m = placeMenu({ x: 997, y: 797, ...BOX });
  assert.ok(m.left + BOX.w <= BOX.vw - 8);
  assert.ok(m.top + BOX.h <= BOX.vh - 8);
  assert.ok(m.left >= 8);
  assert.ok(m.top >= 8);
});

test('a press inside the margin at the left and top still leaves the menu the pad from those edges', () => {
  const m = placeMenu({ x: 2, y: 2, ...BOX });
  assert.ok(m.left >= 8);
  assert.ok(m.top >= 8);
});

test('a menu taller than the window starts at the top pad and scrolls', () => {
  const m = placeMenu({ x: 100, y: 100, ...BOX, h: 900 });
  assert.equal(m.top, 8);
  assert.equal(m.maxHeight, 784);
});

test('a menu asked to end above the press sits right over it', () => {
  const m = placeMenu({ x: 100, y: 700, ...BOX, above: true });
  assert.equal(m.top, 400);
  assert.equal(m.originY, 'bottom');
  assert.equal(m.maxHeight, undefined);
});

test('a menu asked to end above a press with too little room above starts at the top pad and scrolls', () => {
  const m = placeMenu({ x: 100, y: 200, ...BOX, above: true });
  assert.equal(m.top, 8);
  assert.equal(m.maxHeight, 192);
});
