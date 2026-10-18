// readCards must survive a value under `cards` that is not a Y.Map. A raw-Yjs
// writer that skipped cardToYMap once left strings there, and every client
// that opened the board threw "e.forEach is not a function" on every update.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { cardToYMap, readCards } from './yhelpers.js';

test('readCards skips card values that are not a Y.Map, warning once', () => {
  const doc = new Y.Doc();
  const cards = doc.getMap('cards');
  cards.set('a', cardToYMap({ id: 'a', kind: 'note', body: 'kept', x: 1, y: 2 }));
  cards.set('str', 'not a card');
  cards.set('obj', { kind: 'note', body: 'plain object' });
  cards.set('arr', new Y.Array());
  cards.set('b', cardToYMap({ id: 'b', kind: 'note', body: 'also kept', x: 3, y: 4 }));

  const warn = console.warn;
  const warned = [];
  console.warn = (...args) => { warned.push(args); };
  let first;
  let second;
  try {
    first = readCards(doc);
    second = readCards(doc);
  } finally {
    console.warn = warn;
  }

  assert.deepEqual(first.map((c) => c.id), ['a', 'b']);
  assert.equal(first[0].body, 'kept');
  // Still memoized: an unchanged card keeps its object identity.
  assert.equal(second[0], first[0]);
  assert.equal(warned.length, 1);
});

test('a card replaced by a bad value drops out of readCards', () => {
  const doc = new Y.Doc();
  const cards = doc.getMap('cards');
  cards.set('a', cardToYMap({ id: 'a', kind: 'note', body: 'x' }));
  assert.deepEqual(readCards(doc).map((c) => c.id), ['a']);
  cards.set('a', 42);
  assert.deepEqual(readCards(doc), []);
});
