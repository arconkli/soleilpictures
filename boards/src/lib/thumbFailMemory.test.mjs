import test from 'node:test';
import assert from 'node:assert/strict';
import { isRemembered, remember, TTL_MS, MAX_ENTRIES } from './thumbFailMemory.js';

const memStore = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
};

test('a remembered key is found, another is not', () => {
  const store = memStore();
  remember('ws/a.jpg', { store, now: () => 1000 });
  assert.equal(isRemembered('ws/a.jpg', { store, now: () => 1000 }), true);
  assert.equal(isRemembered('ws/b.jpg', { store, now: () => 1000 }), false);
});

test('an entry older than 7 days is dropped when read', () => {
  const store = memStore();
  remember('ws/a.jpg', { store, now: () => 1000 });
  assert.equal(isRemembered('ws/a.jpg', { store, now: () => 1000 + TTL_MS - 1 }), true);
  assert.equal(isRemembered('ws/a.jpg', { store, now: () => 1000 + TTL_MS }), false);
  // and the next write sheds it from storage
  remember('ws/b.jpg', { store, now: () => 1000 + TTL_MS });
  assert.deepEqual(Object.keys(JSON.parse(store.m.get('soleil.thumbFail'))), ['ws/b.jpg']);
});

test('at most 300 entries, the oldest dropped first', () => {
  const store = memStore();
  for (let i = 0; i < MAX_ENTRIES + 5; i++) remember(`k${i}`, { store, now: () => 1000 + i });
  const kept = JSON.parse(store.m.get('soleil.thumbFail'));
  assert.equal(Object.keys(kept).length, MAX_ENTRIES);
  assert.equal('k0' in kept, false);
  assert.equal('k4' in kept, false);
  assert.equal('k5' in kept, true);
  assert.equal(`k${MAX_ENTRIES + 4}` in kept, true);
});

test('broken storage never throws and remembers nothing', () => {
  const boom = () => { throw new Error('blocked'); };
  const store = { getItem: boom, setItem: boom };
  assert.doesNotThrow(() => remember('k', { store }));
  assert.equal(isRemembered('k', { store }), false);
});

test('garbage in the entry is ignored', () => {
  for (const raw of ['not json', '[1,2]', '"x"', '{"k":"soon"}']) {
    const store = memStore();
    store.m.set('soleil.thumbFail', raw);
    assert.equal(isRemembered('k', { store, now: () => 5 }), false);
    remember('k', { store, now: () => 5 });
    assert.equal(isRemembered('k', { store, now: () => 5 }), true);
  }
});

test('no storage at all', () => {
  assert.equal(isRemembered('k', { store: null }), false);
  assert.doesNotThrow(() => remember('k', { store: null }));
});
