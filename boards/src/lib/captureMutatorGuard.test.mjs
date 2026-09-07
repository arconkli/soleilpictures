// captureMutatorGuard.test.mjs — the promise that a reframe writes nothing.
//
// The reframe substitutes fake geometry into the cards array. Dragging a card
// while it is on would commit a position derived from that fake layout into the
// real Y.Doc, which broadcasts and persists — the feature breaking its own
// central promise. This wrapper is the only thing preventing it, so the
// fail-closed behaviour is asserted directly rather than inferred.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guardCaptureMutators, GEOMETRY_KEYS } from './captureMutatorGuard.js';

// A stand-in mutators object that records what actually reached it.
function spyMutators() {
  const calls = [];
  const fn = (name) => (...args) => { calls.push({ name, args }); return `${name}-ran`; };
  return {
    calls,
    api: {
      updateCard: fn('updateCard'),
      updateCards: fn('updateCards'),
      updateCardSilent: fn('updateCardSilent'),
      // must be blocked
      addCard: fn('addCard'), addCards: fn('addCards'), addNote: fn('addNote'),
      duplicateCard: fn('duplicateCard'), ingestFilesArranged: fn('ingestFilesArranged'),
      createGroup: fn('createGroup'), addToGroup: fn('addToGroup'),
      addArrow: fn('addArrow'), addStroke: fn('addStroke'),
      resizeGridDivider: fn('resizeGridDivider'), moveSchedItem: fn('moveSchedItem'),
      undo: fn('undo'), redo: fn('redo'),
      _addCardRaw: fn('_addCardRaw'), _dropImageBlob: fn('_dropImageBlob'),
      // must stay live
      bringToFront: fn('bringToFront'), sendBackward: fn('sendBackward'),
      setBoardBgColor: fn('setBoardBgColor'), renameGroup: fn('renameGroup'),
      setGridCellContent: fn('setGridCellContent'),
      // non-functions
      undoManager: { id: 'um' }, canUndo: true, canRedo: false,
    },
  };
}

// ── Geometry is stripped, content survives ─────────────────────────────────

test('updateCard keeps content and drops every geometry key', () => {
  const s = spyMutators();
  const g = guardCaptureMutators(s.api);
  g.updateCard('c1', { x: 10, y: 20, w: 30, h: 40, rotation: 5, text: 'hello', color: 'red' });
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.calls[0].args, ['c1', { text: 'hello', color: 'red' }]);
});

test('every declared geometry key is actually stripped', () => {
  for (const key of GEOMETRY_KEYS) {
    const s = spyMutators();
    guardCaptureMutators(s.api).updateCard('c1', { [key]: 99, text: 'keep' });
    assert.deepEqual(s.calls[0].args[1], { text: 'keep' }, `${key} leaked through`);
  }
});

test('a geometry-only patch does not reach the document at all', () => {
  const s = spyMutators();
  const g = guardCaptureMutators(s.api);
  // This is a drag release. It must be a complete no-op, not an empty write:
  // an empty transaction still lands on the undo stack and still broadcasts.
  assert.equal(g.updateCard('c1', { x: 10, y: 20 }), undefined);
  assert.equal(s.calls.length, 0);
});

test('a content-only patch is passed through by identity', () => {
  const s = spyMutators();
  const patch = { text: 'unchanged' };
  guardCaptureMutators(s.api).updateCard('c1', patch);
  assert.equal(s.calls[0].args[1], patch, 'a clean patch should not be reallocated');
});

test('updateCards strips each patch and drops the entries left empty', () => {
  const s = spyMutators();
  const g = guardCaptureMutators(s.api);
  g.updateCards([
    { id: 'a', patch: { x: 1, y: 2 } },              // a move — dropped
    { id: 'b', patch: { x: 1, text: 'keep' } },      // mixed — kept, stripped
    { id: 'c', patch: { color: 'blue' } },           // content — kept whole
  ]);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.calls[0].args[0], [
    { id: 'b', patch: { text: 'keep' } },
    { id: 'c', patch: { color: 'blue' } },
  ]);
});

