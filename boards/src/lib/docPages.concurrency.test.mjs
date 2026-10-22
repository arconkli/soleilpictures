// A doc's page list with several people in it at once. Every page is one plain
// entry in docPages, and an edit replaces the entry, so two edits to one page
// at the same moment used to leave two entries: the page showed up twice.
// A move rewrote every sibling, so two moves at once copied whole branches.
// Now readPages shows each page once, taking each field from the copy that
// wrote it last (its own stamp: nameV for the name, posV for where it sits), a
// move rewrites only the page that moved, and healPages clears copies that are
// left over. Tabs on a build from before (`old` below) keep working.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import * as ds from './docState.js';
import { docPagesText } from './docText.js';

const CARD = 'doc-1';

// A, B (with B1, B2 under it), C on n devices in sync, each with a fixed client
// id so that ties always break the same way.
function devices(n) {
  const seed = new Y.Doc();
  seed.clientID = 99;
  const card = new Y.Map();
  seed.transact(() => seed.getMap('cards').set(CARD, card));
  ds.initCardDocStore(seed, card);
  const scope = ds.cardScope(card);
  const A = ds.addPage(seed, { name: 'A', scope });
  const B = ds.addPage(seed, { name: 'B', scope });
  const C = ds.addPage(seed, { name: 'C', scope });
  const B1 = ds.addPage(seed, { name: 'B1', parent_id: B, scope });
  const B2 = ds.addPage(seed, { name: 'B2', parent_id: B, scope });
  const base = Y.encodeStateAsUpdate(seed);
  const docs = Array.from({ length: n }, (_, i) => {
    const d = new Y.Doc();
    d.clientID = i + 1;
    Y.applyUpdate(d, base);
    return d;
  });
  return { docs, ids: { A, B, C, B1, B2 } };
}
const scopeOf = (d) => ds.cardScope(d.getMap('cards').get(CARD));
const pages = (d) => ds.readPages(d, scopeOf(d));
const raw = (d) => scopeOf(d).pages.toArray();
const copiesOf = (d, id) => raw(d).filter((p) => p.id === id).length;
const byId = (d, id) => pages(d).filter((p) => p.id === id);
// The tree as the page list draws it: "A | B [B1, B2] | C".
const outline = (d) => ds.buildPageTree(pages(d)).map(function f(n) {
  return n.children.length ? `${n.name} [${n.children.map(f).join(', ')}]` : n.name;
}).join(' | ');

function sync(...docs) {
  for (const a of docs) {
    for (const b of docs) if (a !== b) Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  }
}
const rename = (d, id, name) => ds.renamePage(d, id, name, scopeOf(d));
const move = (d, id, parent, index) => ds.movePage(d, id, parent, index, scopeOf(d));
const heal = (d) => ds.healPages(d, scopeOf(d));

// The page helpers as tabs built before this change run them (docState.js at
// e66dfd2c): an edit deletes the entry and inserts a changed copy, and a move
// renumbers every sibling.
const old = {
  rename(ydoc, id, name) {
    const arr = scopeOf(ydoc).pages;
    ydoc.transact(() => {
      for (let i = 0; i < arr.length; i++) {
        const p = arr.get(i);
        if (p.id === id) { arr.delete(i, 1); arr.insert(i, [{ ...p, name }]); return; }
      }
    }, ds.DOC_ORIGIN);
  },
  move(ydoc, id, newParentId, newIndex) {
    const arr = scopeOf(ydoc).pages;
    ydoc.transact(() => {
      const all = arr.toArray();
      const moving = all.find(p => p.id === id);
      if (!moving) return;
      const siblings = all
        .filter(p => p.parent_id === newParentId && p.id !== id)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      siblings.splice(Math.max(0, Math.min(newIndex, siblings.length)), 0, { ...moving, parent_id: newParentId });
      const renumbered = new Map();
      siblings.forEach((p, i) => renumbered.set(p.id, { ...p, order: i }));
      const changedIds = new Set([...renumbered.keys()]);
      for (let i = arr.length - 1; i >= 0; i--) {
        if (changedIds.has(arr.get(i).id)) arr.delete(i, 1);
      }
      renumbered.forEach(p => arr.push([p]));
    }, ds.DOC_ORIGIN);
  },
};

