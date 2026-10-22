// The app reads its own id from the session, never with auth.getUser(), which
// holds supabase-js's auth lock for a round trip while every query waits; and
// the profile read Workspace's mount makes twice is one request.
// Run: node --test src/lib/sessionUserId.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import { shareThisTurn } from './shareThisTurn.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8');

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'local') sources(p, out); continue; }
    if (/\.(jsx?|mjs)$/.test(name) && !/\.test\.mjs$/.test(name)) out.push(p);
  }
  return out;
}

test('nothing in the app calls auth.getUser()', () => {
  const callers = sources(SRC)
    .filter((p) => /auth\??\.getUser\(/.test(readFileSync(p, 'utf8').replace(/^\s*\/\/.*$/gm, '')))
    .map((p) => relative(SRC, p));
  assert.deepEqual(callers, [], 'use sessionUserId() from lib/supabase.js: getUser() makes every query wait for its round trip');
});

test('the boot callers pass the id they already have', () => {
  assert.ok(read('App.jsx').includes('getOwnProfile({ userId: user.id })'));
  const d = read('hooks/useResolvedDefaults.js');
  assert.ok(d.includes('getOwnProfile({ userId })'));
  assert.ok(d.includes('getMyWorkspaceRole(workspaceId, userId)'));
  assert.ok(read('lib/boardsApi.js').includes('shareThisTurn(ownProfileReads, userId, () => readOwnProfile(userId))'));
  assert.deepEqual([...read('lib/shareThisTurn.js').matchAll(/^import /gm)], []);
});

test('calls in the same turn share one request', () => {
  const m = new Map();
  let n = 0;
  const start = () => Promise.resolve(++n);
  const a = shareThisTurn(m, 'u1', start);
  assert.equal(shareThisTurn(m, 'u1', start), a);
  assert.equal(n, 1);
  assert.notEqual(shareThisTurn(m, 'u2', start), a, 'another account asks for itself');
  assert.equal(n, 2);
});

test('a call after the turn starts its own, even while the first is in flight', async () => {
  const m = new Map();
  const pending = new Promise(() => {});
  assert.equal(shareThisTurn(m, 'u1', () => pending), pending);
  await Promise.resolve();
  const fresh = Promise.resolve('after the save');
  assert.equal(shareThisTurn(m, 'u1', () => fresh), fresh);
  await Promise.resolve();
  assert.equal(m.size, 0, 'nothing is held past its turn');
});
