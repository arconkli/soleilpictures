// cardCopy.test.mjs — copying a card must not re-parent live Y types.
//
//   node --test src/lib/cardCopy.test.mjs
//
// This is the regression suite for the production `yjs-transact` cluster: 9
// distinct users, every cross-board move and every ⌘D of a note / doc / grid
// card. Cards carry live nested Y types (noteFragment, docPages,
// docPageContent, gridCells), and cardToYMap used to hand those references
// straight to a second Y.Map. Re-integrating an integrated type throws out of
// _integrate — AFTER it has already repointed the SOURCE type's .doc at the
// destination.
//
// So each test asserts three things, not one: the copy doesn't throw, the
// content actually arrived, and the ORIGINAL is still intact. The third is the
// one that matters most — that was silent corruption of the board the user was
// still looking at.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { cardToYMap, cloneYValue, readCards, yMapToCard } from './yhelpers.js';

// A board doc with one card, shaped the way the app shapes them.
function boardWithCard(id, fields = {}, attach = null) {
  const doc = new Y.Doc();
  const cards = doc.getMap('cards');
  const ym = new Y.Map();
  doc.transact(() => {
    cards.set(id, ym);
    for (const [k, v] of Object.entries({ id, kind: 'note', x: 0, y: 0, ...fields })) ym.set(k, v);
    if (attach) attach(ym);
  });
  return { doc, cards, ym };
}

// ── the exact production crash ─────────────────────────────────────────

test('copying a note card with a live fragment does not throw', () => {
  const { doc, cards, ym } = boardWithCard('note-1', {}, (m) => {
    const frag = new Y.XmlFragment();
    m.set('noteFragment', frag);
  });
  // Fill after integration, the way the editor does.
  const frag = ym.get('noteFragment');
  doc.transact(() => {
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    t.insert(0, 'hello world');
    p.insert(0, [t]);
    frag.insert(0, [p]);
  });

  const card = yMapToCard(ym);
  // Pre-fix this threw: Cannot read properties of null (reading 'forEach').
  assert.doesNotThrow(() => {
    doc.transact(() => cards.set('note-2', cardToYMap({ ...card, id: 'note-2' })));
  });
});

test('the copied note keeps its text', () => {
  const { doc, cards, ym } = boardWithCard('note-1', {}, (m) => m.set('noteFragment', new Y.XmlFragment()));
  const frag = ym.get('noteFragment');
  doc.transact(() => {
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText();
    t.insert(0, 'hello world');
    p.insert(0, [t]);
    frag.insert(0, [p]);
  });

  doc.transact(() => cards.set('note-2', cardToYMap({ ...yMapToCard(ym), id: 'note-2' })));
  const copy = cards.get('note-2').get('noteFragment');
  assert.equal(String(copy), String(frag), 'copied fragment must serialize identically');
  assert.match(String(copy), /hello world/);
});

test('the SOURCE fragment still belongs to the source doc after a copy', () => {
  const { doc, cards, ym } = boardWithCard('note-1', {}, (m) => m.set('noteFragment', new Y.XmlFragment()));
  const frag = ym.get('noteFragment');
  doc.transact(() => {
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText(); t.insert(0, 'original');
    p.insert(0, [t]); frag.insert(0, [p]);
  });

  doc.transact(() => cards.set('note-2', cardToYMap({ ...yMapToCard(ym), id: 'note-2' })));

  // The corruption signature: _integrate reassigns .doc before throwing.
  assert.equal(frag.doc, doc, 'source fragment must NOT be repointed');
  assert.match(String(frag), /original/, 'source content must survive');
});

test('the copy is independent — editing it does not change the original', () => {
  const { doc, cards, ym } = boardWithCard('note-1', {}, (m) => m.set('noteFragment', new Y.XmlFragment()));
  const frag = ym.get('noteFragment');
  doc.transact(() => {
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText(); t.insert(0, 'original'); p.insert(0, [t]); frag.insert(0, [p]);
  });
  doc.transact(() => cards.set('note-2', cardToYMap({ ...yMapToCard(ym), id: 'note-2' })));

  const copy = cards.get('note-2').get('noteFragment');
  doc.transact(() => {
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText(); t.insert(0, 'appended'); p.insert(0, [t]);
    copy.insert(copy.length, [p]);
  });
  assert.match(String(copy), /appended/);
  assert.doesNotMatch(String(frag), /appended/, 'original must not see the copy’s edit');
});

