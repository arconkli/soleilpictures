// demoCardCapWords.test.mjs — the whole sentences say what the cap's callers
// used to build from rejectedNoun's word, for every noun and count.
//
//   node --import ./scripts/linguiNode.mjs --test src/lib/demoCardCapWords.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rejectedNoun } from './demoCardCap.js';
import { rejectedNotAdded, rejectedMoreDidntFit } from './demoCardCapWords.js';

const BATCHES = [{ image: 28 }, { image: 1 }, { image: 20, note: 3 }, { note: 4 }, { card: 2 }, {}, null];

test('"N photos couldn\'t be added." is what the modal said with the noun in the middle', () => {
  for (const kinds of BATCHES) {
    for (const n of [1, 2, 3, 28, 100]) {
      const noun = rejectedNoun(kinds, n);
      assert.equal(rejectedNotAdded(noun, n), `${n} ${noun} couldn't be added.`, `${JSON.stringify(kinds)} ${n}`);
    }
  }
});

test('"N more photos didn\'t fit. " is what the cap toast said', () => {
  for (const kinds of BATCHES) {
    for (const n of [1, 2, 3, 28, 100]) {
      const noun = rejectedNoun(kinds, n);
      assert.equal(rejectedMoreDidntFit(noun, n), `${n} more ${noun} didn't fit. `, `${JSON.stringify(kinds)} ${n}`);
    }
  }
});
