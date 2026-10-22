import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shownWeight } from './iconWeight.js';

test('no floor leaves every weight as chosen', () => {
  for (const w of ['thin', 'light', 'regular', 'bold', 'fill', 'duotone']) assert.equal(shownWeight(w, null), w);
});

test('a regular floor lifts thin and light only', () => {
  assert.equal(shownWeight('thin', 'regular'), 'regular');
  assert.equal(shownWeight('light', 'regular'), 'regular');
  for (const w of ['regular', 'bold', 'fill', 'duotone']) assert.equal(shownWeight(w, 'regular'), w);
});

test('a floor never lowers a weight', () => {
  assert.equal(shownWeight('regular', 'light'), 'regular');
  assert.equal(shownWeight('light', 'thin'), 'light');
  assert.equal(shownWeight('thin', 'light'), 'light');
});
