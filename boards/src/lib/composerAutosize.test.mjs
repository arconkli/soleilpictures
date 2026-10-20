// The message field grows with what's typed, up to 8 lines or 40% of the
// panel, then scrolls inside itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fieldHeight } from './autosize.js';

const field = { lineHeight: 20, paddingY: 18, borderY: 2 };

test('one line, then as tall as the text', () => {
  assert.deepEqual(fieldHeight({ ...field, scrollHeight: 38 }), { height: 40, scrolls: false });
  assert.deepEqual(fieldHeight({ ...field, scrollHeight: 78 }), { height: 80, scrolls: false });
  assert.equal(fieldHeight({ ...field, scrollHeight: 0 }).height, 40, 'never shorter than a line');
});

test('capped at 8 lines, then it scrolls', () => {
  const r = fieldHeight({ ...field, scrollHeight: 600 });
  assert.equal(r.height, 20 * 8 + 18 + 2);
  assert.equal(r.scrolls, true);
});

test('a short panel caps it at 40% of its height', () => {
  const r = fieldHeight({ ...field, scrollHeight: 600, panelHeight: 300 });
  assert.equal(r.height, 120);
  assert.equal(r.scrolls, true);
  assert.equal(fieldHeight({ ...field, scrollHeight: 600, panelHeight: 50 }).height, 40, 'but always one line');
});

test('the composer and the edit box grow; the stylesheet doesn’t cap them below that', () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  assert.match(read('../components/MessageComposer.jsx'), /<GrowingTextarea\s+ref=\{inputRef\}/);
  assert.match(read('../components/MessageBubble.jsx'), /<GrowingTextarea focusAtEnd value=\{editBody\}/);
  const css = read('../styles.css');
  const rule = css.slice(css.indexOf('.msg-composer-input {'), css.indexOf('}', css.indexOf('.msg-composer-input {')));
  assert.doesNotMatch(rule, /max-height/);
});

test('the text is measured in a hidden copy, never by collapsing the field (that let the thread go of the bottom)', () => {
  const hook = readFileSync(new URL('../hooks/useAutosizeTextarea.js', import.meta.url), 'utf8');
  assert.doesNotMatch(hook, /style\.height = 'auto'/);
  assert.match(hook, /mirror\.value = el\.value;/);
  assert.match(hook, /if \(el\.style\.height !== h\) el\.style\.height = h;/);
});
