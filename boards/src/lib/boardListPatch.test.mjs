// boardListPatch — a thumbnail stamp patches one board in place instead of
// refetching every board in the workspace (PERF-03).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyBoardEvents } from './boardListPatch.js';

const here = dirname(fileURLToPath(import.meta.url));
const WS = 'ws-1';
const map = () => ({
  a: { id: 'a', workspace_id: WS, name: 'Alpha', thumb_key: 'k/a.webp', thumb_updated_at: 't0', settings: { x: 1 } },
  b: { id: 'b', workspace_id: WS, name: 'Beta', thumb_key: null, thumb_updated_at: null },
});
const upd = (row) => ({ eventType: 'UPDATE', new: row });

test('a thumbnail stamp patches that board and keeps every other board object', () => {
  const prev = map();
  const { next, refresh } = applyBoardEvents(prev, [upd({ id: 'a', workspace_id: WS, thumb_updated_at: 't1', card_count: 12 })], WS);
  assert.equal(refresh, false);
  assert.notEqual(next, prev);
  assert.equal(next.b, prev.b, 'untouched boards keep their identity');
  assert.equal(next.a.thumb_updated_at, 't1');
  assert.equal(next.a.name, 'Alpha', 'columns the event omitted are kept');
  assert.equal(next.a.card_count, 12);
});

test('an UPDATE that changes nothing returns the same map (no render)', () => {
  const prev = map();
  const { next, refresh } = applyBoardEvents(prev, [upd({ ...prev.a, settings: { x: 1 } })], WS);
  assert.equal(refresh, false);
  assert.equal(next, prev);
});

test('a burst folds into one map', () => {
  const prev = map();
  const { next } = applyBoardEvents(prev, [
    upd({ id: 'a', workspace_id: WS, name: 'A2' }),
    upd({ id: 'b', workspace_id: WS, thumb_key: 'k/b.webp' }),
    upd({ id: 'a', workspace_id: WS, thumb_updated_at: 't9' }),
  ], WS);
  assert.equal(next.a.name, 'A2');
  assert.equal(next.a.thumb_updated_at, 't9');
  assert.equal(next.b.thumb_key, 'k/b.webp');
});

test('a soft delete drops the board, as listBoards would', () => {
  const prev = map();
  const { next, refresh } = applyBoardEvents(prev, [upd({ id: 'b', workspace_id: WS, deleted_at: '2026-10-11' })], WS);
  assert.equal(refresh, false);
  assert.equal(next.b, undefined);
  assert.equal(next.a, prev.a);
});

test('anything a patch cannot express asks for a refetch', () => {
  const prev = map();
  for (const burst of [
    [{ eventType: 'INSERT', new: { id: 'c', workspace_id: WS } }],
    [{ eventType: 'DELETE', old: { id: 'a' } }],
    [upd({ id: 'zzz', workspace_id: WS })],                       // restored from trash
    [upd({ id: 'a', workspace_id: 'other-ws' })],                 // moved out
    [{ eventType: 'UPDATE' }],                                    // no row
    [upd({ id: 'a', workspace_id: WS, name: 'x' }), { eventType: 'INSERT', new: { id: 'd' } }],
  ]) {
    const { next, refresh } = applyBoardEvents(prev, burst, WS);
    assert.equal(refresh, true, JSON.stringify(burst));
    assert.equal(next, prev);
  }
});

test('useBoardList folds realtime events through it', () => {
  const src = readFileSync(join(here, '..', 'hooks', 'useBoardList.js'), 'utf8');
  assert.match(src, /applyBoardEvents\(/);
});
