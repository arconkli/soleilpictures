// setNoteCacheFields writes only what changed, so opening and closing a note
// without typing emits no Y update (NoteTiptapSurface's exit write and a
// co-editor's debounced re-derive both rely on it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { setNoteCacheFields } from './noteDocState.js';

function card() {
  const doc = new Y.Doc();
  const c = new Y.Map();
  doc.getMap('cards').set('n', c);
  c.set('html', '<p>a</p>');
  c.set('h', 120);
  return { doc, c };
}
function updatesDuring(doc, fn) {
  let n = 0;
  const on = () => { n += 1; };
  doc.on('update', on);
  fn();
  doc.off('update', on);
  return n;
}

test('setNoteCacheFields writes nothing when every value already matches', () => {
  const { doc, c } = card();
  assert.equal(updatesDuring(doc, () => setNoteCacheFields(doc, c, { html: '<p>a</p>', h: 120, body: null })), 0);
  assert.equal(c.has('body'), false);
});

test('setNoteCacheFields writes the changed keys in one update', () => {
  const { doc, c } = card();
  assert.equal(updatesDuring(doc, () => setNoteCacheFields(doc, c, { html: '<p>b</p>', h: 144, body: null })), 1);
  assert.equal(c.get('html'), '<p>b</p>');
  assert.equal(c.get('h'), 144);
});

test('body: null still clears a body that holds text', () => {
  const { doc, c } = card();
  c.set('body', 'old text');
  assert.equal(updatesDuring(doc, () => setNoteCacheFields(doc, c, { body: null })), 1);
  assert.equal(c.get('body'), null);
});
