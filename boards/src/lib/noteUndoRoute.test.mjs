// The ⌘Z route for a note being edited (lib/noteUndoRoute.js), on real Yjs
// undo managers shaped like the app's: the board's tracks origin 'local' over
// the cards map, the note's tracks its own origin over the note's content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { createNoteUndoRoute } from './noteUndoRoute.js';

const TEXT = Symbol('text');
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const ydoc = new Y.Doc();
  const cards = ydoc.getMap('cards');
  const boardUm = new Y.UndoManager([cards], { trackedOrigins: new Set(['local']) });
  const card = new Y.Map();
  // Placing the note is a board step of its own.
  ydoc.transact(() => { cards.set('n1', card); card.set('text', new Y.Text()); }, 'local');
  const text = card.get('text');
  const textUm = new Y.UndoManager(text, { trackedOrigins: new Set([TEXT]) });
  const board = { undoManager: boardUm, undo: () => boardUm.undo(), redo: () => boardUm.redo() };
  const route = createNoteUndoRoute(textUm);
  const type = (s) => { ydoc.transact(() => text.insert(text.length, s), TEXT); textUm.stopCapturing(); };
  const style = (k, v) => route.styleWrite(board, () => ydoc.transact(() => card.set(k, v), 'local'));
  // ⌘Z / ⇧⌘Z as NoteTiptapSurface's key handler runs them: the route first,
  // then the editor's own undo.
  const undo = () => route.undo() || textUm.undo();
  const redo = () => route.redo() || textUm.redo();
  const state = () => [cards.has('n1'), text.toString(), card.get('bgColor') ?? null];
  return { ydoc, cards, card, text, boardUm, board, route, type, style, undo, redo, state };
}

test('a style after typing undoes first, then the typing; the note stays', async () => {
  const s = setup();
  s.type('hello');
  s.style('bgColor', '#dbeafe'); await tick();
  s.undo();
  assert.deepEqual(s.state(), [true, 'hello', null]);
  s.undo();
  assert.deepEqual(s.state(), [true, '', null]);
});

test('typing after a style undoes before it, and redo replays in order', async () => {
  const s = setup();
  s.type('a');
  s.style('bgColor', '#dbeafe'); await tick();
  s.type('b');
  s.undo(); assert.deepEqual(s.state(), [true, 'a', '#dbeafe']);
  s.undo(); assert.deepEqual(s.state(), [true, 'a', null]);
  s.undo(); assert.deepEqual(s.state(), [true, '', null]);
  s.redo(); assert.deepEqual(s.state(), [true, 'a', null]);
  s.redo(); assert.deepEqual(s.state(), [true, 'a', '#dbeafe']);
  s.redo(); assert.deepEqual(s.state(), [true, 'ab', '#dbeafe']);
});

test('a change inside the note and a card field under one outer transaction undo as one step', async () => {
  const s = setup();
  s.type('hi');
  // Center in the box: the alignment (the note's origin, nested) and vAlign.
  s.ydoc.transact(() => {
    s.ydoc.transact(() => s.text.format(0, 2, { align: 'center' }), TEXT);
    s.style('vAlign', 'center');
  }, 'local');
  await tick();
  s.undo();
  assert.equal(s.card.get('vAlign'), undefined);
  assert.deepEqual(s.text.toDelta(), [{ insert: 'hi' }]);
  s.redo();
  assert.equal(s.card.get('vAlign'), 'center');
  assert.deepEqual(s.text.toDelta(), [{ insert: 'hi', attributes: { align: 'center' } }]);
});

test('typing after an undone style drops its redo from the editor', async () => {
  const s = setup();
  s.type('a');
  s.style('bgColor', '#dbeafe'); await tick();
  s.undo();
  s.type('c');
  assert.equal(s.route.redo(), false);
});

test('a board step it did not write is left to the canvas', async () => {
  const s = setup();
  s.type('a');
  s.style('bgColor', '#dbeafe'); await tick();
  s.boardUm.stopCapturing();
  s.ydoc.transact(() => s.card.set('x', 10), 'local');
  assert.equal(s.route.undo(), false);
  assert.equal(s.card.get('bgColor'), '#dbeafe');
});

test('styles in a row within the capture window are one step', async () => {
  const s = setup();
  s.type('a');
  s.style('bgColor', '#dbeafe');
  s.style('bgColor', '#fee2e2');
  await tick();
  assert.equal(s.route.undo(), true);
  assert.deepEqual(s.state(), [true, 'a', null]);
  assert.equal(s.route.undo(), false);
});

test('a style, typing, then a style within the capture window undo as three steps', async () => {
  const s = setup();
  s.style('bgColor', '#dbeafe'); await tick();
  s.type('a');
  s.style('bgColor', '#fee2e2'); await tick();
  s.undo(); assert.deepEqual(s.state(), [true, 'a', '#dbeafe']);
  s.undo(); assert.deepEqual(s.state(), [true, '', '#dbeafe']);
  s.undo(); assert.deepEqual(s.state(), [true, '', null]);
});
