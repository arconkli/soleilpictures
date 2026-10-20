// node --test — pure param/stash logic for the ?wsjoin= workspace-link hop.
// localStorage is stubbed; the module never throws when storage is absent.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  WSJOIN_PARAM, parseWsJoinParam, stashWsJoin, readWsJoin, clearWsJoin, workspaceInviteUrl,
} = await import('./workspaceLink.js');

const TOKEN = '123e4567-e89b-42d3-a456-426614174000';

test('the param is wsjoin', () => {
  assert.equal(WSJOIN_PARAM, 'wsjoin');
});

test('parseWsJoinParam accepts a uuid token', () => {
  assert.equal(parseWsJoinParam(TOKEN), TOKEN);
  assert.equal(parseWsJoinParam(TOKEN.toUpperCase()), TOKEN.toUpperCase());
  assert.equal(parseWsJoinParam(`  ${TOKEN}  `), TOKEN);
});

test('parseWsJoinParam rejects junk', () => {
  assert.equal(parseWsJoinParam(''), null);
  assert.equal(parseWsJoinParam(null), null);
  assert.equal(parseWsJoinParam(undefined), null);
  assert.equal(parseWsJoinParam('not-a-uuid'), null);
  assert.equal(parseWsJoinParam(`${TOKEN}<script>`), null);
});

test('stash, read, clear roundtrip', () => {
  stashWsJoin(TOKEN);
  assert.equal(readWsJoin(), TOKEN);
  clearWsJoin();
  assert.equal(readWsJoin(), null);
});

test('stashWsJoin ignores invalid tokens', () => {
  clearWsJoin();
  stashWsJoin('nope');
  stashWsJoin(null);
  assert.equal(readWsJoin(), null);
});

test('readWsJoin rejects tampered storage', () => {
  localStorage.setItem('soleil.boards.pending.wsjoin.token', 'garbage');
  assert.equal(readWsJoin(), null);
});

test('workspaceInviteUrl builds the link from an origin', () => {
  assert.equal(
    workspaceInviteUrl(TOKEN, 'https://clusters.soleilpictures.com'),
    `https://clusters.soleilpictures.com/?wsjoin=${TOKEN}`,
  );
});

test('workspaceInviteUrl is null for a bad token', () => {
  assert.equal(workspaceInviteUrl('nope', 'https://example.com'), null);
  assert.equal(workspaceInviteUrl(null, 'https://example.com'), null);
});
