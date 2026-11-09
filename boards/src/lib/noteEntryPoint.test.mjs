import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordAt, noteEntryFromEvent } from './noteEntryPoint.js';

test('wordAt picks the word around the offset', () => {
  assert.deepEqual(wordAt('alpha bravo charlie', 14), [12, 19]);
  assert.deepEqual(wordAt('alpha bravo charlie', 12), [12, 19]); // left edge
  assert.deepEqual(wordAt('alpha bravo', 5), [0, 5]);            // right edge
  assert.deepEqual(wordAt("don't stop", 2), [0, 5]);
  assert.deepEqual(wordAt('ab￼cd', 1), [0, 2]);              // a mention is not part of a word
});

test('wordAt answers null on spaces and punctuation', () => {
  assert.equal(wordAt('a  b', 2), null);
  assert.equal(wordAt('— —', 1), null);
  assert.equal(wordAt('', 0), null);
  assert.equal(wordAt('abc', 9), null);
});

test('noteEntryFromEvent: every pointer places a caret', () => {
  assert.deepEqual(noteEntryFromEvent({ clientX: 10, clientY: 20, pointerType: 'mouse' }), { x: 10, y: 20, mode: 'caret' });
  assert.deepEqual(noteEntryFromEvent({ clientX: 10, clientY: 20 }), { x: 10, y: 20, mode: 'caret' });
  assert.equal(noteEntryFromEvent({ clientX: 1, clientY: 2, pointerType: 'touch' }).mode, 'caret');
  assert.equal(noteEntryFromEvent({ clientX: 1, clientY: 2 }, 'pen').mode, 'caret');
  assert.equal(noteEntryFromEvent({}), null);
  assert.equal(noteEntryFromEvent(null), null);
});
