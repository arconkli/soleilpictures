// setupGate.test.mjs — who sees the first-run setup, and what it says to
// someone who was invited.
//
//   node --test src/lib/setupGate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readSetupOverride, inviteeTarget, inviteeCopy, rememberSetup, getSetupOutcome,
  resetSetupOutcomeForTests, stampSetupArm, SETUP_OVERRIDE_KEY, STAMP_MARK_PREFIX, STAMP_TRIES,
} from './setupGate.js';

function mem() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

test('?setup= picks an arm only where it is allowed, and holds for the tab', () => {
  const s = mem();
  assert.equal(readSetupOverride({ search: '?setup=b', storage: s, allowed: false }), null);
  assert.equal(s._m.has(SETUP_OVERRIDE_KEY), false, 'nothing remembered where it is not allowed');
  assert.equal(readSetupOverride({ search: '?setup=b', storage: s, allowed: true }), 'B');
  assert.equal(readSetupOverride({ search: '', storage: s, allowed: true }), 'B', 'a reload keeps it');
  assert.equal(readSetupOverride({ search: '?setup=A', storage: s, allowed: true }), 'A');
  assert.equal(readSetupOverride({ search: '?setup=C', storage: s, allowed: true }), 'A', 'a junk value keeps the last');
  assert.equal(readSetupOverride({ search: '', storage: null, allowed: true }), null);
});

const me = { id: 'me', created_at: '2026-10-21T10:00:00Z' };

test('no invite: someone starting out on their own', () => {
  const own = { id: 'w1', created_by: 'me', _joinedAt: '2026-10-21T10:00:01Z' };
  assert.equal(inviteeTarget({ user: me, memberships: [own], slot: { activeWorkspaceId: null } }), null);
  assert.equal(inviteeTarget({ user: me, memberships: [own], slot: { activeWorkspaceId: 'w1' } }), null,
    'the slot pointing at their own workspace is not an invite');
  assert.equal(inviteeTarget({ user: null, memberships: [own] }), null);
});

test('an email invite or a workspace link: the slot names someone else\'s workspace', () => {
  const own = { id: 'w1', created_by: 'me', _joinedAt: '2026-10-21T10:00:01Z' };
  const theirs = { id: 'w2', name: 'Lost Time', created_by: 'nora', _joinedAt: '2026-10-21T10:00:02Z' };
  assert.deepEqual(inviteeTarget({ user: me, memberships: [own, theirs], slot: { activeWorkspaceId: 'w2' } }),
    { kind: 'workspace', workspace: theirs });
});

test('a cluster link: a cluster in a workspace they are not a member of', () => {
  assert.deepEqual(inviteeTarget({ user: me, memberships: [], slot: { activeWorkspaceId: 'w9', boardId: 'b9' } }),
    { kind: 'board', workspaceId: 'w9', boardId: 'b9' });
  assert.equal(inviteeTarget({ user: me, memberships: [], slot: { activeWorkspaceId: 'w9', boardId: null } }), null,
    'no cluster to name: not treated as an invite');
});

test('a claim made on another device: the membership born with the account', () => {
  const theirs = { id: 'w2', name: 'Lost Time', created_by: 'nora', _joinedAt: '2026-10-21T10:01:00Z' };
  const later = { id: 'w3', name: 'Later', created_by: 'jon', _joinedAt: '2026-10-25T10:00:00Z' };
  assert.deepEqual(inviteeTarget({ user: me, memberships: [later, theirs], slot: {} }), { kind: 'workspace', workspace: theirs });
  assert.equal(inviteeTarget({ user: me, memberships: [later], slot: {} }), null, 'joined days later is not how they arrived');
});

test('the invitee step names the workspace and the people in it', () => {
  assert.deepEqual(inviteeCopy({ name: 'Lost Time', owner: 'Nora', others: ['Jon', 'Priya'], role: 'editor', kind: 'workspace' }),
    { head: 'You’re joining Lost Time', sub: 'Nora invited you. You can add to and edit everything in it, with Nora, Jon and Priya.' });
  assert.deepEqual(inviteeCopy({ name: 'Lost Time', owner: 'Nora', role: 'viewer', kind: 'workspace' }),
    { head: 'You’re joining Lost Time', sub: 'Nora invited you. You can see everything in it, with Nora.' });
  assert.deepEqual(inviteeCopy({ name: 'Storyboard v2', kind: 'board' }),
    { head: 'You’re joining Storyboard v2', sub: 'You can add to it and edit it.' });
  assert.deepEqual(inviteeCopy({}), { head: 'You’re in', sub: 'You can add to and edit everything in it.' });
});

