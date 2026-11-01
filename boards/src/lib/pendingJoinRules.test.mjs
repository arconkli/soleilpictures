// pendingJoinRules.test.mjs — a stashed join is claimed once, and what the
// toasts say.
//
//   node --test src/lib/pendingJoinRules.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
globalThis.localStorage = mem();

const { stashPendingJoin, readPendingJoin, clearPendingJoin } = await import('./pendingJoin.js');
const {
  makeJoinConsumer, JOIN_RETRY, isInviteLinkNotFound, joinFailureKind, joinFailureMessage, joinSuccessMessage,
} = await import('./pendingJoinRules.js');

const T = '0f9a5c3e-1b2d-4e5f-8a9b-0c1d2e3f4a5b';
const U = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

test('single flight: two callers at once claim one pending join exactly once', async () => {
  globalThis.localStorage = mem();
  stashPendingJoin({ token: T, kind: 'view' });
  let runs = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const consume = makeJoinConsumer({
    read: readPendingJoin,
    clear: clearPendingJoin,
    run: async (p) => { runs += 1; await gate; return p.token; },
  });
  const a = consume('u1');
  // the stash stays until the claim has an answer
  assert.equal(readPendingJoin().token, T);
  const b = consume('u1');
  assert.strictEqual(a, b, 'the second caller gets the first caller\'s promise');
  release();
  assert.equal(await a, T);
  assert.equal(runs, 1);
  assert.equal(readPendingJoin(), null, 'a success clears the stash');
  // done, nothing pending: a late caller does nothing
  assert.equal(await consume('u1'), null);
  assert.equal(runs, 1);
});

test('a thrown claim keeps the stash, clears the guard, and a new pending join can run', async () => {
  globalThis.localStorage = mem();
  stashPendingJoin({ token: T, kind: 'invite' });
  const consume = makeJoinConsumer({
    read: readPendingJoin,
    clear: clearPendingJoin,
    run: async (p) => { if (p.token === T) throw new Error('boom'); return p.token; },
  });
  await assert.rejects(consume(), /boom/);
  assert.equal(readPendingJoin().token, T, 'a transient failure is retried on the next sign-in');
  stashPendingJoin({ token: U, kind: 'view' });
  assert.equal(await consume(), U);
  assert.equal(readPendingJoin(), null);
});

test('a transient failure (JOIN_RETRY) keeps the stash; a terminal one clears it; a success clears it', async () => {
  globalThis.localStorage = mem();
  stashPendingJoin({ token: T, kind: 'view', name: 'Lost Time' });
  let outcome = JOIN_RETRY;
  let runs = 0;
  const consume = makeJoinConsumer({
    read: readPendingJoin,
    clear: clearPendingJoin,
    run: async () => { runs += 1; return outcome; },
  });
  assert.equal(await consume('u1'), null);
  assert.equal(readPendingJoin()?.token, T, 'transient: still stashed');
  assert.equal(readPendingJoin().name, 'Lost Time');
  assert.equal(await consume('u1'), null);
  assert.equal(runs, 2, 'the next call retries it');
  assert.equal(readPendingJoin()?.token, T);

  // terminal: run handled it (a toast said the link is gone) and resolved normally
  outcome = undefined;
  await consume('u1');
  assert.equal(readPendingJoin(), null, 'terminal: cleared');

  stashPendingJoin({ token: U, kind: 'view' });
  outcome = { status: 'joined' };
  assert.deepEqual(await consume('u1'), { status: 'joined' });
  assert.equal(readPendingJoin(), null, 'success: cleared');
});

test('single flight: nothing pending is a quiet no-op', async () => {
  globalThis.localStorage = mem();
  let runs = 0;
  const consume = makeJoinConsumer({ read: readPendingJoin, clear: clearPendingJoin, run: async () => { runs += 1; } });
  assert.equal(await consume(), null);
  assert.equal(runs, 0);
});

test('an unknown-kind token falls back only on the invite link not found answer', () => {
  assert.equal(isInviteLinkNotFound({ code: 'P0002', message: 'invite link not found' }), true);
  assert.equal(isInviteLinkNotFound({ code: 'P0002', message: 'board no longer exists' }), false);
  assert.equal(isInviteLinkNotFound({ code: '22023', message: 'this invite link was turned off' }), false);
  assert.equal(isInviteLinkNotFound(null), false);
});

test('a link that is off, gone or one-cluster-only is named; other errors are not the link', () => {
  assert.equal(joinFailureKind({ code: 'P0002', message: 'share link not found' }), 'gone');
  assert.equal(joinFailureKind({ code: '22023', message: 'this share link was turned off' }), 'gone');
  assert.equal(joinFailureKind({ code: '22023', message: 'this link shares one cluster only' }), 'one_cluster');
  assert.equal(joinFailureKind({ code: '42501', message: 'must be signed in to join' }), null);
  assert.equal(joinFailureKind(new Error('Failed to fetch')), null);
});

test('the toasts name the person when we know them', () => {
  assert.equal(joinFailureMessage('gone', 'Andrew'), 'This link was turned off. Ask Andrew for a new one.');
  assert.equal(joinFailureMessage('gone', null), 'This link was turned off. Ask the person who sent it for a new one.');
  assert.equal(joinFailureMessage('one_cluster', 'Andrew'), 'This link can’t be joined. Ask Andrew to invite you.');
  assert.match(joinFailureMessage('one_cluster', ''), /^This link can’t be joined\. Ask the person who sent it/);
  assert.equal(joinSuccessMessage('joined', 'Lost Time'), 'You joined “Lost Time”. It stays in your sidebar.');
  assert.equal(joinSuccessMessage('already', 'Lost Time'), 'You’re already in “Lost Time”.');
  assert.equal(joinSuccessMessage('noop', 'Lost Time'), null);
  assert.equal(joinSuccessMessage('joined', null), 'You joined the cluster. It stays in your sidebar.');
});