test('a whole-board tidy — every patch geometry — writes nothing', () => {
  const s = spyMutators();
  const g = guardCaptureMutators(s.api);
  const tidy = ['a', 'b', 'c'].map(id => ({ id, patch: { x: 0, y: 0, w: 10, h: 10 } }));
  assert.equal(g.updateCards(tidy), undefined);
  assert.equal(s.calls.length, 0);
});

test('updateCards survives junk without throwing', () => {
  const g = guardCaptureMutators(spyMutators().api);
  assert.equal(g.updateCards(null), undefined);
  assert.equal(g.updateCards([]), undefined);
  assert.equal(g.updateCards([null, { id: 'x' }]), undefined);
});

// ── Fails closed ───────────────────────────────────────────────────────────

const MUST_BE_BLOCKED = [
  'addCard', 'addCards', 'addNote', 'duplicateCard', 'ingestFilesArranged',
  'createGroup', 'addToGroup', 'addArrow', 'addStroke',
  'resizeGridDivider', 'moveSchedItem', '_addCardRaw', '_dropImageBlob',
];

test('everything that places or moves something is a no-op', () => {
  const s = spyMutators();
  const g = guardCaptureMutators(s.api);
  for (const name of MUST_BE_BLOCKED) {
    assert.equal(g[name]('anything', 'at', 'all'), undefined, `${name} returned a value`);
  }
  assert.deepEqual(s.calls, [], `these reached the document: ${s.calls.map(c => c.name).join(', ')}`);
});

test('undo and redo are blocked', () => {
  const s = spyMutators();
  const g = guardCaptureMutators(s.api);
  g.undo(); g.redo();
  // Undoing mid-shoot would rewind a real edit made BEFORE capture started —
  // the reframe writes nothing, so there is never anything of its own to undo.
  assert.deepEqual(s.calls, []);
});

test('an unknown mutator is blocked, not passed through', () => {
  const s = spyMutators();
  const api = { ...s.api, someFutureMutatorThatMovesThings: (...a) => { s.calls.push({ name: 'future', args: a }); return 1; } };
  const g = guardCaptureMutators(api);
  assert.equal(g.someFutureMutatorThatMovesThings(1, 2), undefined);
  assert.deepEqual(s.calls, [], 'the guard failed open — a new mutator could corrupt a real board');
});

// ── What stays live ────────────────────────────────────────────────────────

test('z-order, styling and naming still work', () => {
  const s = spyMutators();
  const g = guardCaptureMutators(s.api);
  assert.equal(g.bringToFront('c1'), 'bringToFront-ran');
  assert.equal(g.sendBackward('c1'), 'sendBackward-ran');
  assert.equal(g.setBoardBgColor('#000'), 'setBoardBgColor-ran');
  assert.equal(g.renameGroup('G', 'name'), 'renameGroup-ran');
  assert.equal(g.setGridCellContent('c', 'cell', {}), 'setGridCellContent-ran');
  assert.equal(s.calls.length, 5);
});

test('non-function values pass through by reference', () => {
  const s = spyMutators();
  const g = guardCaptureMutators(s.api);
  assert.equal(g.undoManager, s.api.undoManager);
  assert.equal(g.canUndo, true);
  assert.equal(g.canRedo, false);
});

test('the wrapper covers the whole surface — no key goes missing', () => {
  const s = spyMutators();
  const g = guardCaptureMutators(s.api);
  assert.deepEqual(Object.keys(g).sort(), Object.keys(s.api).sort(),
    'a missing key reads as undefined at the call site and throws');
});

test('junk input is returned unchanged rather than crashing the canvas', () => {
  assert.equal(guardCaptureMutators(null), null);
  assert.equal(guardCaptureMutators(undefined), undefined);
  assert.deepEqual(guardCaptureMutators({}), {});
});
