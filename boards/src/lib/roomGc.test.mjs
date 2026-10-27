import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { roomGcFilter } from './roomGc.js';

// The room's document, as party/board.ts builds it.
const roomDoc = () => new Y.Doc({ gcFilter: roomGcFilter });

// A board as anyone reads it (a document lists only the types it has asked for).
const board = (doc) => ({ cards: doc.getMap('cards').toJSON(), strokes: doc.getArray('strokes').toJSON() });

// What the R2 orphan sweep sees in a stored board (_r2_keys_in_doc, 0310's
// regexp over encode(decode(doc, 'base64'), 'escape')).
const sweepKeys = (doc) => {
  const text = Buffer.from(Y.encodeStateAsUpdate(doc)).toString('latin1');
  return new Set([...text.matchAll(/r2:([A-Za-z0-9_\-./]{20,})/g)].map((m) => m[1]));
};

const KEY_A = 'workspaces/aaaaaaaa-1111/images/0123456789abcdef.jpg';
const KEY_B = 'workspaces/aaaaaaaa-1111/images/fedcba9876543210.jpg';

// A note's text as the write-through puts it on its card: about 2 KB.
const noteHtml = (i) => `<p>${'line of a long note '.repeat(100)}${i}</p>`;

function addNote(doc, id = 'n1') {
  const card = new Y.Map();
  doc.transact(() => {
    doc.getMap('cards').set(id, card);
    card.set('kind', 'note');
    card.set('html', noteHtml(0));
  });
  return card;
}

function typeInto(doc, card, times) {
  for (let i = 1; i <= times; i++) doc.transact(() => card.set('html', noteHtml(i)));
}

test('a note rewritten on every keystroke keeps one copy of its text, not one per keystroke', () => {
  const kept = new Y.Doc({ gc: false });
  const room = roomDoc();
  typeInto(kept, addNote(kept), 300);
  typeInto(room, addNote(room), 300);
  const one = noteHtml(300).length;
  // gc off: every keystroke's copy stays (what took the database down).
  assert.ok(Y.encodeStateAsUpdate(kept).length > 250 * one);
  // The room: about one copy.
  assert.ok(Y.encodeStateAsUpdate(room).length < 2 * one, `${Y.encodeStateAsUpdate(room).length}`);
  assert.equal(room.getMap('cards').get('n1').get('html'), noteHtml(300));
});

test('a board stored with every copy shrinks when a room loads it, and holds the same board', () => {
  const bloated = new Y.Doc({ gc: false });
  const card = addNote(bloated);
  typeInto(bloated, card, 300);
  bloated.transact(() => bloated.getArray('strokes').push([{ points: [1, 2, 3, 4] }]));
  const stored = Y.encodeStateAsUpdate(bloated);

  const room = roomDoc();
  Y.applyUpdate(room, stored);
  const compact = Y.encodeStateAsUpdate(room);
  assert.ok(compact.length * 50 < stored.length, `${stored.length} → ${compact.length}`);
  assert.deepEqual(board(room), board(bloated));

  // And what it writes back reads as the same board anywhere.
  const reader = new Y.Doc();
  Y.applyUpdate(reader, compact);
  assert.deepEqual(board(reader), board(bloated));
});

test('a deleted card keeps every field, its file keys included, as with gc off', () => {
  const room = roomDoc();
  const card = new Y.Map();
  room.transact(() => {
    room.getMap('cards').set('img', card);
    card.set('kind', 'image');
    card.set('src', `r2:${KEY_A}`);
    card.set('caption', 'x'.repeat(500));
  });
  room.transact(() => room.getMap('cards').delete('img'));
  assert.ok(sweepKeys(room).has(KEY_A));
  // The caption stayed with its card: nothing under a deleted type is collected.
  assert.ok(Buffer.from(Y.encodeStateAsUpdate(room)).toString('latin1').includes('x'.repeat(500)));
});

test('a value replaced on a live card keeps its file key when it names one', () => {
  const room = roomDoc();
  const card = new Y.Map();
  room.transact(() => {
    room.getMap('cards').set('img', card);
    card.set('src', `r2:${KEY_A}`);
  });
  room.transact(() => card.set('src', `r2:${KEY_B}`));
  const keys = sweepKeys(room);
  assert.ok(keys.has(KEY_A), 'the replaced key');
  assert.ok(keys.has(KEY_B), 'the current key');
});

test('a file key typed into text is kept when the text is deleted', () => {
  const room = roomDoc();
  const text = room.getText('t');
  room.transact(() => text.insert(0, `see r2:${KEY_A} here`));
  room.transact(() => text.delete(0, text.length));
  assert.ok(sweepKeys(room).has(KEY_A));
});

test('a type is never collected: a deleted paragraph keeps its text', () => {
  const room = roomDoc();
  const frag = new Y.XmlFragment();
  room.transact(() => room.getMap('cards').set('n', new Y.Map()));
  const card = room.getMap('cards').get('n');
  room.transact(() => card.set('noteFragment', frag));
  const para = new Y.XmlElement('paragraph');
  room.transact(() => {
    frag.insert(0, [para]);
    para.insert(0, [new Y.XmlText('kept with its paragraph '.repeat(20))]);
  });
  room.transact(() => frag.delete(0, 1));
  assert.ok(Buffer.from(Y.encodeStateAsUpdate(room)).toString('latin1').includes('kept with its paragraph'));
});

test('a room and the browsers in it converge, edits flowing both ways', () => {
  const room = roomDoc();
  const a = new Y.Doc();
  const b = new Y.Doc();
  const wire = (from, tos) => from.on('update', (u, origin) => {
    for (const to of tos) if (origin !== to) Y.applyUpdate(to, u, from);
  });
  wire(a, [room]);
  wire(b, [room]);
  wire(room, [a, b]);

  const card = addNote(a);
  typeInto(a, card, 40);
  b.transact(() => b.getMap('cards').get('n1').set('h', 120));
  typeInto(b, b.getMap('cards').get('n1'), 5);
  a.transact(() => a.getMap('cards').set('n2', new Y.Map()));
  b.transact(() => b.getMap('cards').delete('n2'));

  assert.deepEqual(board(a), board(room));
  assert.deepEqual(board(b), board(room));
  assert.equal(board(room).cards.n1.html, noteHtml(5));
  assert.equal(board(room).cards.n2, undefined);
  // A browser that joins late gets the same board from the room's state.
  const late = new Y.Doc();
  Y.applyUpdate(late, Y.encodeStateAsUpdate(room));
  assert.deepEqual(board(late), board(room));
});

test('the board room builds its documents with this filter', () => {
  const src = readFileSync(new URL('../../party/board.ts', import.meta.url), 'utf8');
  assert.match(src, /import \{ roomGcFilter \} from "\.\.\/src\/lib\/roomGc\.js";/);
  assert.match(src, /this\.document\.gcFilter = roomGcFilter;/);
  assert.match(src, /new Y\.Doc\(\{ gcFilter: roomGcFilter \}\)/);
  assert.doesNotMatch(src, /gc: false|\.gc = false/);
});
