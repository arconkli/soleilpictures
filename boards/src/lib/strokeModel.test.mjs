// Where a finished stroke lands, and what moving a stroke selection keeps.
//
// Both are pure decisions the canvas makes at pointerup, and both have shipped
// wrong: a selected art card swallowed every stroke drawn anywhere on the board,
// and moving or scaling a selection flattened Apple Pencil pressure.

import test from 'node:test';
import assert from 'node:assert/strict';
import { pickArtStrokeTarget, mapStrokePoints, applyStrokeTransform } from './strokeModel.js';

const art = { id: 'a', kind: 'art', x: 0, y: 0, w: 100, h: 100, z: 1 };
const art2 = { id: 'b', kind: 'art', x: 500, y: 500, w: 100, h: 100, z: 2 };
const note = { id: 'n', kind: 'note', x: 1000, y: 0, w: 100, h: 100 };
const far = [[800, 800], [820, 810], [840, 820]];
const inside = [[10, 10], [20, 20], [30, 30]];

test('a selected art card does not swallow a stroke drawn far away from it', () => {
  assert.equal(pickArtStrokeTarget(far, [art, note], art), null);
});

test('a stroke drawn mostly inside the selected art card goes into it', () => {
  assert.equal(pickArtStrokeTarget(inside, [art, art2], art), art);
});

test('a just-committed art card missing from cards still catches a stroke drawn on it', () => {
  // The SketchPad race: the selection points at a card the Y.Doc hasn't echoed yet.
  assert.equal(pickArtStrokeTarget(inside, [], art), art);
});

test('a selected art card loses to the art card the stroke was actually drawn on', () => {
  const onB = [[510, 510], [520, 520], [530, 530]];
  assert.equal(pickArtStrokeTarget(onB, [art, art2], art), art2);
});

test('a stroke that only clips a corner of an art card stays on the board', () => {
  const clip = [[90, 90], [150, 150], [200, 200]];
  assert.equal(pickArtStrokeTarget(clip, [art], null), null);
  assert.equal(pickArtStrokeTarget(clip, [art], art), null);
});

test('moving points keeps pen pressure', () => {
  const moved = mapStrokePoints([[0, 0, 0.3], [10, 0, 0.8], [5, 5]], (x, y) => [x + 1, y + 2]);
  assert.deepEqual(moved, [[1, 2, 0.3], [11, 2, 0.8], [6, 7]]);
});

test('a stroke transform replaces only the picked strokes in the LIVE array', () => {
  const s0 = { color: '#fff', width: 3, points: [[0, 0, 0.5], [10, 10, 0.9]] };
  const s1 = { color: '#fff', width: 3, points: [[50, 50], [60, 60]] };
  const peer = { color: '#f00', width: 2, points: [[1, 1], [2, 2]] };
  // A collaborator added a stroke while we were dragging s1.
  const live = [s0, s1, peer];
  const r = applyStrokeTransform(live, [{ idx: 1, stroke: s1 }], (x, y) => [x + 5, y]);
  assert.deepEqual(r.indexes, [1]);
  assert.deepEqual(r.next[1].points, [[55, 50], [65, 60]]);
  assert.equal(r.next[0], s0);
  assert.equal(r.next[2], peer);
});

test('a stroke transform follows a picked stroke whose index shifted mid-drag', () => {
  const s0 = { color: '#fff', width: 3, points: [[0, 0], [10, 10]] };
  const s1 = { color: '#fff', width: 3, points: [[50, 50, 0.4], [60, 60, 0.6]] };
  // A peer erased s0 during the drag, so s1 is now at index 0.
  const r = applyStrokeTransform([{ ...s1 }], [{ idx: 1, stroke: s1 }], (x, y) => [x, y + 1]);
  assert.deepEqual(r.indexes, [0]);
  assert.deepEqual(r.next[0].points, [[50, 51, 0.4], [60, 61, 0.6]]);
});

test('a stroke erased mid-drag is not resurrected', () => {
  const s1 = { color: '#fff', width: 3, points: [[50, 50], [60, 60]] };
  assert.equal(applyStrokeTransform([], [{ idx: 0, stroke: s1 }], (x, y) => [x, y]), null);
});
