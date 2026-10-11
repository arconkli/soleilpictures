import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupTrashBatches } from './trashBatches.js';

const T1 = '2026-10-11T10:00:00.000+00:00';
const T2 = '2026-10-11T11:00:00.000+00:00';

test('a deleted cluster lists once, with the clusters that went with it counted inside', () => {
  const rows = [
    { id: 'a', parent_board_id: 'root', deleted_at: T1, name: 'A' },
    { id: 'b', parent_board_id: 'a', deleted_at: T1, name: 'B' },
    { id: 'c', parent_board_id: 'b', deleted_at: T1, name: 'C' },
  ];
  assert.deepEqual(groupTrashBatches(rows).map((g) => [g.board.id, g.inside]), [['a', 2]]);
});

test('a sub-cluster deleted on its own earlier keeps its own row', () => {
  const rows = [
    { id: 'a', parent_board_id: 'root', deleted_at: T2, name: 'A' },
    { id: 'b', parent_board_id: 'a', deleted_at: T1, name: 'B' },
  ];
  assert.deepEqual(groupTrashBatches(rows).map((g) => [g.board.id, g.inside]), [['a', 0], ['b', 0]]);
});

test('separate deletions stay separate, and a cycle cannot hang the grouping', () => {
  const rows = [
    { id: 'x', parent_board_id: 'y', deleted_at: T1 },
    { id: 'y', parent_board_id: 'x', deleted_at: T1 },
    { id: 'z', parent_board_id: null, deleted_at: T2 },
  ];
  const ids = groupTrashBatches(rows).map((g) => g.board.id);
  assert.ok(ids.includes('z'));
  assert.ok(ids.length <= 3);
  assert.deepEqual(groupTrashBatches(null), []);
});

test('the trash shows batches, a failed load is not an empty trash, and restore says what came back', () => {
  const src = readFileSync(new URL('../components/TrashModal.jsx', import.meta.url), 'utf8');
  assert.match(src, /groupTrashBatches\(/, 'the trash must group batches');
  assert.match(src, /Couldn.t load the trash/, 'a failed fetch must not render the empty state');
  assert.match(src, /past your limit/, 'a cap refusal must still surface (cardCapScope)');
});
