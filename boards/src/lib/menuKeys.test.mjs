// menuKeys.test.mjs — where a key moves the focus in a menu.
//
//   node --test src/lib/menuKeys.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { menuMove, menuTypeahead } from './menuKeys.js';

test('↓ ↑ walk the rows, round from either end', () => {
  assert.equal(menuMove('ArrowDown', 0, 3), 1);
  assert.equal(menuMove('ArrowDown', 2, 3), 0);
  assert.equal(menuMove('ArrowUp', 0, 3), 2);
  assert.equal(menuMove('ArrowUp', 2, 3), 1);
});

test('from the menu itself, ↓ is the first row and ↑ the last', () => {
  assert.equal(menuMove('ArrowDown', -1, 3), 0);
  assert.equal(menuMove('ArrowUp', -1, 3), 2);
});

test('Home and End go to either end', () => {
  assert.equal(menuMove('Home', 2, 4), 0);
  assert.equal(menuMove('End', 0, 4), 3);
});

test('any other key, or no rows, is not the menu\'s', () => {
  assert.equal(menuMove('ArrowLeft', 1, 3), null);
  assert.equal(menuMove('Enter', 1, 3), null);
  assert.equal(menuMove('ArrowDown', -1, 0), null);
});

test('a letter goes to the next row it starts, round from the end', () => {
  const rows = ['Draw', 'Shape', 'Palette', 'File', 'Folder'];
  assert.equal(menuTypeahead('f', rows, -1), 3);
  assert.equal(menuTypeahead('f', rows, 3), 4);
  assert.equal(menuTypeahead('F', rows, 4), 3);
  assert.equal(menuTypeahead('s', rows, 0), 1);
  assert.equal(menuTypeahead('z', rows, 0), null);
  assert.equal(menuTypeahead(' ', rows, 0), null);
});

test('a row\'s words are matched from their start, past any space', () => {
  assert.equal(menuTypeahead('l', ['  Link', 'Linked cluster'], -1), 0);
});
