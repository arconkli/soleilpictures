// The app's words for working live together (liveTogetherWords.js) say exactly
// what liveTogether.js says, which tests/together-chip.spec.js asserts.
//
//   node --import ./scripts/linguiNode.mjs --test src/lib/liveTogetherWords.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as plain from './liveTogether.js';
import * as words from './liveTogetherWords.js';

const cases = {
  chipLabel: [[0], [1], [3]],
  chipShortLabel: [[0], [3]],
  chipAria: [[0], [1], [2]],
  togetherTitle: [[['Lena']], [['Lena', 'Sam']], [['A', 'B', 'C']], [[], 1], [[''], 1], [['A', 'B'], 3], [[], 0]],
  rateLine: [[1], [2], [3]],
  monthLine: [[9, 25], [0], [1, 1]],
  capLine: [[25], [undefined], [1]],
  groupHint: [[1], [2], [3]],
  arrivalNote: [[['Lena']], [['Lena', 'Sam']], [['Lena', 'Sam', 'Ana']], [[], 1], [[], 3], [['Lena'], 2], [['A', 'B', 'C'], 2]],
  settingsLine: [[9], [0, 25], [3, 1]],
};

test('every word the plain module says, the mirror says the same', () => {
  for (const [fn, calls] of Object.entries(cases)) {
    for (const args of calls) {
      assert.equal(words[fn](...args), plain[fn](...args), `${fn}(${JSON.stringify(args)})`);
    }
  }
});

test('chipEarned is the part of the chip after the dot', () => {
  assert.equal(words.chipEarned(1), '+1 card');
  assert.equal(words.chipEarned(3), '+3 cards');
  for (const n of [1, 3]) assert.equal(plain.chipLabel(n).split('· ')[1], words.chipEarned(n));
});