test('App reads the outcome for the same account only', () => {
  resetSetupOutcomeForTests();
  assert.equal(getSetupOutcome('me'), null);
  rememberSetup('me', { arm: 'B' });
  rememberSetup('me', { welcome: { done: true, work: 'film' } });
  assert.deepEqual(getSetupOutcome('me'), { arm: 'B', welcome: { done: true, work: 'film' }, override: false });
  assert.equal(getSetupOutcome('someone-else'), null);
  rememberSetup('someone-else', { arm: 'A', override: true });
  assert.equal(getSetupOutcome('me'), null, 'another account replaces it');
  assert.equal(getSetupOutcome('someone-else').override, true, 'a QA override is told apart from the test');
});

// The server's answers, in order: { error } objects, rejections, throws.
function server(...answers) {
  const calls = [];
  const rpc = () => {
    const a = answers[Math.min(calls.length, answers.length - 1)];
    calls.push(a);
    if (a === 'throw') throw new Error('offline');
    if (a === 'reject') return { then: (_ok, fail) => fail(new Error('offline')) };
    return { then: (ok) => ok(a) };   // a thenable, like the PostgREST builder
  };
  return { rpc, calls };
}
const noWait = async () => {};

test('the arm is marked and logged once the server has it, and only once', async () => {
  const s = mem();
  const logs = [];
  const { rpc, calls } = server({ error: null });
  assert.equal(await stampSetupArm({ uid: 'me', arm: 'B', rpc, storage: s, log: () => logs.push(1), wait: noWait }), 'stamped');
  assert.equal(s.getItem(`${STAMP_MARK_PREFIX}me`), 'B');
  assert.equal(logs.length, 1);
  assert.equal(await stampSetupArm({ uid: 'me', arm: 'B', rpc, storage: s, log: () => logs.push(1), wait: noWait }), 'already');
  assert.equal(calls.length, 1, 'a stamped account is never stamped again');
  assert.equal(logs.length, 1);
});

test('a failed stamp is tried again, and never marked or logged until it lands', async () => {
  // supabase-js resolves a failure as { error } instead of rejecting.
  const s = mem();
  const logs = [];
  const flaky = server({ error: { message: 'Failed to fetch' } }, 'reject', { error: null });
  assert.equal(await stampSetupArm({ uid: 'me', arm: 'A', rpc: flaky.rpc, storage: s, log: () => logs.push(1), wait: noWait }), 'stamped');
  assert.equal(flaky.calls.length, 3);
  assert.equal(logs.length, 1);

  const s2 = mem();
  const down = server('throw');
  const waits = [];
  assert.equal(await stampSetupArm({ uid: 'you', arm: 'A', rpc: down.rpc, storage: s2, log: () => logs.push(1), wait: async (ms) => { waits.push(ms); } }), 'failed');
  assert.equal(down.calls.length, STAMP_TRIES);
  assert.equal(waits.length, STAMP_TRIES - 1, 'a pause between tries, none after the last');
  assert.equal(s2.getItem(`${STAMP_MARK_PREFIX}you`), null, 'unmarked, so the next load tries again');
  assert.equal(logs.length, 1, 'no enrollment logged for a stamp that never landed');

  const later = server({ error: null });
  assert.equal(await stampSetupArm({ uid: 'you', arm: 'A', rpc: later.rpc, storage: s2, log: () => logs.push(1), wait: noWait }), 'stamped');
  assert.equal(logs.length, 2);
});

test('the stamp works without storage, and refuses to run without an account or an arm', async () => {
  const { rpc, calls } = server({ error: null });
  assert.equal(await stampSetupArm({ uid: 'me', arm: 'B', rpc, storage: null, wait: noWait }), 'stamped');
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(await stampSetupArm({ uid: 'me', arm: 'B', rpc, storage: broken, wait: noWait }), 'stamped');
  assert.equal(await stampSetupArm({ uid: null, arm: 'B', rpc, wait: noWait }), 'failed');
  assert.equal(await stampSetupArm({ uid: 'me', arm: null, rpc, wait: noWait }), 'failed');
  assert.equal(calls.length, 2);
});

test('another test stamping the same way keeps its own mark, and leaves the setup\'s alone', async () => {
  const s = mem();
  const { rpc, calls } = server({ error: null });
  const prefix = 'soleil.board_more.enrolled.';
  assert.equal(await stampSetupArm({ uid: 'me', arm: 'A', rpc, storage: s, wait: noWait, markPrefix: prefix }), 'stamped');
  assert.equal(s.getItem(`${prefix}me`), 'A');
  assert.equal(s.getItem(`${STAMP_MARK_PREFIX}me`), null, 'the setup is still stamped on its own');
  assert.equal(await stampSetupArm({ uid: 'me', arm: 'A', rpc, storage: s, wait: noWait, markPrefix: prefix }), 'already');
  assert.equal(await stampSetupArm({ uid: 'me', arm: 'B', rpc, storage: s, wait: noWait }), 'stamped');
  assert.equal(calls.length, 2);
});