test('two people renaming one page at once leave one page, with one name everywhere', () => {
  const { docs: [a, b], ids } = devices(2);
  rename(a, ids.A, 'Opening');
  rename(b, ids.A, 'Cold open');
  sync(a, b);
  for (const d of [a, b]) {
    assert.equal(pages(d).length, 5);
    assert.equal(byId(d, ids.A).length, 1, 'A once');
  }
  assert.equal(byId(a, ids.A)[0].name, byId(b, ids.A)[0].name, 'both devices agree');
  assert.ok(['Opening', 'Cold open'].includes(byId(a, ids.A)[0].name));
});

test('a rename racing a move keeps both: the new name, in the new place', () => {
  const { docs: [a, b], ids } = devices(2);
  rename(a, ids.B1, 'Beat one');
  move(b, ids.B1, null, 0);
  sync(a, b);
  for (const d of [a, b]) assert.equal(outline(d), 'Beat one | A | B [B2] | C');
});

test('two people moving pages at once never copy one', () => {
  const { docs: [a, b], ids } = devices(2);
  move(a, ids.A, null, 2);   // A to the end
  move(b, ids.C, null, 0);   // C to the top
  sync(a, b);
  assert.equal(outline(a), outline(b), 'both devices agree');
  for (const d of [a, b]) {
    assert.equal(pages(d).length, 5);
    assert.equal(raw(d).length, 5, 'nothing copied underneath either');
    assert.deepEqual(outline(d).replace(/ \[B1, B2\]/, '').split(' | ').sort(), ['A', 'B', 'C']);
  }
  // The same race the old way: each move rewrote the whole row.
  const { docs: [c, e], ids: j } = devices(2);
  old.move(c, j.A, null, 2);
  old.move(e, j.C, null, 0);
  sync(c, e);
  assert.ok(raw(c).length > 5, 'old moves leave copies behind…');
  assert.equal(pages(c).length, 5, '…which readPages shows once');
});

test('a move rewrites only the page that moved', () => {
  const { docs: [a], ids } = devices(1);
  const arr = scopeOf(a).pages;
  let deleted = 0; let added = 0;
  arr.observe((e) => { deleted += e.changes.deleted.size; added += e.changes.added.size; });
  move(a, ids.B2, ids.B, 0);
  assert.equal(outline(a), 'A | B [B2, B1] | C');
  assert.equal(deleted, 1, 'one entry out');
  assert.equal(added, 1, 'one entry in');
});

test('pages dropped between the same two pages, again and again, stay in order', () => {
  const { docs: [a], ids } = devices(1);
  const scope = scopeOf(a);
  const made = [];
  for (let i = 1; i <= 80; i++) {
    const id = ds.addPage(a, { name: 'P' + i, scope });
    move(a, id, null, 1);   // straight after A
    made.push('P' + i);
  }
  const expected = ['A', ...made.reverse(), 'B [B1, B2]', 'C'].join(' | ');
  assert.equal(outline(a), expected);
  const roots = pages(a).filter((p) => p.parent_id == null);
  assert.equal(new Set(roots.map((p) => p.order)).size, roots.length, 'no two pages share a place');
  assert.ok(roots.every((p) => Number.isFinite(p.order)));
});

test('an older tab renaming while a new one moves: one page, in the new place', () => {
  const { docs: [a, b], ids } = devices(2);
  old.rename(a, ids.B1, 'Old name');
  move(b, ids.B1, null, 0);
  sync(a, b);
  for (const d of [a, b]) {
    assert.equal(byId(d, ids.B1).length, 1);
    assert.match(outline(d), /^(Old name|B1) \| A \| B \[B2\] \| C$/);
  }
  assert.equal(outline(a), outline(b));
});

test('an older tab moving while a new one renames: one page, and the rename stays', () => {
  const { docs: [a, b], ids } = devices(2);
  old.move(a, ids.B2, ids.B, 0);
  rename(b, ids.B1, 'Renamed');
  sync(a, b);
  for (const d of [a, b]) {
    assert.equal(pages(d).length, 5);
    assert.equal(byId(d, ids.B1)[0].name, 'Renamed');
  }
  assert.equal(outline(a), outline(b));
});

test('one after the other, old and new tabs see each other\'s edits', () => {
  const { docs: [a, b], ids } = devices(2);
  rename(a, ids.A, 'New first');
  sync(a, b);
  old.rename(b, ids.A, 'Old second');
  old.move(b, ids.C, null, 0);
  sync(a, b);
  for (const d of [a, b]) {
    assert.equal(outline(d), 'C | Old second | B [B1, B2]');
    assert.equal(pages(d).length, 5);
  }
});

