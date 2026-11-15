// errorWords.test.mjs — in English every sentence reads as it is thrown, and
// anything the table does not know passes through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_WORDS, shownError } from './errorWords.js';

test('every key reads back as itself in English, and none is empty', () => {
  const keys = Object.keys(ERROR_WORDS);
  assert.ok(keys.length > 20);
  for (const key of keys) {
    assert.ok(key.trim().length > 0, 'empty key');
    assert.equal(ERROR_WORDS[key](), key);
    assert.equal(shownError(new Error(key)), key);
    assert.equal(shownError(key), key);
  }
});

test('an unknown message passes through; a fallback or the value itself fills a gap', () => {
  assert.equal(shownError(new Error('duplicate key value violates constraint')), 'duplicate key value violates constraint');
  assert.equal(shownError('plain server text'), 'plain server text');
  assert.equal(shownError(new Error(''), 'Nothing'), 'Nothing');
  assert.equal(shownError(null, 'Nothing'), 'Nothing');
  assert.equal(shownError(42), '42');
  assert.equal(shownError(undefined), '');
  assert.equal(shownError(new Error('toString')), 'toString');   // not a table key
});
