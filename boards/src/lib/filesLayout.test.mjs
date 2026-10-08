// Files view layout default (lib/filesLayout.js): Grid unless the cluster is
// mostly audio, where the List layout's loop columns are the point.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultFilesLayout, readFilesLayout, writeFilesLayout } from './filesLayout.js';

test('a cluster nobody chose for opens in Grid', () => {
  assert.equal(defaultFilesLayout([]), 'gallery');
  assert.equal(defaultFilesLayout(null), 'gallery');
  assert.equal(defaultFilesLayout([{ kind: 'image' }, { kind: 'note' }, { kind: 'audio' }]), 'gallery');
});

test('a mostly-audio cluster opens in List, for the loop columns', () => {
  assert.equal(defaultFilesLayout([{ kind: 'audio' }, { kind: 'audio' }, { kind: 'image' }]), 'table');
  assert.equal(defaultFilesLayout([{ kind: 'audio' }, { kind: 'image' }]), 'table');
});

test('storage that is missing or throws reads as no choice, and writes stay silent', () => {
  // node has no localStorage: the accessor throws, which must read as null.
  assert.equal(readFilesLayout('b1'), null);
  assert.doesNotThrow(() => writeFilesLayout('b1', 'table'));
  assert.equal(readFilesLayout(null), null);
});

test('a remembered choice is per cluster and only ever grid or list', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  try {
    writeFilesLayout('b1', 'table');
    writeFilesLayout('b2', 'gallery');
    writeFilesLayout('b3', 'kanban');
    assert.equal(readFilesLayout('b1'), 'table');
    assert.equal(readFilesLayout('b2'), 'gallery');
    assert.equal(readFilesLayout('b3'), null);
    store.set('soleil.files.layout.b4', 'nonsense');
    assert.equal(readFilesLayout('b4'), null);
  } finally {
    delete globalThis.localStorage;
  }
});
