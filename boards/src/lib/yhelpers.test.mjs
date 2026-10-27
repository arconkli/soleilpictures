// readCards must survive a value under `cards` that is not a Y.Map. A raw-Yjs
// writer that skipped cardToYMap once left strings there, and every client
// that opened the board threw "e.forEach is not a function" on every update.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { cardToYMap, readCards, writeCardFields, readGroups, groupYMap, upsertGroup } from './yhelpers.js';

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

// ── writeCardFields: patches land on the card's existing Y.Map ──────────────
//
// The API used to rebuild a patched card with cardToYMap and set it over the
// old one. For a doc card that re-created its pages and comments as copies:
// an editor open on the doc kept typing into the deleted original, comment
// anchors lost their place, and a collaborator's concurrent edit to any other
// field was lost. These pin the in-place write that replaced it.

function docCard(doc) {
  const cards = doc.getMap('cards');
  const ym = new Y.Map();
  cards.set('d1', ym);
  ym.set('id', 'd1');
  ym.set('kind', 'doc');
  ym.set('title', 'Treatment');
  ym.set('x', 10);
  const pages = new Y.Array();
  ym.set('docPages', pages);
  pages.push([{ id: 'p1', name: 'Page 1' }]);
  const content = new Y.Map();
  ym.set('docPageContent', content);
  const frag = new Y.XmlFragment();
  content.set('p1', frag);
  const para = new Y.XmlElement('paragraph');
  para.insert(0, [new Y.XmlText('Night. Rain on neon.')]);
  frag.insert(0, [para]);
  return { cards, ym, pages, content, frag };
}

test('writeCardFields keeps a doc card\'s nested types — the same instances, content intact', () => {
  const doc = new Y.Doc();
  const { ym, pages, content, frag } = docCard(doc);
  doc.transact(() => writeCardFields(ym, { title: 'Renamed', updatedAt: '2026-10-24T00:00:00Z' }));
  assert.equal(ym.get('title'), 'Renamed');
  assert.equal(ym.get('updatedAt'), '2026-10-24T00:00:00Z');
  assert.equal(ym.get('docPages'), pages);
  assert.equal(ym.get('docPageContent'), content);
  assert.equal(content.get('p1'), frag);
  assert.match(frag.toString(), /Night\. Rain on neon\./);
});

test('writeCardFields never lets a plain value replace a nested type', () => {
  const doc = new Y.Doc();
  const { ym, pages } = docCard(doc);
  doc.transact(() => writeCardFields(ym, { docPages: null, title: 'Still renamed' }));
  assert.equal(ym.get('docPages'), pages);
  assert.equal(ym.get('title'), 'Still renamed');
});

test('writeCardFields keeps a collaborator\'s concurrent edit to another field', () => {
  const a = new Y.Doc();
  docCard(a);
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

  // Concurrently: the API renames on A while a collaborator moves the card on B.
  const ymA = a.getMap('cards').get('d1');
  a.transact(() => writeCardFields(ymA, { title: 'Renamed by the API' }));
  b.transact(() => b.getMap('cards').get('d1').set('x', 400));

  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  for (const d of [a, b]) {
    const ym = d.getMap('cards').get('d1');
    assert.equal(ym.get('title'), 'Renamed by the API');
    assert.equal(ym.get('x'), 400);
    assert.match(ym.get('docPageContent').get('p1').toString(), /Rain on neon/);
  }
});

test('writeCardFields adds nothing to the doc for a patch that changes nothing', () => {
  const doc = new Y.Doc();
  const { ym } = docCard(doc);
  let updates = 0;
  doc.on('update', () => { updates += 1; });
  doc.transact(() => writeCardFields(ym, { title: 'Treatment', x: 10 }));
  assert.equal(updates, 0);
});

test('writeCardFields copies a Y type that already lives in another doc', () => {
  const other = new Y.Doc();
  const foreign = other.getMap('scratch');
  foreign.set('cells', new Y.Map());
  foreign.get('cells').set('a1', 'img');

  const doc = new Y.Doc();
  const { ym } = docCard(doc);
  doc.transact(() => writeCardFields(ym, { gridCells: foreign.get('cells') }));
  const cells = ym.get('gridCells');
  assert.notEqual(cells, foreign.get('cells'));
  assert.equal(cells.get('a1'), 'img');
  assert.equal(foreign.get('cells').doc, other);
});

// The same failure under `groups`: the API saved groups as plain objects until
// 2026-10-27, readGroups threw "s.forEach is not a function" on the first one,
// and a cluster an assistant had sectioned never finished opening.
test('readGroups reads a group saved as a plain object, and skips a value that is no group', () => {
  const doc = new Y.Doc();
  const groups = doc.getMap('groups');
  const ym = new Y.Map();
  ym.set('id', 'g1');
  ym.set('name', 'Stills');
  groups.set('g1', ym);
  groups.set('g2', { id: 'g2', name: 'Favorites', outline: true, kind: null });
  groups.set('g3', 'not a group');
  assert.deepEqual(readGroups(doc), [
    { id: 'g1', name: 'Stills' },
    { id: 'g2', name: 'Favorites', outline: true, kind: null },
  ]);
});

test('groupYMap turns a plain group into the Y.Map the app writes, and leaves a Y.Map as it is', () => {
  const doc = new Y.Doc();
  const groups = doc.getMap('groups');
  groups.set('g1', { id: 'g1', name: 'Favorites', color: null, gone: undefined });
  const g = doc.transact(() => groupYMap(groups, 'g1'));
  assert.ok(g instanceof Y.Map);
  assert.equal(groups.get('g1'), g);
  assert.deepEqual(g.toJSON(), { id: 'g1', name: 'Favorites', color: null });
  assert.equal(groupYMap(groups, 'g1'), g, 'the same instance the second time');
  assert.equal(groupYMap(groups, 'nope'), null);
});

test('upsertGroup sets fields in place, so an edit elsewhere to another field survives', () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  upsertGroup(a.getMap('groups'), 'g1', { id: 'g1', name: 'Stills', outline: true, color: undefined });
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const before = a.getMap('groups').get('g1');
  // A canvas renames it while an API call recolours it.
  b.getMap('groups').get('g1').set('name', 'Night stills');
  upsertGroup(a.getMap('groups'), 'g1', { id: 'g1', color: '#c8a04a' });
  assert.equal(a.getMap('groups').get('g1'), before, 'patched in place, not replaced');
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  for (const doc of [a, b]) {
    assert.deepEqual(readGroups(doc), [{ id: 'g1', name: 'Night stills', outline: true, color: '#c8a04a' }]);
  }
});
