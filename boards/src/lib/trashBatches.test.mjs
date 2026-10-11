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

test('search finds nothing in the Trash (0404)', async () => {
  // entity_search fed ⌘K, the @-mention trie and the hover popover with
  // trashed clusters and the cards on them; opening one stranded the app on a
  // raw UUID breadcrumb. Card and group rows follow their cluster.
  const { latestMatch } = await import('./migrationText.mjs');
  const view = latestMatch(/create or replace view public\.entity_search[\s\S]*?;/i);
  assert.ok(view, 'entity_search must be defined in a migration');
  const sql = view.match[0];
  assert.match(sql, /with \(security_invoker = on\)/, 'create or replace view resets an unstated reloption (0302)');
  assert.match(sql, /FROM boards b\s+WHERE b\.deleted_at IS NULL/, 'the cluster branch skips trashed clusters');
  assert.match(sql, /FROM card_index ci\s+WHERE NOT EXISTS \(SELECT 1 FROM boards tb WHERE tb\.id = ci\.board_id AND tb\.deleted_at IS NOT NULL\)/,
    'cards on a trashed cluster are not found');
  assert.match(sql, /FROM group_index gi\s+WHERE NOT EXISTS \(SELECT 1 FROM boards tb WHERE tb\.id = gi\.board_id AND tb\.deleted_at IS NOT NULL\)/,
    'groups on a trashed cluster are not found');
});
