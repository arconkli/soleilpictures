import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNNAMED_WORKSPACE, isUnnamedWorkspace, findTokens, matchesFind, findHitKind,
  groupSharedByPerson, OPENED_KEY, readOpenedWorkspaces, noteWorkspaceOpened, orderSharedWorkspaces,
} from './sharedPeople.js';

const fake = (init) => {
  const m = new Map(init ? [[OPENED_KEY, init]] : []);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
};

test('isUnnamedWorkspace', () => {
  assert.equal(UNNAMED_WORKSPACE, 'Personal Workspace');
  for (const n of [null, undefined, '', '   ', 'Personal Workspace', '  personal workspace ']) assert.equal(isUnnamedWorkspace(n), true, String(n));
  assert.equal(isUnnamedWorkspace('Dune'), false);
});

test('matching folds accents and case, and needs every token', () => {
  assert.deepEqual(findTokens('  Sam   DUNE '), ['sam', 'dune']);
  assert.equal(matchesFind('jose', ['José Ruiz']), true);
  assert.equal(matchesFind('JOSÉ', ['jose']), true);
  assert.equal(matchesFind('sam dune', ['Dune lookbook', 'Sam Lee']), true);
  assert.equal(matchesFind('sam dune', ['Dune lookbook', 'Ann Lee']), false);
  assert.equal(matchesFind('', ['x']), true);
  assert.equal(matchesFind('   ', []), true);
  assert.equal(matchesFind('x', [null, undefined, '']), false);
});

test('findHitKind', () => {
  assert.equal(findHitKind('dune', ['Dune lookbook'], ['Sam Lee']), 'name');
  assert.equal(findHitKind('sam', ['Dune lookbook'], ['Sam Lee']), 'person');
  assert.equal(findHitKind('sam dune', ['Dune lookbook'], ['Sam Lee']), 'person');
  assert.equal(findHitKind('zzz', ['Dune'], ['Sam']), null);
  assert.equal(findHitKind('', ['Dune'], ['Sam']), 'person');
});

const row = (o) => ({
  board_id: 'b', board_name: 'B', created_at: '2026-01-01T00:00:00Z', source_workspace_id: 'w1',
  source_workspace_name: 'Personal Workspace', shared_by: 'u1', shared_by_name: 'Sam Lee', shared_by_color: '#aabbcc', ...o,
});

test('groups by sharer, falling back to the workspace', () => {
  const g = groupSharedByPerson([
    row({ board_id: 'a', shared_by: 'u1' }),
    row({ board_id: 'b', shared_by: 'u1', source_workspace_id: 'w2' }),
    row({ board_id: 'c', shared_by: null, shared_by_name: null, shared_by_color: null, source_workspace_id: 'w3', source_workspace_name: 'Studio' }),
    { board_id: 'd', board_name: 'D', created_at: '2026-01-01T00:00:00Z', source_workspace_id: 'w3', source_workspace_name: 'Studio' },
  ]);
  assert.deepEqual(g.map((x) => x.key).sort(), ['p:u1', 'w:w3']);
  const w = g.find((x) => x.key === 'w:w3');
  assert.equal(w.personId, null);
  assert.equal(w.personName, null);
  assert.equal(w.workspaceName, 'Studio');
  assert.equal(w.rows.length, 2);
});

test('ordering of groups and rows, newest-row workspace, name and colour picks', () => {
  const rows = [
    row({ board_id: '1', board_name: 'Beta', created_at: '2026-03-01T00:00:00Z', shared_by: 'u1', shared_by_name: '  ', shared_by_color: 'red', source_workspace_id: 'wOld' }),
    row({ board_id: '2', board_name: 'alpha', created_at: '2026-03-01T00:00:00Z', shared_by: 'u1', shared_by_name: ' Sam Lee ', shared_by_color: '#AABBCC', source_workspace_id: 'wNew', source_workspace_name: 'N' }),
    row({ board_id: '3', board_name: 'Old', created_at: '2026-02-01T00:00:00Z', shared_by: 'u1' }),
    row({ board_id: '4', board_name: 'X', created_at: '2026-03-05T00:00:00Z', shared_by: 'u2', shared_by_name: 'Ann', shared_by_color: null }),
    row({ board_id: '5', board_name: 'Y', created_at: 'nonsense', shared_by: 'u3', shared_by_name: 'Zed' }),
  ];
  const before = JSON.stringify(rows);
  const g = groupSharedByPerson(rows);
  assert.equal(JSON.stringify(rows), before, 'input not mutated');
  assert.deepEqual(g.map((x) => x.key), ['p:u2', 'p:u1', 'p:u3']);
  const u1 = g[1];
  assert.deepEqual(u1.rows.map((r) => r.board_id), ['2', '1', '3']);
  assert.equal(u1.personName, 'Sam Lee');
  assert.equal(u1.personColor, '#AABBCC');
  assert.equal(u1.workspaceId, 'wNew');
  assert.equal(u1.newest, Date.parse('2026-03-01T00:00:00Z'));
  assert.equal(g[0].personColor, null);
  assert.equal(g[2].newest, 0);
});

test('equal newest orders by person name', () => {
  const g = groupSharedByPerson([
    row({ shared_by: 'u1', shared_by_name: 'Zed' }),
    row({ shared_by: 'u2', shared_by_name: 'Ann' }),
  ]);
  assert.deepEqual(g.map((x) => x.personName), ['Ann', 'Zed']);
});

test('opened map round trip, bad data and throwing storage', () => {
  const s = fake();
  assert.deepEqual(readOpenedWorkspaces(s), {});
  noteWorkspaceOpened('a', 5, s);
  noteWorkspaceOpened('b', 9, s);
  assert.deepEqual(readOpenedWorkspaces(s), { a: 5, b: 9 });
  assert.deepEqual(readOpenedWorkspaces(fake('not json')), {});
  assert.deepEqual(readOpenedWorkspaces(fake('[1]')), {});
  assert.deepEqual(readOpenedWorkspaces(fake('{"a":1,"b":"x","c":null}')), { a: 1 });
  const bad = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); } };
  assert.deepEqual(readOpenedWorkspaces(bad), {});
  assert.doesNotThrow(() => noteWorkspaceOpened('a', 1, bad));
  assert.deepEqual(readOpenedWorkspaces(null), {});
});

test('keeps only the 30 most recent', () => {
  const s = fake();
  for (let i = 0; i < 35; i++) noteWorkspaceOpened('w' + i, i + 1, s);
  const o = readOpenedWorkspaces(s);
  assert.equal(Object.keys(o).length, 30);
  assert.ok(!('w0' in o) && 'w34' in o && 'w5' in o);
});

test('orderSharedWorkspaces', () => {
  const L = [{ id: 'a', j: 1 }, { id: 'b', j: 3 }, { id: 'c', j: 2 }, { id: 'd', j: 4 }];
  const ids = (x) => x.map((w) => w.id).join('');
  assert.equal(ids(orderSharedWorkspaces(L, {})), 'dcba');
  assert.equal(ids(orderSharedWorkspaces(L, {}, (w) => w.j)), 'dbca');
  assert.equal(ids(orderSharedWorkspaces(L, { a: 10, c: 20 }, (w) => w.j)), 'cadb');
  assert.equal(ids(orderSharedWorkspaces(L, { a: 10, c: 20 })), 'cadb');
  assert.equal(ids(orderSharedWorkspaces(L, null, () => NaN)), 'dcba');
  const copy = orderSharedWorkspaces(L, {});
  assert.notEqual(copy, L);
  assert.equal(ids(L), 'abcd');
});