// ── cross-DOCUMENT copy: the cross-board move ──────────────────────────

test('a note card moves to a DIFFERENT doc with its content', () => {
  const { doc, ym } = boardWithCard('note-1', {}, (m) => m.set('noteFragment', new Y.XmlFragment()));
  const frag = ym.get('noteFragment');
  doc.transact(() => {
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText(); t.insert(0, 'moved text'); p.insert(0, [t]); frag.insert(0, [p]);
  });

  const target = new Y.Doc();
  assert.doesNotThrow(() => {
    target.transact(() => {
      target.getMap('cards').set('note-9', cardToYMap({ ...yMapToCard(ym), id: 'note-9' }));
    }, 'cross-board-move');
  });
  assert.match(String(target.getMap('cards').get('note-9').get('noteFragment')), /moved text/);
  assert.equal(frag.doc, doc, 'source doc must be untouched by a cross-doc move');
});

test('a doc card carries its whole store across documents', () => {
  const { doc, ym } = boardWithCard('doc-1', { kind: 'doc' }, (m) => {
    m.set('docPages', new Y.Array());
    m.set('docPageContent', new Y.Map());
    m.set('docMeta', new Y.Map());
  });
  doc.transact(() => {
    ym.get('docPages').push([{ id: 'p1', name: 'Page one', parent_id: null, order: 0 }]);
    const frag = new Y.XmlFragment();
    ym.get('docPageContent').set('p1', frag);
    ym.get('docMeta').set('mode', 'screenplay');
  });
  doc.transact(() => {
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText(); t.insert(0, 'INT. HOUSE - DAY'); p.insert(0, [t]);
    ym.get('docPageContent').get('p1').insert(0, [p]);
  });

  const target = new Y.Doc();
  target.transact(() => {
    target.getMap('cards').set('doc-9', cardToYMap({ ...yMapToCard(ym), id: 'doc-9' }));
  }, 'cross-board-move');

  const copied = target.getMap('cards').get('doc-9');
  assert.deepEqual(copied.get('docPages').toArray(),
    [{ id: 'p1', name: 'Page one', parent_id: null, order: 0 }]);
  assert.equal(copied.get('docMeta').get('mode'), 'screenplay');
  assert.match(String(copied.get('docPageContent').get('p1')), /INT\. HOUSE - DAY/);
});

test('a grid card carries its cells', () => {
  const { doc, ym } = boardWithCard('grid-1', { kind: 'grid' }, (m) => {
    m.set('gridCells', new Y.Map());
    m.set('gridMeta', new Y.Map());
  });
  doc.transact(() => {
    ym.get('gridCells').set('c1', { text: 'top left', pinned: true });
    ym.get('gridCells').set('c2', { text: 'top right' });
    ym.get('gridMeta').set('templateId', 'tpl-a');
  });

  const target = new Y.Doc();
  target.transact(() => {
    target.getMap('cards').set('grid-9', cardToYMap({ ...yMapToCard(ym), id: 'grid-9' }));
  });
  const copied = target.getMap('cards').get('grid-9');
  assert.deepEqual(copied.get('gridCells').get('c1'), { text: 'top left', pinned: true });
  assert.deepEqual(copied.get('gridCells').get('c2'), { text: 'top right' });
  assert.equal(copied.get('gridMeta').get('templateId'), 'tpl-a');
});

// ── marks, nesting and attributes must survive ─────────────────────────

