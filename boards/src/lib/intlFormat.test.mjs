import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setUiLocale } from './uiLocale.js';
import { joinSentences, sizeText, dollarsText, namesList } from './intlFormat.js';

function inLocale(l, fn) {
  setUiLocale(l);
  try { return fn(); } finally { setUiLocale('en'); }
}

test('joinSentences: a space between sentences, none in Japanese, empty parts left out', () => {
  assert.equal(joinSentences('One.', 'Two.'), 'One. Two.');
  assert.equal(joinSentences(['One.', '', null, 'Two.']), 'One. Two.');
  assert.equal(inLocale('ja', () => joinSentences('一。', '二。')), '一。二。');
  assert.equal(inLocale('ru', () => joinSentences('Раз.', 'Два.')), 'Раз. Два.');
});

test('sizeText and dollarsText: English is the caller\'s own text; others get Intl with the same decimals', () => {
  assert.equal(sizeText('1.5 MB', 1.5, 'megabyte', 1), '1.5 MB');
  assert.equal(sizeText('1.0MB', 1, 'megabyte', 1), '1.0MB');
  assert.equal(dollarsText('$12.50', 12.5, 2), '$12.50');
  const space = (s) => s.replace(/\s/g, ' ');
  assert.equal(inLocale('fr', () => space(sizeText('1.5 MB', 1.5, 'megabyte', 1))), '1,5 Mo');
  assert.equal(inLocale('ru', () => space(sizeText('1.0 MB', 1, 'megabyte', 1))), '1,0 МБ');
  assert.equal(inLocale('es', () => space(sizeText('12 KB', 12, 'kilobyte'))), '12 kB');
  assert.equal(inLocale('fr', () => space(dollarsText('$12.50', 12.5, 2))), '12,50 $US');
  assert.equal(inLocale('ja', () => dollarsText('$25', 25)), '$25');
});

test('namesList: English keeps "A, B and C" with no Oxford comma; other languages use the list rule', () => {
  assert.equal(namesList([]), '');
  assert.equal(namesList(['A']), 'A');
  assert.equal(namesList(['A', 'B']), 'A and B');
  assert.equal(namesList(['A', 'B', 'C']), 'A, B and C');
  assert.equal(inLocale('es', () => namesList(['A', 'B', 'C'])), 'A, B y C');
});
