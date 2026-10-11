import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { invitedStartWorkspace } from './startWorkspace.js';

const user = { id: 'me', created_at: '2026-10-11T10:00:00.000Z' };

test('an account that signed up from an invite starts in the workspace it was invited to', () => {
  const ws = [
    { id: 'mine', created_by: 'me', _joinedAt: '2026-10-11T10:00:05.000Z' },
    { id: 'theirs', created_by: 'inviter', _joinedAt: '2026-10-11T10:00:00.050Z' },
  ];
  assert.equal(invitedStartWorkspace(ws, user)?.id, 'theirs');
});

test('an invite joined long after signup does not hijack the first workspace', () => {
  const ws = [
    { id: 'mine', created_by: 'me', _joinedAt: '2026-10-11T10:00:05.000Z' },
    { id: 'later', created_by: 'someone', _joinedAt: '2026-10-12T09:00:00.000Z' },
  ];
  assert.equal(invitedStartWorkspace(ws, user), null);
});

test('missing or malformed data never picks anything', () => {
  assert.equal(invitedStartWorkspace(null, user), null);
  assert.equal(invitedStartWorkspace([], user), null);
  assert.equal(invitedStartWorkspace([{ id: 'x', created_by: 'y', _joinedAt: null }], user), null);
  assert.equal(invitedStartWorkspace([{ id: 'x', created_by: 'y', _joinedAt: '2026-10-11T10:00:00Z' }], { id: 'me' }), null);
});

test('the personal workspace is one the account owns, and the app waits for the list before choosing', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/0400_personal_workspace_is_your_own.sql', import.meta.url), 'utf8');
  assert.match(sql, /where w\.created_by = p_user_id/);
  assert.doesNotMatch(sql.slice(sql.indexOf('create or replace function')), /join workspace_members m on m\.workspace_id = w\.id/);
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
  assert.match(app, /invitedStartWorkspace\(workspaces, user\)/);
  assert.match(app, /!activeWorkspaceId && wsListLoading/);
});
