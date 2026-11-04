import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKSPACE_LIMIT, WORKSPACE_LIMIT_HINT, WORKSPACE_NEAR_AT,
  ownPersonalCount, workspaceLimitStage, isWorkspaceLimitError,
  workspaceCountFromError, workspaceCountLine,
} from './workspaceLimit.js';

const ME = 'u-me';
const flat = (n, extra = {}) => ({ id: `w${n}`, created_by: ME, org_id: null, ...extra });
const boot = (w, role = 'owner') => ({ workspace_id: w.id, role, created_at: 'x', workspaces: w });

test('constants', () => {
  assert.equal(WORKSPACE_LIMIT, 10);
  assert.equal(WORKSPACE_LIMIT_HINT, 'workspace_limit');
  assert.equal(WORKSPACE_NEAR_AT, 8);
});

test('ownPersonalCount counts mine outside a team, in both list shapes', () => {
  const list = [
    flat(1), flat(2),
    flat(3, { created_by: 'u-other' }),   // invited into
    flat(4, { org_id: 'org-1' }),         // a team's
    flat(5, { _viaTeam: true, org_id: 'org-1' }),
  ];
  assert.equal(ownPersonalCount(list, ME), 2);
  assert.equal(ownPersonalCount(list.map((w) => boot(w)), ME), 2);
  assert.equal(ownPersonalCount([flat(1), boot(flat(2))], ME), 2, 'mixed rows');
});

test('ownPersonalCount is 0 for a missing list, user or null rows', () => {
  assert.equal(ownPersonalCount(null, ME), 0);
  assert.equal(ownPersonalCount(undefined, ME), 0);
  assert.equal(ownPersonalCount([flat(1)], null), 0);
  assert.equal(ownPersonalCount([null, { workspaces: null }], ME), 0);
});

test('workspaceLimitStage', () => {
  assert.equal(workspaceLimitStage(0), 'room');
  assert.equal(workspaceLimitStage(7), 'room');
  assert.equal(workspaceLimitStage(8), 'near');
  assert.equal(workspaceLimitStage(9), 'near');
  assert.equal(workspaceLimitStage(10), 'full');
  assert.equal(workspaceLimitStage(11), 'over');
});

test('isWorkspaceLimitError reads the hint, else the message start', () => {
  assert.equal(isWorkspaceLimitError({ hint: 'workspace_limit' }), true);
  assert.equal(isWorkspaceLimitError({ message: 'workspace limit reached: you have 10 workspaces of your own' }), true);
  assert.equal(isWorkspaceLimitError({ error: { message: 'workspace limit reached: x' } }), true);
  assert.equal(isWorkspaceLimitError({ cause: { message: 'workspace limit reached: x' } }), true);
  assert.equal(isWorkspaceLimitError({ hint: 'editor_limit', message: 'editor limit reached' }), false);
  assert.equal(isWorkspaceLimitError({ message: 'a workspace limit reached' }), false);
  assert.equal(isWorkspaceLimitError(null), false);
  assert.equal(isWorkspaceLimitError(new Error('boom')), false);
});

test('workspaceCountFromError', () => {
  const m = 'workspace limit reached: you have 12 workspaces of your own, the most outside Team';
  assert.equal(workspaceCountFromError({ message: m }), 12);
  assert.equal(workspaceCountFromError({ cause: { message: m } }), 12);
  assert.equal(workspaceCountFromError({ message: 'nope' }), null);
  assert.equal(workspaceCountFromError(undefined), null);
});

test('workspaceCountLine', () => {
  assert.equal(workspaceCountLine(0), '');
  assert.equal(workspaceCountLine(7), '');
  assert.equal(workspaceCountLine(8), '8 of 10 workspaces');
  assert.equal(workspaceCountLine(9), '9 of 10 workspaces');
  assert.equal(workspaceCountLine(10), '10 of 10 workspaces · Team has no limit');
  assert.equal(workspaceCountLine(12), '12 of 10 workspaces · Team has no limit');
  assert.equal(workspaceCountLine(10, { teams: false }), '10 of 10 workspaces');
  assert.equal(workspaceCountLine(9, { mixed: true }), '9 of 10 of your own');
  assert.equal(workspaceCountLine(10, { mixed: true }), '10 of 10 of your own · Team has no limit');
  assert.equal(workspaceCountLine(10, { mixed: true, teams: false }), '10 of 10 of your own');
});
