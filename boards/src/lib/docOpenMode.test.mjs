// docOpenMode — the remembered doc-card layout.
//
// The one thing that must not regress: a junk or absent value falls back to
// 'full' rather than to 'closed'. 'closed' is a legal DocCard mode, so a
// permissive reader would happily return it and every subsequent double-click
// would open a doc that renders nothing.

import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage stand-in — the module reads it lazily inside each call,
// so installing it before the import is not required, but is tidier.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const { readDocOpenMode, writeDocOpenMode, isDocOpenMode, DEFAULT_DOC_OPEN_MODE } =
  await import('./docOpenMode.js');

test('defaults to fullscreen when nothing is stored', () => {
  store.clear();
  assert.equal(readDocOpenMode(), 'full');
  assert.equal(DEFAULT_DOC_OPEN_MODE, 'full');
});

test('round-trips both real modes', () => {
  writeDocOpenMode('side');
  assert.equal(readDocOpenMode(), 'side');
  writeDocOpenMode('full');
  assert.equal(readDocOpenMode(), 'full');
});

test("'closed' is not an open mode and is never persisted", () => {
  store.clear();
  writeDocOpenMode('side');
  writeDocOpenMode('closed');
  assert.equal(isDocOpenMode('closed'), false);
  assert.equal(readDocOpenMode(), 'side', 'the last real mode survives');
});

test('junk in storage falls back to fullscreen', () => {
  store.set('soleil.boards.docCardMode', 'sideways');
  assert.equal(readDocOpenMode(), 'full');
  store.set('soleil.boards.docCardMode', '');
  assert.equal(readDocOpenMode(), 'full');
});

test('a throwing localStorage (private mode, quota) still yields a usable mode', () => {
  const real = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };
  assert.equal(readDocOpenMode(), 'full');
  assert.doesNotThrow(() => writeDocOpenMode('side'));
  globalThis.localStorage = real;
});
