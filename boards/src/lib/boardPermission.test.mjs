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

// A workspace reached through a team has no workspace_members row (0530); the
// app lists it _viaTeam with the person's team role in _myRole.
const teamWs = (role) => ({ id: 'ws1', created_by: 'owner', _viaTeam: true, _myRole: role });

test('a team editor with no membership row writes', () => {
  const r = computeBoardPermission({ ...base, workspace: teamWs('editor'), userId: 't', workspaceMembers: [] });
  assert.deepEqual(r, { role: 'editor', canEdit: true, source: 'workspace' });
});

test('a team owner or admin (coowner) with no membership row writes', () => {
  const r = computeBoardPermission({ ...base, workspace: teamWs('coowner'), userId: 't', workspaceMembers: [] });
  assert.equal(r.canEdit, true);
  assert.equal(r.source, 'workspace');
});

test('a team viewer with no membership row reads', () => {
  const r = computeBoardPermission({ ...base, workspace: teamWs('viewer'), userId: 't', workspaceMembers: [] });
  assert.deepEqual(r, { role: 'viewer', canEdit: false, source: 'workspace' });
});

test('an editor share on the board beats a team viewer', () => {
  const r = computeBoardPermission({
    ...base, workspace: teamWs('viewer'), userId: 't', workspaceMembers: [],
    sharedBoards: [{ board_id: 'b1', role: 'editor' }],
  });
  assert.deepEqual(r, { role: 'editor', canEdit: true, source: 'share' });
});

test('team access does not reach a board of another workspace', () => {
  const other = { id: 'b9', workspace_id: 'ws2', parent_board_id: null };
  for (const role of ['coowner', 'editor', 'viewer']) {
    const r = computeBoardPermission({
      ...base, board: other, boards: { b9: other }, workspace: teamWs(role), userId: 't', workspaceMembers: [],
    });
    assert.deepEqual(r, { role: 'none', canEdit: false, source: null }, role);
  }
});

test('a _myRole without _viaTeam grants nothing', () => {
  const r = computeBoardPermission({
    ...base, workspace: { id: 'ws1', created_by: 'owner', _myRole: 'editor' }, userId: 't', workspaceMembers: [],
  });
  assert.deepEqual(r, { role: 'none', canEdit: false, source: null });
});

test('an unknown or missing team role grants nothing', () => {
  for (const role of [null, undefined, 'owner', 'bogus']) {
    const r = computeBoardPermission({ ...base, workspace: teamWs(role), userId: 't', workspaceMembers: [] });
    assert.deepEqual(r, { role: 'none', canEdit: false, source: null }, String(role));
  }
});

test('a membership row decides over the team role', () => {
  const r = computeBoardPermission({
    ...base, workspace: teamWs('coowner'), userId: 'v', workspaceMembers: [{ user_id: 'v', role: 'viewer' }],
  });
  assert.deepEqual(r, { role: 'viewer', canEdit: false, source: 'workspace' });
});
