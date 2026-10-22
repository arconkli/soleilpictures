import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyCounts, countsFromRows, countsFromItems, rollupCounts, withLive } from './sidebarCounts.js';

const c = (total, unplaced = 0, byShelf = { photos: total }) => ({ byShelf, total, unplaced });

test('emptyCounts', () => {
  assert.deepEqual(emptyCounts(), { byShelf: {}, total: 0, unplaced: 0 });
  assert.notEqual(emptyCounts().byShelf, emptyCounts().byShelf);
});

test('countsFromRows sums duplicates, ignores bad shelves', () => {
  const m = countsFromRows([
    { board_id: 'a', shelf: 'photos', n: 3, n_unplaced: 1 },
    { board_id: 'a', shelf: 'photos', n: 2, n_unplaced: 0 },
    { board_id: 'a', shelf: 'files', n: 1, n_unplaced: 1 },
    { board_id: 'a', shelf: null, n: 9, n_unplaced: 9 },
    { board_id: 'a', shelf: 'bogus', n: 9, n_unplaced: 9 },
    { board_id: 'b', shelf: 'video', n: 4, n_unplaced: 0 },
  ]);
  assert.deepEqual(m.get('a'), { byShelf: { photos: 5, files: 1 }, total: 6, unplaced: 2 });
  assert.equal(m.get('b').total, 4);
  assert.equal(countsFromRows(null).size, 0);
});

test('countsFromItems', () => {
  const r = countsFromItems([
    { shelf: 'photos', unplaced: true }, { shelf: 'photos', unplaced: false }, { shelf: 'writing', unplaced: false },
    { shelf: null },
  ]);
  assert.deepEqual(r, { byShelf: { photos: 2, writing: 1 }, total: 3, unplaced: 1 });
});

test('rollup across three levels, missing boards as zero', () => {
  const boards = [
    { id: 'root', parent_board_id: null }, { id: 'mid', parent_board_id: 'root' },
    { id: 'leaf', parent_board_id: 'mid' }, { id: 'empty', parent_board_id: 'leaf' },
    { id: 'sib', parent_board_id: 'root' },
  ];
  const own = new Map([['root', c(1, 0)], ['mid', c(2, 1)], ['leaf', c(4, 2)]]);
  const r = rollupCounts(boards, own);
  assert.equal(r.get('root').total, 7);
  assert.equal(r.get('root').unplaced, 3);
  assert.equal(r.get('mid').total, 6);
  assert.equal(r.get('leaf').total, 4);
  assert.equal(r.get('empty').total, 0);
  assert.deepEqual(r.get('empty').own, emptyCounts());
  assert.equal(r.get('sib').total, 0);
  assert.equal(r.get('root').own.total, 1);
});

test('rollup survives a parent cycle without double counting', () => {
  const boards = [{ id: 'a', parent_board_id: 'b' }, { id: 'b', parent_board_id: 'a' }, { id: 'self', parent_board_id: 'self' }];
  const own = new Map([['a', c(1)], ['b', c(2)], ['self', c(5)]]);
  const r = rollupCounts(boards, own);
  assert.equal(r.get('a').total, 3);
  assert.equal(r.get('b').total, 3);
  assert.equal(r.get('self').total, 5);
});

test('rollup skips deleted boards and their subtrees', () => {
  const boards = [
    { id: 'r', parent_board_id: null }, { id: 'd', parent_board_id: 'r', deleted_at: '2026-01-01' },
    { id: 'k', parent_board_id: 'd' },
  ];
  const r = rollupCounts(boards, new Map([['r', c(1)], ['d', c(10)], ['k', c(100)]]));
  assert.equal(r.get('r').total, 1);
  assert.ok(!r.has('d'));
});

test('withLive returns a new map', () => {
  const own = new Map([['a', c(1)], ['b', c(2)]]);
  const next = withLive(own, 'a', c(9));
  assert.notEqual(next, own);
  assert.equal(next.get('a').total, 9);
  assert.equal(own.get('a').total, 1);
  assert.equal(next.get('b').total, 2);
  assert.equal(withLive(undefined, 'z', c(1)).get('z').total, 1);
});
