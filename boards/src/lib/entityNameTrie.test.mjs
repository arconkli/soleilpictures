// entityNameTrie — names found in any script, English unchanged.
// Run: node --test src/lib/entityNameTrie.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createNameIndex } from './entityNameTrie.js';

const run = (names, text) => {
  const ix = createNameIndex();
  names.forEach((n, i) => ix.add({ kind: 'tag', id: String(i), name: n }));
  return [...ix.findMatches(text)].map(m => [m.start, m.end]);
};

test('English', () => {
  const names = ['art', 'Rough Cut', 'ARRI Alexa', 'Q1', 'lens'];
  const cases = [
    ['smart art.', [[2, 5], [6, 9]]], // the old missing left-boundary check, kept on purpose
    ['darts', []],
    ['The ARRI Alexa rig', [[4, 14]]],
    ['a rough cut!', [[2, 11]]],
    ['a rough  cut', []],
    ['Q1 plans, q1', [[0, 2], [10, 12]]],
    ['lens-flare', [[0, 4]]],
    ['café art', [[5, 8]]],
  ];
  for (const [text, want] of cases) assert.deepEqual(run(names, text), want, text);
});

test('scripts', () => {
  const cases = [
    ['서울', '서울에서 영화를 찍었다', [[0, 2]]],
    ['서울', '경서울', []],
    ['東京', '昨日東京駅で', [[2, 4]]],
    ['猫', '猫が好き', []],
    ['猫', '「猫」', [[1, 2]]],
    ['кино', 'Хорошее кино!', [[8, 12]]],
    ['кино', 'кинотеатр', []],
    ['Москва', 'в Москве', []], // inflection is not handled; documented
    ['القاهرة', 'بالقاهرة', [[1, 8]]],
    ['القاهرة', 'مالقاهرة', []],
    ['ירושלים', 'צילמנו בירושלים', [[8, 15]]],
    ['हिन', 'हिन्दी', []],
    ['ΟΔΟΣ', 'η οδος.', [[2, 6]]],
    ['Café', 'Café society', [[0, 5]]], // NFD text
    ['𠮷野家', 'きのう𠮷野家で', [[3, 7]]], // astral
  ];
  for (const [name, text, want] of cases) assert.deepEqual(run([name], text), want, `${name} in ${text}`);
});

test('records and clear', () => {
  const ix = createNameIndex();
  ix.add({ kind: 'tag', id: '1', name: 'Café' });
  assert.equal(ix.records.length, 1);
  ix.clear();
  assert.equal(ix.records.length, 0);
  assert.deepEqual([...ix.findMatches('Café')], []);
});
