// Removing a grid line deletes the right / bottom side's cells. Its content
// must move into the cell that takes the space when that cell is empty, and
// otherwise be counted so the loss can be undone from a toast (CARDS-05).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { removeDivider, carryRemovedCells } from './gridLayout.js';

const sideBySide = {
  type: 'col', frac: 1,
  children: [{ type: 'leaf', id: 'L', frac: 0.5 }, { type: 'leaf', id: 'R', frac: 0.5 }],
};
const img = { type: 'image', src: 'https://x/a.jpg' };

test('removeDivider reports the cells that grow as well as the ones that go', () => {
  const { removedIds, keptIds } = removeDivider(sideBySide, [], 0);
  assert.deepEqual(removedIds, ['R']);
  assert.deepEqual(keptIds, ['L']);
});

test('an image beside an empty cell moves into it instead of vanishing', () => {
  assert.deepEqual(carryRemovedCells(['R'], ['L'], { R: img }), { moves: { L: img }, dropped: 0 });
  assert.deepEqual(carryRemovedCells(['R'], ['L'], { L: { type: 'empty' }, R: img }), { moves: { L: img }, dropped: 0 });
});

test('when both sides hold content the removed side is counted as dropped', () => {
  const text = { type: 'text', html: '<p>hi</p>' };
  assert.deepEqual(carryRemovedCells(['R'], ['L'], { L: text, R: img }), { moves: {}, dropped: 1 });
});

test('a split side that grows is not an heir; only filled records count', () => {
  const r = carryRemovedCells(['R1', 'R2', 'R3'], ['L1', 'L2'], {
    R1: img, R2: { type: 'text', html: '' }, R3: { type: 'empty' },
  });
  assert.deepEqual(r, { moves: {}, dropped: 1 });
});

test('only the first record moves into a single empty heir', () => {
  const b = { type: 'link', source: 'https://example.com' };
  assert.deepEqual(carryRemovedCells(['R1', 'R2'], ['L'], { R1: img, R2: b }), { moves: { L: img }, dropped: 1 });
});
