// boardViewState.test.mjs — per-board zoom/pan persistence, and the suspension
// Capture Mode needs.
//
// The failure this guards: a capture framing move is a decision about one shot,
// but CanvasSurface's 400ms debounce treats every zoom/pan as a viewing
// position worth resuming. Without suspension, a capture pose is written to
// localStorage and silently restored the NEXT time that board is opened —
// possibly weeks later, with nothing left to connect it to the shoot. It is a
// bug that cannot be noticed at the time it is caused, so it gets a test.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  loadBoardView, saveBoardView, clearBoardView,
  shouldPersistView, suspendViewPersistence, isViewPersistenceSuspended,
} = await import('./boardViewState.js');

const VIEW = { zoom: 1.5, pan: { x: 10, y: 20 } };
const fresh = () => { store.clear(); suspendViewPersistence(false); };

// ── The pure predicate ─────────────────────────────────────────────────────

test('shouldPersistView requires a board, a numeric zoom, and no suspension', () => {
  assert.equal(shouldPersistView('b1', VIEW, false), true);
  assert.equal(shouldPersistView('b1', VIEW, true), false, 'suspension wins over everything');
  assert.equal(shouldPersistView('', VIEW, false), false);
  assert.equal(shouldPersistView('b1', null, false), false);
  assert.equal(shouldPersistView('b1', { zoom: '1.5' }, false), false, 'a string zoom is not a zoom');
});

// ── Round trip ─────────────────────────────────────────────────────────────

test('a normal view round-trips', () => {
  fresh();
  saveBoardView('b1', VIEW);
  assert.deepEqual(loadBoardView('b1'), { zoom: 1.5, pan: { x: 10, y: 20 } });
});

test('clearBoardView removes it', () => {
  fresh();
  saveBoardView('b1', VIEW);
  clearBoardView('b1');
  assert.equal(loadBoardView('b1'), null);
});

test('a malformed payload reads as null rather than throwing', () => {
  fresh();
  store.set('soleil.boards.view.b1', '{not json');
  assert.equal(loadBoardView('b1'), null);
  store.set('soleil.boards.view.b2', JSON.stringify({ zoom: 1 }));  // no pan
  assert.equal(loadBoardView('b2'), null);
});

// ── Suspension ─────────────────────────────────────────────────────────────

test('while suspended, saveBoardView writes nothing', () => {
  fresh();
  suspendViewPersistence(true);
  assert.equal(isViewPersistenceSuspended(), true);
  saveBoardView('b1', VIEW);
  assert.equal(loadBoardView('b1'), null, 'a capture pose must never become a resume position');
});

test('suspension does not destroy a view saved before it', () => {
  fresh();
  saveBoardView('b1', VIEW);
  suspendViewPersistence(true);
  saveBoardView('b1', { zoom: 4, pan: { x: 999, y: 999 } });
  assert.deepEqual(loadBoardView('b1'), { zoom: 1.5, pan: { x: 10, y: 20 } },
    'the real viewing position survives the shoot untouched');
});

test('resuming restores normal persistence', () => {
  fresh();
  suspendViewPersistence(true);
  saveBoardView('b1', VIEW);
  suspendViewPersistence(false);
  assert.equal(isViewPersistenceSuspended(), false);
  saveBoardView('b1', VIEW);
  assert.deepEqual(loadBoardView('b1'), { zoom: 1.5, pan: { x: 10, y: 20 } });
});
