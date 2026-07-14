// node --test — pure param/stash logic for the ?join= invite-link hop.
// localStorage is stubbed; the module never throws when storage is absent.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { parseJoinParam, stashJoin, readJoin, clearJoin } = await import('./joinLink.js');

const TOKEN = '123e4567-e89b-42d3-a456-426614174000';

test('parseJoinParam accepts a uuid token', () => {
  assert.equal(parseJoinParam(TOKEN), TOKEN);
  assert.equal(parseJoinParam(`  ${TOKEN}  `), TOKEN);
});

test('parseJoinParam rejects junk', () => {
  assert.equal(parseJoinParam(''), null);
  assert.equal(parseJoinParam(null), null);
  assert.equal(parseJoinParam('not-a-uuid'), null);
  assert.equal(parseJoinParam('123e4567e89b42d3a456426614174000'), null); // no dashes
  assert.equal(parseJoinParam(`${TOKEN}<script>`), null);
});

test('stash → read → clear roundtrip', () => {
  stashJoin(TOKEN);
  assert.equal(readJoin(), TOKEN);
  clearJoin();
  assert.equal(readJoin(), null);
});

test('stashJoin ignores invalid tokens', () => {
  clearJoin();
  stashJoin('nope');
  assert.equal(readJoin(), null);
});

test('readJoin rejects tampered storage', () => {
  localStorage.setItem('soleil.boards.pending.join.token', 'garbage');
  assert.equal(readJoin(), null);
});
