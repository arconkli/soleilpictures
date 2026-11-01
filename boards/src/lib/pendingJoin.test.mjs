// pendingJoin.test.mjs — a stashed join knows its kind. Claiming it once is
// pendingJoinRules.test.mjs.
//
//   node --test src/lib/pendingJoin.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
globalThis.localStorage = mem();

const {
  stashPendingJoin, readPendingJoin, clearPendingJoin, PENDING_JOIN_MAX_AGE_MS, normalizeJoinKind,
} = await import('./pendingJoin.js');

const T = '0f9a5c3e-1b2d-4e5f-8a9b-0c1d2e3f4a5b';
const U = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

test('the stash keeps the kind and the words next to the token', () => {
  globalThis.localStorage = mem();
  assert.equal(readPendingJoin(), null);
  stashPendingJoin({ token: T, kind: 'view', name: 'Lost Time', sharer: 'Andrew', cards: 24 });
  assert.deepEqual(readPendingJoin(), { token: T, kind: 'view', name: 'Lost Time', sharer: 'Andrew', cards: 24 });
  clearPendingJoin();
  assert.equal(readPendingJoin(), null);
});

test('a second stash of the same token adds to it; another token starts over', () => {
  globalThis.localStorage = mem();
  stashPendingJoin({ token: T, kind: 'view', name: 'Lost Time', sharer: 'Andrew' });
  stashPendingJoin({ token: T });
  assert.equal(readPendingJoin().kind, 'view');
  assert.equal(readPendingJoin().sharer, 'Andrew');
  stashPendingJoin({ token: U });
  assert.deepEqual(readPendingJoin(), { token: U, kind: null, name: null, sharer: null, cards: null });
});

test('a token with no kind is legacy: kind is null, not a guess', () => {
  globalThis.localStorage = mem();
  stashPendingJoin({ token: T, kind: 'whatever' });
  assert.equal(readPendingJoin().kind, null);
  assert.equal(normalizeJoinKind('invite'), 'invite');
  assert.equal(normalizeJoinKind('viewer'), null);
});

test('a bad token is never stashed, and broken storage never throws', () => {
  globalThis.localStorage = mem();
  stashPendingJoin({ token: 'nope', kind: 'view' });
  assert.equal(readPendingJoin(), null);
  globalThis.localStorage = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
  assert.doesNotThrow(() => { stashPendingJoin({ token: T, kind: 'view' }); readPendingJoin(); clearPendingJoin(); });
});

test('a stash older than 24 hours is ignored and cleared; one without a timestamp is honoured', () => {
  globalThis.localStorage = mem();
  const INFO = 'soleil.boards.pending.join.info';
  const TOKEN = 'soleil.boards.pending.join.token';
  stashPendingJoin({ token: T, kind: 'view', name: 'Lost Time' });
  const rec = JSON.parse(localStorage.getItem(INFO));
  assert.equal(typeof rec.savedAt, 'number');
  // just inside the window
  localStorage.setItem(INFO, JSON.stringify({ ...rec, savedAt: Date.now() - PENDING_JOIN_MAX_AGE_MS + 60_000 }));
  assert.equal(readPendingJoin()?.token, T);
  // just outside it
  localStorage.setItem(INFO, JSON.stringify({ ...rec, savedAt: Date.now() - PENDING_JOIN_MAX_AGE_MS - 60_000 }));
  assert.equal(readPendingJoin(), null);
  assert.equal(localStorage.getItem(TOKEN), null, 'the token is cleared too');
  assert.equal(localStorage.getItem(INFO), null);
  // stashed before timestamps existed: honoured
  const { savedAt, ...legacy } = rec;
  localStorage.setItem(TOKEN, T);
  localStorage.setItem(INFO, JSON.stringify(legacy));
  assert.equal(readPendingJoin()?.token, T);
  // the read shape never carries the timestamp
  assert.deepEqual(Object.keys(readPendingJoin()).sort(), ['cards', 'kind', 'name', 'sharer', 'token']);
});
