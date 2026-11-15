import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTeamWorkspaces, keepTeamWorkspaces } from './teamWorkspaceList.js';

const mine = { id: 'w1', name: 'Mine', _myRole: 'owner', _joinedAt: '2026-01-01' };
const row = (id, extra = {}) => ({ workspace: { id, name: `WS ${id}`, org_id: 'o1' }, role: 'member', created_at: '2026-02-02', ...extra });

test('withTeamWorkspaces appends each team workspace, marked and with its role and date', () => {
  const out = withTeamWorkspaces([mine], [row('t1'), row('t2', { role: 'admin' })]);
  assert.deepEqual(out, [
    mine,
    { id: 't1', name: 'WS t1', org_id: 'o1', _myRole: 'member', _joinedAt: '2026-02-02', _viaTeam: true },
    { id: 't2', name: 'WS t2', org_id: 'o1', _myRole: 'admin', _joinedAt: '2026-02-02', _viaTeam: true },
  ]);
});

test('withTeamWorkspaces skips rows with no workspace id and ids already listed or repeated', () => {
  const out = withTeamWorkspaces([mine], [
    row('w1'), row('t1'), row('t1'), { workspace: {}, role: 'member' }, { workspace: null }, null, undefined,
  ]);
  assert.deepEqual(out.map((w) => w.id), ['w1', 't1']);
  assert.equal(out[0], mine);
});

test('withTeamWorkspaces with nothing to add returns the memberships, and a new array', () => {
  const base = [mine];
  assert.deepEqual(withTeamWorkspaces(base, []), base);
  assert.deepEqual(withTeamWorkspaces(base, null), base);
  assert.notEqual(withTeamWorkspaces(base, []), base);
  assert.deepEqual(withTeamWorkspaces(null, [row('t1')]).map((w) => w.id), ['t1']);
});

test('keepTeamWorkspaces keeps the team workspaces the list held, after the memberships', () => {
  const t1 = { id: 't1', _viaTeam: true };
  const prev = [mine, t1];
  assert.deepEqual(keepTeamWorkspaces([mine], prev), [mine, t1]);
  assert.equal(keepTeamWorkspaces([mine], prev)[1], t1);
});

test('keepTeamWorkspaces drops what is not via a team, and what the memberships now hold', () => {
  const gone = { id: 'w9', name: 'Left' };
  const nowMember = { id: 't1', _viaTeam: true };
  const base = [mine, { id: 't1', name: 'Joined', _myRole: 'member' }];
  assert.deepEqual(keepTeamWorkspaces(base, [gone, nowMember, { id: 't2', _viaTeam: true }]).map((w) => w.id), ['w1', 't1', 't2']);
  assert.deepEqual(keepTeamWorkspaces([mine], [gone]), [mine]);
});

test('keepTeamWorkspaces copes with an empty or missing list and does not repeat an id', () => {
  assert.deepEqual(keepTeamWorkspaces([mine], []), [mine]);
  assert.deepEqual(keepTeamWorkspaces([mine], null), [mine]);
  assert.deepEqual(keepTeamWorkspaces(null, [{ id: 't1', _viaTeam: true }]).map((w) => w.id), ['t1']);
  assert.deepEqual(keepTeamWorkspaces([], [{ id: 't1', _viaTeam: true }, { id: 't1', _viaTeam: true }]).map((w) => w.id), ['t1']);
});
