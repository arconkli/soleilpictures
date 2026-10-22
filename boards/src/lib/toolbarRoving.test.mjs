// The arrow keys of a toolbar (hooks/useToolbarRoving): which key moves where,
// round from either end, and which keys a control inside the bar keeps for
// itself. tests/toolbar-keys.spec.js walks the real bars.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldKeepsKey, rovingIndex, rovingMove } from './toolbarRoving.js';

test('a bar across: ← → step, Home End jump, ↑ ↓ are left to the control', () => {
  assert.equal(rovingMove('ArrowRight', 'horizontal'), 1);
  assert.equal(rovingMove('ArrowLeft', 'horizontal'), -1);
  assert.equal(rovingMove('Home', 'horizontal'), 'first');
  assert.equal(rovingMove('End', 'horizontal'), 'last');
  assert.equal(rovingMove('ArrowDown', 'horizontal'), null);
  assert.equal(rovingMove('ArrowUp', 'horizontal'), null);
  assert.equal(rovingMove('Enter', 'horizontal'), null);
  assert.equal(rovingMove('ArrowRight'), 1, 'across unless it says otherwise');
});

test('a bar down (the tool rail): ↑ ↓ step, ← → are left to the control', () => {
  assert.equal(rovingMove('ArrowDown', 'vertical'), 1);
  assert.equal(rovingMove('ArrowUp', 'vertical'), -1);
  assert.equal(rovingMove('Home', 'vertical'), 'first');
  assert.equal(rovingMove('End', 'vertical'), 'last');
  assert.equal(rovingMove('ArrowRight', 'vertical'), null);
  assert.equal(rovingMove('ArrowLeft', 'vertical'), null);
});

test('the next control comes round from either end', () => {
  assert.equal(rovingIndex(0, 5, 1), 1);
  assert.equal(rovingIndex(4, 5, 1), 0);
  assert.equal(rovingIndex(0, 5, -1), 4);
  assert.equal(rovingIndex(2, 5, 'first'), 0);
  assert.equal(rovingIndex(2, 5, 'last'), 4);
  assert.equal(rovingIndex(0, 1, 1), 0, 'a bar of one stays put');
});

const text = (value, start, end = start) => ({ tagName: 'INPUT', type: 'text', value, selectionStart: start, selectionEnd: end });

test('a text field keeps its arrows until the caret is at its edge, and Home End always', () => {
  // Focus selects the size field's text: → collapses that first.
  assert.equal(fieldKeepsKey(text('14', 0, 2), 'ArrowRight'), true);
  assert.equal(fieldKeepsKey(text('14', 1), 'ArrowRight'), true);
  assert.equal(fieldKeepsKey(text('14', 2), 'ArrowRight'), false, 'at its end: on to the next control');
  assert.equal(fieldKeepsKey(text('14', 1), 'ArrowLeft'), true);
  assert.equal(fieldKeepsKey(text('14', 0), 'ArrowLeft'), false, 'at its start: back to the previous one');
  assert.equal(fieldKeepsKey(text('', 0), 'ArrowRight'), false, 'empty: both edges at once');
  assert.equal(fieldKeepsKey(text('14', 2), 'Home'), true);
  assert.equal(fieldKeepsKey(text('14', 0), 'End'), true);
  assert.equal(fieldKeepsKey(text('14', 2), 'ArrowDown'), true, 'the size field steps on ↑ ↓');
  assert.equal(fieldKeepsKey({ tagName: 'INPUT', type: 'search', value: 'ab', selectionStart: 2, selectionEnd: 2 }, 'ArrowRight'), false);
  assert.equal(fieldKeepsKey({ tagName: 'TEXTAREA', value: 'ab', selectionStart: 1, selectionEnd: 1 }, 'ArrowLeft'), true);
  // A field that won't say where its caret is (a number field) keeps every key.
  assert.equal(fieldKeepsKey({ tagName: 'INPUT', type: 'number', value: '3', selectionStart: null, selectionEnd: null }, 'ArrowRight'), true);
  assert.equal(fieldKeepsKey({ tagName: 'DIV', isContentEditable: true }, 'ArrowRight'), true);
});

test('a list gives up ← → Home End (Windows would change its value) and keeps ↑ ↓', () => {
  const select = { tagName: 'SELECT' };
  assert.equal(fieldKeepsKey(select, 'ArrowRight'), false);
  assert.equal(fieldKeepsKey(select, 'ArrowLeft'), false);
  assert.equal(fieldKeepsKey(select, 'Home'), false);
  assert.equal(fieldKeepsKey(select, 'End'), false);
  assert.equal(fieldKeepsKey(select, 'ArrowDown'), true);
  assert.equal(fieldKeepsKey(select, 'ArrowUp'), true);
});

test('a slider and a radio keep every arrow; a button, a check box and a link keep none', () => {
  for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
    assert.equal(fieldKeepsKey({ tagName: 'INPUT', type: 'range' }, key), true, `range ${key}`);
    assert.equal(fieldKeepsKey({ tagName: 'INPUT', type: 'radio' }, key), true, `radio ${key}`);
    assert.equal(fieldKeepsKey({ tagName: 'BUTTON' }, key), false, `button ${key}`);
    assert.equal(fieldKeepsKey({ tagName: 'INPUT', type: 'checkbox' }, key), false, `checkbox ${key}`);
    assert.equal(fieldKeepsKey({ tagName: 'A' }, key), false, `link ${key}`);
  }
  assert.equal(fieldKeepsKey({ tagName: 'DIV', getAttribute: (n) => (n === 'role' ? 'slider' : null) }, 'ArrowRight'), true, 'role="slider"');
});
