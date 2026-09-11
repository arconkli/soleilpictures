import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBoardPermission } from '../hooks/useBoardPermission.js';

const ws = { id: 'ws1', created_by: 'owner' };
const board = { id: 'b1', workspace_id: 'ws1', parent_board_id: null };
const base = { board, boards: { b1: board }, workspace: ws, sharedBoards: [], tier: 'demo' };

test('a workspace viewer resolves to read-only', () => {
  const r = computeBoardPermission({ ...base, userId: 'v', workspaceMembers: [{ user_id: 'v', role: 'viewer' }] });
  assert.deepEqual(r, { role: 'viewer', canEdit: false, source: 'workspace' });
});

test('a workspace editor and a service member still write', () => {
  for (const role of ['editor', 'service', 'owner']) {
    const r = computeBoardPermission({ ...base, userId: 'e', workspaceMembers: [{ user_id: 'e', role }] });
    assert.equal(r.canEdit, true, role);
    assert.equal(r.source, 'workspace');
  }
});

test('an editor share on the board beats a viewer membership', () => {
  const r = computeBoardPermission({
    ...base, userId: 'v',
    workspaceMembers: [{ user_id: 'v', role: 'viewer' }],
    sharedBoards: [{ board_id: 'b1', role: 'editor' }],
  });
  assert.deepEqual(r, { role: 'editor', canEdit: true, source: 'share' });
});

test('the workspace owner is unaffected', () => {
  const r = computeBoardPermission({ ...base, userId: 'owner', workspaceMembers: [] });
  assert.equal(r.role, 'owner');
});
