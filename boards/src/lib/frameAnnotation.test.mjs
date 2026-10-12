// Drawings on video frames (lib/frameAnnotation.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containRect, toUnits, fromUnits, simplify, buildAnnotation, readAnnotation, arrowHead, SCALE, MAX_POINTS, PEN_COLORS } from './frameAnnotation.js';

test('the picture inside the player box, letterboxed or pillarboxed', () => {
  assert.deepEqual(containRect(1600, 900, 16 / 9), { x: 0, y: 0, w: 1600, h: 900 });
  // A 2.39 scope picture in a 16:9 box: bars top and bottom.
  const scope = containRect(1600, 900, 2.39);
  assert.equal(scope.w, 1600);
  assert.ok(Math.abs(scope.h - 669.46) < 0.01);
  assert.ok(Math.abs(scope.y - 115.27) < 0.01);
  // A vertical phone clip: bars left and right.
  assert.deepEqual(containRect(1600, 900, 9 / 16), { x: 546.875, y: 0, w: 506.25, h: 900 });
  assert.deepEqual(containRect(0, 0, 1), { x: 0, y: 0, w: 0, h: 0 });
});

test('a point maps to picture units and back, clamped to the picture', () => {
  const r = containRect(1600, 900, 2.39);
  const [ux, uy] = toUnits(800, 450, r);
  assert.deepEqual([ux, uy], [5000, 5000]);
  const [px, py] = fromUnits(ux, uy, r);
  assert.ok(Math.abs(px - 800) < 0.2 && Math.abs(py - 450) < 0.2);
  // Drawing on the black bar lands on the picture's edge.
  assert.deepEqual(toUnits(-50, 10, r), [0, 0]);
  assert.deepEqual(toUnits(5000, 5000, r), [SCALE, SCALE]);
});

test('long strokes are simplified to a bounded size', () => {
  const line = Array.from({ length: 1000 }, (_, i) => [i * 10, 5000]);
  assert.equal(simplify(line).length, 2);    // a straight line is two points
  const wiggle = Array.from({ length: 3000 }, (_, i) => [i * 3, 5000 + Math.round(Math.sin(i / 3) * 2000)]);
  assert.ok(simplify(wiggle).length <= MAX_POINTS);
  assert.deepEqual(simplify([[0, 0]]), [[0, 0]]);
});

test('building and reading a drawing keeps only well-formed, in-range items', () => {
  const a = buildAnnotation([
    { t: 'pen', c: '#ff4d4f', w: 40, p: [[0, 0], [100, 100], [200, 50]] },
    { t: 'arrow', c: '#3d8bff', w: 30, a: [1000, 1000], b: [3000, 2000] },
    { t: 'rect', c: 'gold', w: 30, a: [100, 100], b: [900, 600] },        // colour off the palette → first colour
    { t: 'arrow', c: '#3d8bff', w: 30, a: [10, 10], b: [12, 12] },         // a click, not an arrow
    { t: 'laser', p: [[0, 0]] },                                           // unknown tool
    { t: 'pen', p: [[50, 50]] },                                           // one point: nothing drawn
    { t: 'pen', w: 9999, p: [[-5, 20000], [300, 300]] },                   // out of range: clamped
  ], 2.39);
  assert.equal(a.v, 1);
  assert.equal(a.ar, 2.39);
  assert.deepEqual(a.items.map((i) => i.t), ['pen', 'arrow', 'rect', 'pen']);
  assert.equal(a.items[2].c, PEN_COLORS[0]);
  assert.deepEqual(a.items[3].p[0], [0, SCALE]);
  assert.equal(a.items[3].w, 400);
  assert.equal(buildAnnotation([], 1), null);
  assert.deepEqual(readAnnotation(JSON.parse(JSON.stringify(a))), a);
  assert.equal(readAnnotation({ v: 2, items: [] }), null);
  assert.equal(readAnnotation('nope'), null);
  // Size stays well under the database's 64 KB check.
  const big = buildAnnotation(Array.from({ length: 150 }, () => ({ t: 'pen', p: Array.from({ length: 2000 }, (_, i) => [i * 5 % 10000, (i * 37) % 10000]) })), 1.78);
  assert.ok(big.items.length <= 100);
  assert.ok(JSON.stringify(big).length < 64 * 1024 * 4);
});

test('arrow heads point back along the shaft', () => {
  const [l, r] = arrowHead([0, 0], [100, 0], 10);
  assert.ok(l[0] < 100 && r[0] < 100);
  assert.ok(l[1] < 0 !== r[1] < 0);
});
