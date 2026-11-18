// boardEventGates — which realtime boards events are worth a re-read.
// Run: node --test src/lib/boardEventGates.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedBoardUpdateNeedsRefetch as shared, trieBoardEventNeedsReload as trie } from './boardEventGates.js';

const cached = {
  board_id: 'b1', board_name: 'Shoot', parent_board_id: 'p1', board_view: 'canvas',
  board_cover: 'neutral', source_workspace_id: 'w1', scheduled_date: '2026-11-20',
  sched_published_at: '2026-11-01T10:00:00+00:00', day_types: { a: 1 }, day_start: '09:00:00',
  sched_status: 'draft', sched_version: 0, updated_at: '2026-11-01T10:00:00+00:00',
};
const row = (o = {}) => ({
  id: 'b1', name: 'Shoot', parent_board_id: 'p1', view: 'canvas', cover: 'neutral',
  workspace_id: 'w1', scheduled_date: '2026-11-20', sched_published_at: '2026-11-01T10:00:00Z',
  day_types: '{"a":1}', day_start: '09:00:00', sched_status: 'draft', sched_version: 0,
  updated_at: '2026-11-17T00:00:00Z', ...o,
});

test('shared: unchanged shown fields do not refetch, even if updated_at moved', () => {
  assert.equal(shared(cached, row()), false);
});
test('shared: a shown field changing refetches', () => {
  for (const o of [{ name: 'New' }, { parent_board_id: 'p2' }, { cover: 'blue' }, { scheduled_date: '2026-11-21' },
    { sched_version: 1 }, { day_types: { a: 2 } }, { day_start: '10:00:00' }, { deleted_at: '2026-11-17T00:00:00Z' }]) {
    assert.equal(shared(cached, row(o)), true, JSON.stringify(o));
  }
});
test('shared: a board not on the list refetches', () => {
  assert.equal(shared(undefined, row()), true);
});
test('shared: columns missing from the payload are skipped', () => {
  assert.equal(shared(cached, { id: 'b1', name: 'Shoot' }), false);
});

test('trie: insert and delete always reload', () => {
  assert.equal(trie('INSERT', row(), new Map()), true);
  assert.equal(trie('DELETE', { id: 'b1' }, new Map([['b1', 'Shoot']])), true);
});
test('trie: update with the same name does not reload', () => {
  assert.equal(trie('UPDATE', row(), new Map([['b1', 'Shoot']])), false);
});
test('trie: renamed or unknown board reloads', () => {
  assert.equal(trie('UPDATE', row({ name: 'Other' }), new Map([['b1', 'Shoot']])), true);
  assert.equal(trie('UPDATE', row(), new Map()), true);
});
test('trie: trashing a known board reloads, an unknown trashed one does not', () => {
  assert.equal(trie('UPDATE', row({ deleted_at: 'x' }), new Map([['b1', 'Shoot']])), true);
  assert.equal(trie('UPDATE', row({ deleted_at: 'x' }), new Map()), false);
});
