// boardTree.test.mjs — node --test src/lib/boardTree.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ancestorPath, boardDepth } from './boardTree.js';

const boards = {
  root: { id: 'root', parent_board_id: null },
  a:    { id: 'a', parent_board_id: 'root' },
  b:    { id: 'b', parent_board_id: 'a' },
  orphan: { id: 'orphan', parent_board_id: 'gone' },
  x:    { id: 'x', parent_board_id: 'y' },
  y:    { id: 'y', parent_board_id: 'x' },
};

test('the root is depth 0 and each level adds one', () => {
  assert.equal(boardDepth(boards, 'root'), 0);
  assert.equal(boardDepth(boards, 'a'), 1);
  assert.equal(boardDepth(boards, 'b'), 2);
});

test('an unknown id, a broken chain or a loop reads as null, never a made-up number', () => {
  assert.equal(boardDepth(boards, 'nope'), null);
  assert.equal(boardDepth(boards, null), null);
  assert.equal(boardDepth(boards, 'orphan'), null);
  assert.equal(boardDepth(boards, 'x'), null);
  assert.equal(boardDepth(null, 'a'), null);
});

test('the path to a board runs from the root, so the breadcrumb keeps its parents', () => {
  assert.deepEqual(ancestorPath(boards, 'b'), ['root', 'a', 'b']);
  assert.deepEqual(ancestorPath(boards, 'root'), ['root']);
});

test('a broken or looping chain falls back to the board alone, never a wrong path', () => {
  assert.deepEqual(ancestorPath(boards, 'orphan'), ['orphan']);
  assert.deepEqual(ancestorPath(boards, 'x'), ['x']);
  assert.deepEqual(ancestorPath(boards, 'nope'), ['nope']);
  assert.deepEqual(ancestorPath(boards, null), []);
});