test('healing clears the copies an older tab left, and two devices healing at once agree', () => {
  const { docs: [a, b], ids } = devices(2);
  old.rename(a, ids.A, 'Opening');
  old.rename(b, ids.A, 'Cold open');
  sync(a, b);
  assert.equal(copiesOf(a, ids.A), 2);
  const shown = byId(a, ids.A)[0].name;
  const before = raw(a).length;
  assert.equal(heal(a), 1);
  assert.equal(heal(b), 1);
  sync(a, b);
  for (const d of [a, b]) {
    assert.equal(copiesOf(d, ids.A), 1, 'one copy left');
    assert.equal(byId(d, ids.A)[0].name, shown, 'the one the list already showed');
    assert.equal(raw(d).length, before - 1, 'healing only deletes');
  }
});

test('healing is not an edit: undo never brings the copies back', () => {
  const { docs: [a, b], ids } = devices(2);
  old.rename(a, ids.A, 'Opening');
  old.rename(b, ids.A, 'Cold open');
  sync(a, b);
  const um = ds.getDocUndoManager(a, scopeOf(a));
  const stack = um.undoStack.length;
  heal(a);
  assert.equal(um.undoStack.length, stack, 'nothing to undo');
  assert.equal(copiesOf(a, ids.A), 1);
});

test('when no copy holds the whole page, healing leaves them, and the next edit makes one', () => {
  const { docs: [a, b], ids } = devices(2);
  rename(a, ids.B1, 'Beat one');
  move(b, ids.B1, null, 0);
  sync(a, b);
  assert.equal(copiesOf(a, ids.B1), 2);
  assert.equal(heal(a), 0, 'deleting either copy would lose an edit');
  rename(a, ids.B1, 'Beat 1');
  sync(a, b);
  for (const d of [a, b]) {
    assert.equal(copiesOf(d, ids.B1), 1);
    assert.equal(outline(d), 'Beat 1 | A | B [B2] | C');
  }
});

test('deleting a page removes every copy of it and of the pages under it', () => {
  const { docs: [a, b], ids } = devices(2);
  old.rename(a, ids.B, 'Act two');
  old.rename(b, ids.B, 'Second act');
  sync(a, b);
  ds.deletePage(a, ids.B, scopeOf(a));
  sync(a, b);
  for (const d of [a, b]) {
    assert.equal(outline(d), 'A | C');
    for (const id of [ids.B, ids.B1, ids.B2]) assert.equal(copiesOf(d, id), 0);
  }
});

test('a page moved into one being deleted at the same moment stays in the list, at the top', () => {
  const { docs: [a, b], ids } = devices(2);
  ds.deletePage(a, ids.B, scopeOf(a));   // B, and B1 and B2 with it
  move(b, ids.C, ids.B, 0);              // C into B
  sync(a, b);
  for (const d of [a, b]) {
    assert.deepEqual(outline(d).split(' | ').sort(), ['A', 'C']);
    assert.equal(byId(d, ids.C)[0].parent_id, null);
  }
  assert.equal(outline(a), outline(b));
});

test('two pages put into each other at the same moment both stay in the list', () => {
  const { docs: [a, b], ids } = devices(2);
  move(a, ids.A, ids.C, 0);
  move(b, ids.C, ids.A, 0);
  sync(a, b);
  for (const d of [a, b]) {
    assert.equal(pages(d).length, 5);
    assert.deepEqual(outline(d).split(' | ').sort(), ['A', 'B [B1, B2]', 'C']);
  }
  assert.equal(outline(a), outline(b));
});

test('a page deleted while an older tab reorders inside it stays deleted', () => {
  const { docs: [a, b], ids } = devices(2);
  ds.deletePage(a, ids.B, scopeOf(a));
  old.move(b, ids.B2, ids.B, 0);   // rewrites B1 and B2, still under B
  sync(a, b);
  for (const d of [a, b]) {
    assert.equal(outline(d), 'A | C');
    assert.equal(pages(d).length, 2);
  }
});

test('search reads each page once', () => {
  const { docs: [a, b], ids } = devices(2);
  old.rename(a, ids.A, 'Opening');
  old.rename(b, ids.A, 'Cold open');
  sync(a, b);
  const card = a.getMap('cards').get(CARD);
  const listed = docPagesText(card).map((p) => p.id);
  assert.equal(listed.filter((id) => id === ids.A).length, 1);
  assert.equal(listed.length, 5);
});
