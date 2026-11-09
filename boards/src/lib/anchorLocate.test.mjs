// anchorLocate — Run: node --test src/lib/anchorLocate.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { locateAnchor } from './anchorLocate.js';

test('locateAnchor', () => {
  assert.deepEqual(locateAnchor('The key light was warm', 'key light', 4), { start: 4, length: 9 });
  assert.deepEqual(locateAnchor('art and art', 'art', 7), { start: 8, length: 3 });
  assert.deepEqual(locateAnchor('art and art', 'art', NaN), { start: 0, length: 3 });
  assert.equal(locateAnchor('Hello', 'xyz', 0), null);
  assert.deepEqual(locateAnchor('Хорошее Кино!', 'кино', 0), { start: 8, length: 4 });
  // decomposed text, composed claim
  assert.deepEqual(locateAnchor('Café society', 'Café', 0), { start: 0, length: 5 });
  // composed text, decomposed claim
  assert.deepEqual(locateAnchor('Café society', 'Café', 0), { start: 0, length: 4 });
  assert.deepEqual(locateAnchor('照明を調整した', '照明', 0), { start: 0, length: 2 });
});
