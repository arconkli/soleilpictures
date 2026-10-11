import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canManageWorkspace, canWriteWorkspace, WORKSPACE_ROLE_LABEL, ASSIGNABLE_ROLES } from './workspaceRoles.js';

test('owner and co-owner manage; nobody else does', () => {
  assert.equal(canManageWorkspace('owner'), true);
  assert.equal(canManageWorkspace('coowner'), true);
  for (const r of ['admin', 'editor', 'viewer', 'service', null, undefined, '']) {
    assert.equal(canManageWorkspace(r), false, String(r));
  }
});

test('viewers do not write', () => {
  assert.equal(canWriteWorkspace('viewer'), false);
  assert.equal(canWriteWorkspace(null), false);
  for (const r of ['owner', 'coowner', 'admin', 'editor', 'service']) assert.equal(canWriteWorkspace(r), true, r);
});

test('every assignable role has a label, and owner is never assignable', () => {
  for (const r of ASSIGNABLE_ROLES) assert.ok(WORKSPACE_ROLE_LABEL[r], r);
  assert.equal(ASSIGNABLE_ROLES.includes('owner'), false);
  assert.equal(WORKSPACE_ROLE_LABEL.coowner, 'Co-owner');
});
