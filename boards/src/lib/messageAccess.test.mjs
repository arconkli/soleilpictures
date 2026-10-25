// COMMS-08: who may send messages follows the server's rule — the insert
// policy's can_write_workspace on the current workspace — by ROLE, not plan.
// A free editor was told sending "requires a paid plan" for a send the
// server takes; a paid viewer got a composer whose every send failed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { messagingAccess, readOnlyCopy, MESSAGE_WRITER_ROLES, startChatErrorMessage } from './messageAccess.js';

const me = 'u-me';
const theirs = { id: 'ws-1', created_by: 'u-owner' };

test('a free editor in someone else\'s workspace can message', () => {
  assert.deepEqual(messagingAccess({ tier: 'demo', workspace: theirs, role: 'editor', userId: me }),
    { canSend: true, reason: null });
});

test('a paid viewer cannot, and is told it is the role', () => {
  const a = messagingAccess({ tier: 'paid', workspace: theirs, role: 'viewer', userId: me });
  assert.deepEqual(a, { canSend: false, reason: 'viewer' });
  assert.match(readOnlyCopy(a.reason).notice, /viewer/);
  assert.doesNotMatch(readOnlyCopy(a.reason).notice, /paid plan/);
});

test('the owner always can, whatever the plan; the waitlist never can', () => {
  assert.equal(messagingAccess({ tier: 'demo', workspace: { created_by: me }, role: null, userId: me }).canSend, true);
  assert.deepEqual(messagingAccess({ tier: 'waitlist', workspace: { created_by: me }, role: 'owner', userId: me }),
    { canSend: false, reason: 'waitlist' });
});

test('the writer roles match _workspace_member_can_write (0391)', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/0391_workspace_coowner.sql', import.meta.url), 'utf8');
  const m = sql.match(/_workspace_member_role\(ws\) in \(([^)]*)\)/);
  assert.ok(m, 'the role list is still where this test reads it');
  const roles = m[1].split(',').map(s => s.trim().replace(/'/g, ''));
  assert.deepEqual([...MESSAGE_WRITER_ROLES].sort(), roles.sort());
  for (const r of roles) {
    assert.equal(messagingAccess({ tier: 'demo', workspace: theirs, role: r, userId: me }).canSend, true, r);
  }
});

// COMMS-25: starting a DM or a group that the server refused just re-enabled
// the button. The picker now says why.
test('a refused new chat is explained', () => {
  assert.match(startChatErrorMessage({ message: 'cannot message this user' }), /can't message this person/);
  assert.match(startChatErrorMessage({ message: 'cannot message one or more selected users' }, { group: true }), /one or more/);
  assert.match(startChatErrorMessage({ message: 'must be a workspace member' }), /not a member of this workspace/);
  assert.match(startChatErrorMessage(new TypeError('Failed to fetch')), /Check your connection/);
  assert.equal(startChatErrorMessage(null, { group: true }), "Couldn't create the group — try again.");
  const picker = readFileSync(new URL('../components/NewConversationPicker.jsx', import.meta.url), 'utf8');
  assert.match(picker, /feedback\.toast\(\{ type: 'error', code: 'chat_start_failed', message: startChatErrorMessage\(e\) \}\)/);
  assert.match(picker, /feedback\.toast\(\{ type: 'error', code: 'group_create_failed', message: startChatErrorMessage\(e, \{ group: true \}\) \}\)/);
});

test('App passes the role-based answer, with no plan branch left', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(app, /canSendMessages=\{msgAccess\.canSend\}/);
  assert.match(app, /readOnlyReason=\{msgAccess\.reason\}/);
  assert.doesNotMatch(app, /\? workspaceMembers\.some\(m => m\.user_id === user\.id\)/);
});