test('inline marks and element attributes survive the clone', () => {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment('f');
  doc.transact(() => {
    const p = new Y.XmlElement('paragraph');
    p.setAttribute('textAlign', 'center');
    const t = new Y.XmlText();
    t.insert(0, 'bold bit', { strong: {} });
    t.insert(8, ' plain');
    p.insert(0, [t]);
    frag.insert(0, [p]);
  });

  const clone = cloneYValue(frag);
  const host = new Y.Doc();
  host.transact(() => host.getMap('m').set('f', clone));
  const out = host.getMap('m').get('f');

  assert.equal(String(out), String(frag), 'serialized XML must match exactly');
  assert.equal(out.toArray()[0].getAttribute('textAlign'), 'center');
  const delta = out.toArray()[0].toArray()[0].toDelta();
  assert.ok(delta.some(op => op.attributes && op.attributes.strong), 'strong mark must survive');
});

test('deeply nested Y.Maps inside Y.Maps are cloned all the way down', () => {
  const doc = new Y.Doc();
  const outer = doc.getMap('outer');
  doc.transact(() => {
    const mid = new Y.Map();
    outer.set('mid', mid);
  });
  doc.transact(() => {
    const inner = new Y.Map();
    outer.get('mid').set('inner', inner);
  });
  doc.transact(() => outer.get('mid').get('inner').set('leaf', 'deep value'));

  const clone = cloneYValue(outer);
  const host = new Y.Doc();
  host.transact(() => host.getMap('m').set('copy', clone));
  assert.equal(host.getMap('m').get('copy').get('mid').get('inner').get('leaf'), 'deep value');
});

// ── the non-copy paths must be untouched ───────────────────────────────

test('a plain scalar card is passed through unchanged', () => {
  const doc = new Y.Doc();
  const card = { id: 'img-1', kind: 'image', x: 10, y: 20, src: 'r2:abc', adjust: { brightness: 1.1 } };
  doc.transact(() => doc.getMap('cards').set('img-1', cardToYMap(card)));
  assert.deepEqual(yMapToCard(doc.getMap('cards').get('img-1')), card);
});

test('a FRESH (prelim) Y type is inserted as-is, not cloned', () => {
  // The legitimate "I just made this for you" case — cloning a prelim type
  // would be wrong, since prelim types can't answer toArray/forEach yet.
  const doc = new Y.Doc();
  const fresh = new Y.Map();
  const ymap = cardToYMap({ id: 'c1', kind: 'note', extras: fresh });
  doc.transact(() => doc.getMap('cards').set('c1', ymap));
  assert.equal(doc.getMap('cards').get('c1').get('extras'), fresh,
    'a prelim type must be the SAME instance, not a copy');
});

test('readCards still sees a copied card', () => {
  const { doc, cards, ym } = boardWithCard('note-1', {}, (m) => m.set('noteFragment', new Y.XmlFragment()));
  doc.transact(() => cards.set('note-2', cardToYMap({ ...yMapToCard(ym), id: 'note-2' })));
  const ids = readCards(doc).map(c => c.id).sort();
  assert.deepEqual(ids, ['note-1', 'note-2']);
});

// ── the duplicate path (⌘D), same doc ──────────────────────────────────

test('duplicating a note in the SAME doc works and leaves the original intact', () => {
  const { doc, cards, ym } = boardWithCard('note-1', {}, (m) => m.set('noteFragment', new Y.XmlFragment()));
  const frag = ym.get('noteFragment');
  doc.transact(() => {
    const p = new Y.XmlElement('paragraph');
    const t = new Y.XmlText(); t.insert(0, 'duplicate me'); p.insert(0, [t]); frag.insert(0, [p]);
  });

  // Mirrors App.jsx's ⌘D: read the map into an object, restamp, re-insert.
  const obj = {};
  ym.forEach((v, k) => { obj[k] = v; });
  obj.id = 'note-copy'; obj.x = 24; obj.y = 24;
  assert.doesNotThrow(() => {
    doc.transact(() => cards.set(obj.id, cardToYMap(obj)), 'local');
  });
  assert.match(String(cards.get('note-copy').get('noteFragment')), /duplicate me/);
  assert.match(String(frag), /duplicate me/);
  assert.equal(frag.doc, doc);
});
