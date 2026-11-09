// textFold.test.mjs — the JS fold and the SQL fold are one fold.
//
//   node --test src/lib/textFold.test.mjs
//
// The fixture pairs live in the migration (0879's proof block runs them
// through public.search_fold); this runs foldForSearch over the same list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from './migrationText.mjs';
import { foldForSearch, searchKey, findFolded, minSearchLength, searchLength } from './textFold.js';

const sql = readFileSync(join(MIGRATIONS_DIR, '0879_search_fold.sql'), 'utf8');
const block = sql.split('-- fold-fixtures:start')[1].split('-- fold-fixtures:end')[0];
const unq = (s) => s.replace(/''/g, "'");
const PAIRS = [...block.matchAll(/\('((?:[^']|'')*)',\s*'((?:[^']|'')*)'\)/g)].map((m) => [unq(m[1]), unq(m[2])]);

test('the migration lists its fixture pairs', () => {
  assert.ok(PAIRS.length >= 25, `${PAIRS.length} pairs`);
  assert.equal(block.split('\n').filter((l) => l.includes("('")).length, PAIRS.length, 'one pair per line');
});

test('foldForSearch gives the migration\'s expected value for every pair', () => {
  for (const [input, expected] of PAIRS) {
    assert.equal(foldForSearch(input), expected, `${JSON.stringify(input)}`);
  }
});

test('the breve on й and ў stays, a decomposed one included', () => {
  assert.equal(foldForSearch('й'), 'й');
  assert.equal(foldForSearch('ў'), 'ў');
  assert.equal(foldForSearch('ё'), 'е');
});

test('searchKey folds, lowercases and ignores the form it was typed in', () => {
  assert.equal(searchKey('Café'), 'cafe');
  assert.equal(searchKey('Café'), 'cafe');
  assert.equal(searchKey('İstanbul'), 'istanbul');
  assert.equal(searchKey('Łódź'), 'lodz');
  assert.ok(searchKey('Château de Lumière').includes(searchKey('LUMIERE')));
  assert.equal(searchKey(null), '');
});

test('one character is enough for Chinese, Japanese and Korean only', () => {
  for (const q of ['한', '東', 'あ', 'ア', ' 東 ']) assert.equal(minSearchLength(q), 1, q);
  for (const q of ['a', 'é', '😀', '東京', '']) assert.equal(minSearchLength(q), 2, q);
  assert.equal(searchLength('😀'), 1);
  assert.equal(searchLength(' 東京 '), 2);
});

test('a final sigma meets the plain one', () => {
  assert.equal(searchKey('ΟΔΟΣ'), searchKey('οδοσ'));
  assert.equal(searchKey('οδοσ'), searchKey('οδός'));
});

test('findFolded returns offsets into the text as passed', () => {
  const cases = [
    ['Straße 12', 'strasse', { start: 0, end: 6 }],
    ['ΟΔΟΣ ΑΘΗΝΑ', 'οδός', { start: 0, end: 4 }],
    ['Act II rev', 'Act（II）', { start: 0, end: 6 }],
    ['Café', 'cafe', { start: 0, end: 4 }],
    ['😀 Café', 'cafe', { start: 3, end: 7 }],
    ['İstanbul', 'istanbul', { start: 0, end: 8 }],
    ['i̇stanbul', 'İstanbul', { start: 0, end: 9 }],
    ['the Act II (rev) draft', 'Act II (rev)', { start: 4, end: 16 }],
    ['x', '', null],
    ['abc', 'zz', null],
  ];
  for (const [text, q, want] of cases) assert.deepEqual(findFolded(text, q), want, `${text} / ${q}`);
});
