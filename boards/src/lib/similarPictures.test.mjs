// similarPictures.test.mjs — More like this keeps only the close pictures.
//
//   node --test src/lib/similarPictures.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSimilar, similarCardOf, SIMILAR_MAX_DIST, SIMILAR_LIMIT } from './similarPictures.js';

const B = '11111111-1111-1111-1111-111111111111';

test('only pictures within the distance show, nearest first', () => {
  const got = pickSimilar([
    { board_id: B, card_id: 'far', distance: SIMILAR_MAX_DIST + 0.01 },
    { board_id: B, card_id: 'b', distance: 0.31 },
    { board_id: B, card_id: 'a', distance: 0.12 },
    { board_id: B, card_id: 'edge', distance: SIMILAR_MAX_DIST },
  ]);
  assert.deepEqual(got.map((x) => x.cardId), ['a', 'b', 'edge']);
  assert.equal(got[0].boardId, B);
});

test('nothing close is an empty strip, not strangers', () => {
  assert.deepEqual(pickSimilar([{ board_id: B, card_id: 'x', distance: 0.5 }]), []);
  assert.deepEqual(pickSimilar(null), []);
  assert.deepEqual(pickSimilar([{ board_id: B, card_id: 'x', distance: null }]), []);
});

test('a card counts once, and the strip is capped', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({ board_id: B, card_id: `c${i % 20}`, distance: 0.1 + i / 1000 }));
  const got = pickSimilar(rows);
  assert.equal(got.length, SIMILAR_LIMIT);
  assert.equal(new Set(got.map((x) => x.cardId)).size, got.length);
});

test('a card without a stored picture is no thumbnail', () => {
  assert.equal(similarCardOf({ card_id: 'x', meta: { src: 'https://example.com/a.jpg' } }), null);
  assert.equal(similarCardOf({ card_id: 'x', meta: {} }), null);
  assert.deepEqual(similarCardOf({ card_id: 'x', title: '', meta: { src: 'r2:w/a.webp', fileName: 'a.webp' } }),
    { id: 'x', kind: 'image', src: 'r2:w/a.webp', title: '', fileName: 'a.webp' });
});
