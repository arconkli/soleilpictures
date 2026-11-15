import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readSnap, writeSnap, forgetSnaps, SNAP_PREFIX, SNAP_MAX_AGE_MS, SNAP_MAX_CHARS,
} from './adminSnapshot.js';

function fakeStore() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}
function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t, tick: (ms) => { c.t += ms; } };
  return c;
}

test('round trip', () => {
  const store = fakeStore();
  const c = clock();
  assert.equal(writeSnap('u1', 'overview', { n: 1 }, { store, now: c.now }), true);
  assert.deepEqual(readSnap('u1', 'overview', { store, now: c.now }), { at: c.t, data: { n: 1 } });
  assert.ok(store.m.has(SNAP_PREFIX + 'u1:overview'));
});

test('accounts and keys are isolated', () => {
  const store = fakeStore();
  writeSnap('u1', 'a', 1, { store });
  assert.equal(readSnap('u2', 'a', { store }), null);
  assert.equal(readSnap('u1', 'b', { store }), null);
});

test('missing uid or key is refused', () => {
  const store = fakeStore();
  assert.equal(writeSnap('', 'a', 1, { store }), false);
  assert.equal(writeSnap('u', '', 1, { store }), false);
  assert.equal(readSnap('', 'a', { store }), null);
  assert.equal(writeSnap('u', 'a', undefined, { store }), false);
});

test('expires after 7 days and removes the entry', () => {
  const store = fakeStore();
  const c = clock();
  writeSnap('u', 'a', 1, { store, now: c.now });
  c.tick(SNAP_MAX_AGE_MS);
  assert.notEqual(readSnap('u', 'a', { store, now: c.now }), null);
  c.tick(1);
  assert.equal(readSnap('u', 'a', { store, now: c.now }), null);
  assert.equal(store.m.size, 0);
});

test('corrupt JSON and wrong version give null', () => {
  const store = fakeStore();
  store.setItem(SNAP_PREFIX + 'u:a', '{nope');
  assert.equal(readSnap('u', 'a', { store }), null);
  store.setItem(SNAP_PREFIX + 'u:a', JSON.stringify({ v: 2, at: Date.now(), data: 1 }));
  assert.equal(readSnap('u', 'a', { store }), null);
  store.setItem(SNAP_PREFIX + 'u:a', JSON.stringify({ v: 1, at: 'x', data: 1 }));
  assert.equal(readSnap('u', 'a', { store }), null);
});

test('over the size cap refuses and clears the old entry', () => {
  const store = fakeStore();
  assert.equal(writeSnap('u', 'a', { n: 1 }, { store }), true);
  assert.equal(writeSnap('u', 'a', 'x'.repeat(SNAP_MAX_CHARS), { store }), false);
  assert.equal(readSnap('u', 'a', { store }), null);
  assert.equal(store.m.size, 0);
});

test('a throwing setItem returns false and removes the key', () => {
  const store = fakeStore();
  writeSnap('u', 'a', 1, { store });
  store.setItem = () => { throw new Error('quota'); };
  assert.equal(writeSnap('u', 'a', 2, { store }), false);
  assert.equal(store.m.size, 0);
});

test('a null or undefined store is safe', () => {
  for (const store of [null, undefined]) {
    // undefined falls to the default store, which is absent or harmless in node
    assert.doesNotThrow(() => { readSnap('u', 'a', { store }); writeSnap('u', 'a', 1, { store }); forgetSnaps({ store }); });
  }
  assert.equal(readSnap('u', 'a', { store: null }), null);
  assert.equal(writeSnap('u', 'a', 1, { store: null }), false);
});

test('forgetSnaps clears only adminSnap: keys', () => {
  const store = fakeStore();
  writeSnap('u1', 'a', 1, { store });
  writeSnap('u2', 'b', 2, { store });
  store.setItem('other', 'keep');
  store.setItem('adminSnapshotLike', 'keep');
  forgetSnaps({ store });
  assert.deepEqual([...store.m.keys()].sort(), ['adminSnapshotLike', 'other']);
});
