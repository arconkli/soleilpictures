// bootStore: reads started at sign-in, taken once by the app.
// Run: node --test src/lib/bootStore.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { putBoot, takeBoot, hasBoot, peekBootSettled, clearBoot, BOOT_TTL_MS } from './bootStore.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => clearBoot());

test('the first caller takes the read; every later one asks for itself', async () => {
  const p = Promise.resolve({ data: 1, error: null });
  putBoot('tier', 'u1', p, 1000);
  const t = takeBoot('tier', 'u1', 1500);
  assert.equal(t.promise, p);
  assert.equal(t.startedAt, 1000);
  assert.equal(takeBoot('tier', 'u1', 1600), null);
});

test('a shared read goes to every caller, and still never to another account', () => {
  const p = Promise.resolve({ data: [{ id: 'root' }], error: null });
  putBoot('root:w', 'u1', p, 0);
  assert.equal(takeBoot('root:w', 'u1', 10, { share: true }).promise, p);
  assert.equal(takeBoot('root:w', 'u1', 20, { share: true }).promise, p);
  assert.equal(takeBoot('root:w', 'u2', 30, { share: true }), null);
  assert.equal(takeBoot('root:w', 'u1', BOOT_TTL_MS + 1, { share: true }), null);
});

test('never to another account, never past its time', () => {
  putBoot('tier', 'u1', Promise.resolve({}), 0);
  assert.equal(takeBoot('tier', 'u2', 10), null);
  assert.equal(hasBoot('tier', 'u2', 10), false);
  assert.equal(takeBoot('tier', 'u1', BOOT_TTL_MS + 1), null);
  assert.equal(hasBoot('tier', 'u1', 0), false, 'the stale entry is gone');
});

test('a decision can read the settled answer without taking it, before or after the take', async () => {
  putBoot('members', 'u1', Promise.resolve({ data: [{ workspace_id: 'w' }], error: null }));
  assert.equal(peekBootSettled('members', 'u1'), null, 'still in flight');
  await tick();
  assert.deepEqual(peekBootSettled('members', 'u1'), { value: { data: [{ workspace_id: 'w' }], error: null } });
  assert.ok(takeBoot('members', 'u1'));
  assert.ok(peekBootSettled('members', 'u1'), 'taking does not hide the answer from a decision');
  assert.equal(hasBoot('members', 'u1'), true, 'and it still counts as started');
});

test('a read that throws settles as an error', async () => {
  const p = Promise.reject(new Error('offline'));
  p.catch(() => {});
  putBoot('shared', 'u1', p);
  await tick();
  assert.equal(peekBootSettled('shared', 'u1').error.message, 'offline');
});

test('sign-out clears everything', () => {
  putBoot('tier', 'u1', Promise.resolve({}));
  clearBoot();
  assert.equal(takeBoot('tier', 'u1'), null);
});
