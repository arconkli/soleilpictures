import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_FONT_SIZE_V, noteFontSizePatch, noteFontStyle } from './noteFontSize.js';

test('a size pick stamps the note so its size renders', () => {
  assert.deepEqual(noteFontSizePatch(18), { fontSize: 18, fontSizeV: NOTE_FONT_SIZE_V });
  assert.deepEqual(noteFontStyle(null, 18, NOTE_FONT_SIZE_V), { fontSize: '18px', '--note-font-size': '18px' });
});

test('an unstamped stored size keeps the 15px text it was fitted at', () => {
  // fontSize stays inline on .note as it always was; only the variable the
  // text reads is withheld.
  assert.deepEqual(noteFontStyle(null, 31, undefined), { fontSize: '31px' });
  assert.deepEqual(noteFontStyle(null, 31, null), { fontSize: '31px' });
  assert.deepEqual(noteFontStyle(null, 31, 1), { fontSize: '31px' });
});

test('no size, no style; the family passes through either way', () => {
  assert.deepEqual(noteFontStyle(null, null, NOTE_FONT_SIZE_V), {});
  assert.deepEqual(noteFontStyle('Inter, sans-serif', null, null), { fontFamily: 'Inter, sans-serif' });
});
