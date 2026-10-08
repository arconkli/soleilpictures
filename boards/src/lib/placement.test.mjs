// placement.test.mjs — files that are in a cluster but not on its board.
//
//   node --test src/lib/placement.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isUnplaced, placedOf, countUnplaced, canUnplace, positionUnplaced, planPutOnBoard, besideContent,
} from './placement.js';

const card = (id, extra = {}) => ({ id, kind: 'image', x: 0, y: 0, w: 100, h: 100, ...extra });

test('only an explicit true is off the board', () => {
  assert.equal(isUnplaced(card('a')), false);
  assert.equal(isUnplaced(card('a', { unplaced: false })), false);
  assert.equal(isUnplaced(card('a', { unplaced: 'yes' })), false);
  assert.equal(isUnplaced(card('a', { unplaced: true })), true);
  assert.equal(isUnplaced(null), false);
});

test('placedOf hands back the same array when nothing is off the board', () => {
  const all = [card('a'), card('b')];
  assert.equal(placedOf(all), all);
  const mixed = [card('a'), card('b', { unplaced: true }), card('c', { unplaced: false })];
  const placed = placedOf(mixed);
  assert.deepEqual(placed.map((c) => c.id), ['a', 'c']);
  assert.equal(placedOf(mixed), placed);          // memoized per array
  assert.deepEqual(placedOf(null), []);
  assert.equal(countUnplaced(mixed), 1);
});

test('Remove from board is for files and simple content, never structure or folders', () => {
  for (const kind of ['image', 'video', 'audio', 'pdf', 'file', 'link', 'palette', 'note']) assert.ok(canUnplace({ id: 'x', kind }), kind);
  for (const kind of ['grid', 'doc', 'schedule', 'shape', 'board', 'boardlink']) assert.equal(canUnplace({ id: 'x', kind }), false, kind);
  assert.equal(canUnplace({ id: 'x', kind: 'image', locked: true }), false);
  assert.equal(canUnplace({ id: 'x', kind: 'image', unplaced: true }), false);
});

test('unplaced files wait clear of everything — placed or not', () => {
  const all = [card('a', { x: 0, y: 0, w: 400, h: 300 }), card('b', { x: 0, y: 400, w: 200, h: 200, unplaced: true })];
  const out = positionUnplaced(all, [{ w: 100, h: 100 }]);
  assert.ok(out[0].y >= 600, `lands below both, got y=${out[0].y}`);
  assert.ok(Number.isFinite(out[0].x));
});

test('Put on board centres the block on the point, keeps sizes, and clears the flag', () => {
  const all = [
    card('on', { x: 0, y: 0 }),
    card('u1', { unplaced: true, x: 0, y: 900, w: 200, h: 100 }),
    card('u2', { unplaced: true, x: 300, y: 900, w: 200, h: 100 }),
  ];
  const plan = planPutOnBoard(all, ['u1', 'u2', 'on'], { x: 1000, y: 500 });
  assert.deepEqual(plan.map((p) => p.id).sort(), ['u1', 'u2']);   // the placed one isn't touched
  for (const p of plan) assert.equal(p.patch.unplaced, false);
  const xs = plan.map((p) => p.patch.x), ys = plan.map((p) => p.patch.y);
  const left = Math.min(...xs), right = Math.max(...xs) + 200;
  const top = Math.min(...ys), bottom = Math.max(...ys) + 100;
  assert.ok(Math.abs((left + right) / 2 - 1000) <= 1);
  assert.ok(Math.abs((top + bottom) / 2 - 500) <= 1);
  assert.deepEqual(planPutOnBoard(all, ['on'], { x: 0, y: 0 }), []);
});

test('with no point, Put on board goes just right of the board\'s content', () => {
  const all = [card('on', { x: 0, y: 50, w: 300, h: 100 }), card('u', { unplaced: true, x: 0, y: 900 })];
  const [p] = planPutOnBoard(all, ['u']);
  assert.ok(p.patch.x >= 340, `x=${p.patch.x}`);
  assert.equal(p.patch.y, 50);
  assert.deepEqual(besideContent([]), { x: 80, y: 80 });
});

test('layout, starter docs and "beside the content" all ignore files that are not on the board', async () => {
  const { withGeometry } = await import('./moodboard.js');
  const { spotBesideContent } = await import('./projectsHome.js');
  const { starterDocSpot } = await import('./starterDocs.js');
  const on = card('on', { x: 0, y: 0, w: 100, h: 100 });
  const off = card('off', { x: 5000, y: 0, w: 100, h: 100, unplaced: true });
  assert.deepEqual(withGeometry([on, off]).map((c) => c.id), ['on']);
  assert.deepEqual(spotBesideContent([on, off]), { x: 140, y: 0 });
  assert.equal(starterDocSpot([off]), null);
  assert.ok(starterDocSpot([on, off]).x < 1000);
});
