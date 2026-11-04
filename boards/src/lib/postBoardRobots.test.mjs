// node --test src/lib/postBoardRobots.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUnlistedBoard, postBoardRobots } from './postBoardRobots.js';

test('a listed board gets nothing', () => {
  assert.equal(postBoardRobots({ board_id: 'x', unlisted: false }), null);
  assert.equal(isUnlistedBoard({ board_id: 'x', unlisted: false }), false);
});

test('an unlisted board is noindex', () => {
  assert.equal(postBoardRobots({ board_id: 'x', unlisted: true }), 'noindex');
  assert.equal(isUnlistedBoard({ board_id: 'x', unlisted: true }), true);
});

test('a meta without the field, or no meta, stays indexable', () => {
  assert.equal(postBoardRobots({ board_id: 'x' }), null);
  assert.equal(postBoardRobots(null), null);
  assert.equal(postBoardRobots(undefined), null);
  assert.equal(postBoardRobots({ unlisted: 'true' }), null);
});
