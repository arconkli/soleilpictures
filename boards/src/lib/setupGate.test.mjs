// setupGate.test.mjs — who sees the first-run setup, and what it says to
// someone who was invited.
//
//   node --test src/lib/setupGate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readSetupOverride, inviteeTarget, inviteeCopy, rememberSetup, getSetupOutcome,
  resetSetupOutcomeForTests, SETUP_OVERRIDE_KEY,
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
