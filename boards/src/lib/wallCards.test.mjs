import test from 'node:test';
import assert from 'node:assert/strict';
import { wallCardsOf } from './demoCardCap.js';

test('wallCardsOf is always over the limit', () => {
  assert.equal(wallCardsOf({ limit: 50, rejected: 1 }), 51);
  assert.equal(wallCardsOf({ count: 50, limit: 50, rejected: 3 }), 53);
  assert.equal(wallCardsOf({ count: 48, limit: 50 }), 51);
  assert.equal(wallCardsOf({}), 1);
  assert.equal(wallCardsOf(), 1);
});
