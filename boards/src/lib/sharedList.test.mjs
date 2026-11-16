import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SIDEBAR_SHARED_CAP, NAMELESS_SHARER, sharedMetaMap, patchSharedMeta, isNewShare, isHiddenShare,
  visibleSharedRoots, sidebarSharedRoots, newSharedCount, sharedRootOf, sharedPathOf, sharedChildrenMap,
  withYouItems, groupWithYou, byYouItems, itemFindFields, filterGroups, countItems, itemHitKind,
} from './sharedList.js';

const ids = (rows) => rows.map((r) => r.board_id).join(',');
const root = (id, name, created_at, extra = {}) => ({ board_id: id, board_name: name, created_at, is_shared_root: true, ...extra });

test('sharedMetaMap + patchSharedMeta', () => {
  const m = sharedMetaMap([
    { board_id: 'a', shared_at: 's', opened_at: 'o', hidden_at: null, via_link: true },
    { board_id: 'b' },
    { shared_at: 'x' },
    null,
  ]);
  assert.equal(m.size, 2);
  assert.deepEqual(m.get('a'), { sharedAt: 's', openedAt: 'o', hiddenAt: null, viaLink: true });
  assert.deepEqual(m.get('b'), { sharedAt: null, openedAt: null, hiddenAt: null, viaLink: false });
  assert.equal(sharedMetaMap(null).size, 0);

  const p = patchSharedMeta(m, 'b', { hiddenAt: 'h' });
  assert.notEqual(p, m);
  assert.equal(p.get('b').hiddenAt, 'h');
  assert.equal(m.get('b').hiddenAt, null, 'the original is untouched');
  assert.equal(patchSharedMeta(m, 'z', { openedAt: 'o' }).get('z').openedAt, 'o');
  assert.equal(patchSharedMeta(null, 'z', { openedAt: 'o' }).size, 1);
  assert.equal(patchSharedMeta(m, '', { openedAt: 'o' }).size, 2);
});

test('isNewShare / isHiddenShare', () => {
  assert.equal(isNewShare({ openedAt: null, hiddenAt: null }), true);
  assert.equal(isNewShare({ openedAt: 'o', hiddenAt: null }), false);
  assert.equal(isNewShare({ openedAt: null, hiddenAt: 'h' }), false);
  assert.equal(isNewShare(undefined), false);
  assert.equal(isHiddenShare({ hiddenAt: 'h' }), true);
  assert.equal(isHiddenShare({ hiddenAt: null }), false);
  assert.equal(isHiddenShare(undefined), false);
});

test('visibleSharedRoots: newest share first, name breaks a tie, hidden dropped', () => {
  const roots = [
    root('a', 'Beta', '2026-01-01'),
    root('b', 'Alpha', '2026-01-01'),
    root('c', 'Gamma', '2026-01-01'),
    root('d', 'Delta', '2026-01-01'),
  ];
  const meta = sharedMetaMap([
    { board_id: 'c', shared_at: '2026-03-01T00:00:00Z' },
    { board_id: 'd', shared_at: '2026-02-01T00:00:00Z', hidden_at: '2026-02-02T00:00:00Z' },
  ]);
  assert.equal(ids(visibleSharedRoots(roots, meta)), 'c,b,a');
  // no meta: created_at is the fallback
  assert.equal(ids(visibleSharedRoots([root('x', 'X', '2026-01-01'), root('y', 'Y', '2026-02-01')], null)), 'y,x');
  assert.deepEqual(visibleSharedRoots(null, null), []);
  assert.equal(ids(visibleSharedRoots([null, { board_name: 'no id' }, root('a', 'A', '2026-01-01')], new Map())), 'a');
});

test('sidebarSharedRoots: cap, the open root appended, total', () => {
  assert.equal(SIDEBAR_SHARED_CAP, 5);
  const roots = Array.from({ length: 8 }, (_, i) => root('r' + i, 'R' + i, `2026-01-0${i + 1}`));
  let r = sidebarSharedRoots(roots, null);
  assert.equal(ids(r.rows), 'r7,r6,r5,r4,r3');
  assert.equal(r.total, 8);
  r = sidebarSharedRoots(roots, null, { activeRootId: 'r0' });
  assert.equal(ids(r.rows), 'r7,r6,r5,r4,r3,r0');
  r = sidebarSharedRoots(roots, null, { activeRootId: 'r6' });
  assert.equal(ids(r.rows), 'r7,r6,r5,r4,r3');
  r = sidebarSharedRoots(roots, null, { activeRootId: 'gone' });
  assert.equal(r.rows.length, 5);
  r = sidebarSharedRoots(roots, null, { cap: 2 });
  assert.equal(ids(r.rows), 'r7,r6');
  // a hidden root is neither shown nor counted, nor appended as the open one
  const meta = sharedMetaMap([{ board_id: 'r0', hidden_at: '2026-05-01' }]);
  r = sidebarSharedRoots(roots, meta, { activeRootId: 'r0' });
  assert.equal(r.total, 7);
  assert.ok(!r.rows.some((x) => x.board_id === 'r0'));
});

test('newSharedCount', () => {
  const roots = [root('a', 'A', 0), root('b', 'B', 0), root('c', 'C', 0), root('d', 'D', 0)];
  const meta = sharedMetaMap([
    { board_id: 'a' },
    { board_id: 'b', opened_at: 'o' },
    { board_id: 'c', hidden_at: 'h' },
  ]);
  assert.equal(newSharedCount(roots, meta), 1);   // d has no meta: not new
  assert.equal(newSharedCount(roots, null), 0);
  assert.equal(newSharedCount(null, meta), 0);
});

test('sharedRootOf / sharedPathOf', () => {
  const boards = {
    mine: { id: 'mine' },
    root: { _shared: true, _sharedRoot: true, parent_board_id: 'elsewhere' },
    kid: { _shared: true, parent_board_id: 'root' },
    grand: { _shared: true, parent_board_id: 'kid' },
    orphan: { _shared: true, parent_board_id: 'missing' },
  };
  assert.equal(sharedRootOf(boards, 'root'), 'root');
  assert.equal(sharedRootOf(boards, 'grand'), 'root');
  assert.equal(sharedRootOf(boards, 'mine'), null);
  assert.equal(sharedRootOf(boards, 'orphan'), null);
  assert.equal(sharedRootOf(boards, 'nope'), null);
  assert.equal(sharedRootOf(null, 'root'), null);
  assert.deepEqual(sharedPathOf(boards, 'grand'), ['root', 'kid', 'grand']);
  assert.deepEqual(sharedPathOf(boards, 'root'), ['root']);
  assert.deepEqual(sharedPathOf(boards, 'mine'), ['mine']);
  assert.deepEqual(sharedPathOf(boards, 'orphan'), ['orphan']);
  assert.deepEqual(sharedPathOf(boards, null), []);
  // a cycle ends instead of looping
  const loop = { a: { _shared: true, parent_board_id: 'b' }, b: { _shared: true, parent_board_id: 'a' } };
  assert.equal(sharedRootOf(loop, 'a'), null);
});

test('sharedChildrenMap: by name, Day 2 before Day 10; roots are nobody\'s child', () => {
  const kid = (id, name, parent) => ({ board_id: id, board_name: name, parent_board_id: parent, is_shared_root: false });
  const m = sharedChildrenMap([
    kid('k10', 'Day 10', 'p'), kid('k2', 'Day 2', 'p'), kid('k1', 'Day 1', 'p'), kid('o', 'Other', 'q'),
    root('r', 'Root', 0, { parent_board_id: 'p' }),
    kid('np', 'No parent', null),
    null,
  ]);
  assert.equal(ids(m.get('p')), 'k1,k2,k10');
  assert.equal(ids(m.get('q')), 'o');
  assert.equal(m.size, 2);
  assert.equal(sharedChildrenMap(null).size, 0);
});

test('withYouItems', () => {
  const clusters = [
    root('c1', 'Film', '2026-01-02T00:00:00Z', {
      shared_by: 'u1', shared_by_name: ' Ana Gil ', shared_by_color: '#aabbcc',
      source_workspace_id: 'w1', source_workspace_name: 'Studio', role: 'editor',
    }),
    root('c2', 'Hidden one', '2026-01-01T00:00:00Z'),
    root('c3', 'Bad colour', '2026-01-03T00:00:00Z', { shared_by_color: 'red', shared_by_name: '  ' }),
  ];
  const meta = sharedMetaMap([
    { board_id: 'c1', shared_at: '2026-02-01T00:00:00Z', via_link: true, opened_at: '2026-02-02T00:00:00Z' },
    { board_id: 'c2', hidden_at: '2026-01-05' },
  ]);
  const files = [
    { token: 't1', name: 'Plan.pdf', shared_by: { name: 'Ana Gil', avatar_url: 'http://x/a.png' }, shared_at: '2026-04-01T00:00:00Z', unread: true, access: 'view' },
    { token: 't2', name: 'Link.pdf', source: 'link', shared_by: { name: 'Hidden' }, opened_at: '2026-04-02T00:00:00Z' },
    { token: 't3', shared_by: {} },
    { name: 'no token' },
  ];
  const items = withYouItems({ clusters, files, meta });
  assert.deepEqual(items.map((i) => i.id), ['c1', 'c3', 't1', 't2', 't3']);
  const [c1, c3, t1, t2, t3] = items;
  assert.equal(c1.type, 'cluster');
  assert.equal(c1.personName, 'Ana Gil');
  assert.equal(c1.personColor, '#aabbcc');
  assert.equal(c1.viaLink, true);
  assert.equal(c1.isNew, false);   // opened
  assert.equal(c1.at, Date.parse('2026-02-01T00:00:00Z'));
  assert.equal(c1.workspaceName, 'Studio');
  assert.equal(c3.personName, null);
  assert.equal(c3.personColor, null);
  assert.equal(c3.at, Date.parse('2026-01-03T00:00:00Z'));
  assert.equal(c3.isNew, false);   // no meta row: not new
  assert.equal(t1.type, 'file');
  assert.equal(t1.personName, 'Ana Gil');
  assert.equal(t1.avatarUrl, 'http://x/a.png');
  assert.equal(t1.isNew, true);
  assert.equal(t2.viaLink, true);
  assert.equal(t2.personName, null, 'a link file has no sharer');
  assert.equal(t2.at, Date.parse('2026-04-02T00:00:00Z'));
  assert.equal(t3.name, '');
  assert.equal(t3.personName, null);
  assert.equal(t3.at, 0);
  assert.deepEqual(withYouItems(), []);
});

const cl = (id, personId, personName, at, extra = {}) => ({ type: 'cluster', id, name: id, personId, personName, personColor: null, avatarUrl: null, viaLink: false, workspaceId: 'w', workspaceName: 'WS', at, ...extra });
const fl = (id, personName, at, extra = {}) => ({ type: 'file', id, name: id, personId: null, personName, personColor: null, avatarUrl: null, viaLink: false, workspaceId: null, workspaceName: null, at, ...extra });

test('groupWithYou: a person is one group across clusters and files', () => {
  const groups = groupWithYou([
    cl('c1', 'u1', 'José Ruiz', 100),
    cl('c2', 'u1', 'José Ruiz', 300),
    fl('f1', 'jose ruiz', 200),
    fl('f2', 'Jose Ruiz', 50),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, 'p:u1');
  assert.equal(groups[0].kind, 'person');
  assert.deepEqual(groups[0].items.map((i) => i.id), ['c2', 'f1', 'c1', 'f2']);
  assert.equal(groups[0].newest, 300);
});

test('groupWithYou: links, unknown, workspace and the nameless sharer', () => {
  const groups = groupWithYou([
    fl('l1', null, 400, { viaLink: true }),
    fl('n1', NAMELESS_SHARER, 350),
    fl('n2', NAMELESS_SHARER, 340),
    fl('u1', null, 330),
    cl('c1', null, null, 500),
    cl('c2', null, null, 10, { workspaceId: 'w2', workspaceName: 'Other' }),
    fl('p1', 'Sam', 360),
    fl('p2', 'Sam', 100),
  ]);
  assert.deepEqual(groups.map((g) => g.key), ['w:w', 'links', 'n:sam', 'unknown', 'w:w2']);
  assert.deepEqual(groups.map((g) => g.kind), ['workspace', 'links', 'person', 'unknown', 'workspace']);
  const unknown = groups.find((g) => g.kind === 'unknown');
  assert.equal(unknown.items.length, 3, 'Someone on Clusters files stay together under unknown');
  assert.ok(unknown.items.every((i) => i.personName === null));
  assert.equal(groups.find((g) => g.key === 'w:w').workspaceName, 'WS');
});

test('groupWithYou: "Someone on Clusters" never joins a person, even a cluster\'s sharer of that name', () => {
  const groups = groupWithYou([cl('c1', 'u1', NAMELESS_SHARER, 1), fl('f1', NAMELESS_SHARER, 2)]);
  assert.deepEqual(groups.map((g) => g.key).sort(), ['p:u1', 'unknown']);
});

test('groupWithYou: groups ordered by newest item, then name', () => {
  const groups = groupWithYou([
    cl('a', 'u1', 'Zed', 10), cl('b', 'u2', 'Amy', 10), cl('c', 'u3', 'Mo', 99),
  ]);
  assert.deepEqual(groups.map((g) => g.personName), ['Mo', 'Amy', 'Zed']);
  assert.deepEqual(groupWithYou(null), []);
});

test('byYouItems', () => {
  const clusters = [
    { board_id: 'a', board_name: 'Old', last_shared_at: '2026-01-01T00:00:00Z', link_on: false,
      people: [{ user_id: 'u1', name: ' Ana ', color: '#112233', role: 'editor' }, { user_id: 'u2', name: '', color: 'nope' }], people_count: 12, workspace_id: 'w', workspace_name: 'WS' },
    { board_id: 'b', board_name: 'New', last_shared_at: '2026-03-01T00:00:00Z', link_on: true, board_cover: 'warm' },
    null,
  ];
  const files = [
    { token: 't1', name: 'Off', link_access: 'none', updated_at: '2026-02-01T00:00:00Z', people_count: 2, board_name: 'Film' },
    { token: 't2', name: 'On', link_access: 'view', updated_at: '2026-04-01T00:00:00Z' },
    { name: 'no token' },
  ];
  const items = byYouItems({ clusters, files });
  assert.deepEqual(items.map((i) => i.id), ['t2', 'b', 't1', 'a']);
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId.a.peopleCount, 12);
  assert.deepEqual(byId.a.people, [
    { userId: 'u1', name: 'Ana', color: '#112233', role: 'editor' },
    { userId: 'u2', name: null, color: null, role: null },
  ]);
  assert.equal(byId.a.linkOn, false);
  assert.equal(byId.a.cover, 'neutral');
  assert.equal(byId.b.linkOn, true);
  assert.equal(byId.b.cover, 'warm');
  assert.equal(byId.b.peopleCount, 0);
  assert.equal(byId.t1.linkOn, false);
  assert.equal(byId.t2.linkOn, true);
  assert.equal(byId.t1.boardName, 'Film');
  assert.deepEqual(byYouItems(), []);
});

test('filterGroups: AND of words, accents, a person matches all their items, empties dropped', () => {
  const groups = groupWithYou([
    cl('Film plan', 'u1', 'José Ruiz', 3),
    cl('Budget', 'u1', 'José Ruiz', 2),
    cl('Film plan', 'u2', 'Amy Lee', 1, { workspaceName: 'Studio' }),
  ]);
  const names = (g) => g.map((x) => x.items.map((i) => i.name).join('+')).join('|');
  assert.equal(countItems(filterGroups(groups, '')), 3);
  assert.equal(countItems(filterGroups(groups, '  ')), 3);
  assert.equal(names(filterGroups(groups, 'film')), 'Film plan|Film plan');
  assert.equal(names(filterGroups(groups, 'film jose')), 'Film plan');
  assert.equal(names(filterGroups(groups, 'JOSE')), 'Film plan+Budget', 'the person\'s name matches all their items, folding accents and case');
  assert.equal(filterGroups(groups, 'zzz').length, 0);
  assert.equal(filterGroups(groups, 'studio').length, 1, 'the workspace is searched too');
  // words the row shows, for a kind label
  const shown = (it) => (it.name === 'Budget' ? ['Cluster'] : []);
  assert.equal(countItems(filterGroups(groups, 'cluster', shown)), 1);
  assert.equal(countItems(groups), 3);
  assert.equal(countItems(null), 0);
});

test('itemFindFields lists the item, its people, where it lives and the shown words', () => {
  assert.deepEqual(
    itemFindFields({ name: 'N', personName: 'P', people: [{ name: 'Q' }], workspaceName: 'W', boardName: 'B' }, ['S']),
    ['N', 'P', 'Q', 'W', 'B', 'S'],
  );
});

test('itemHitKind: person only when just the person matched', () => {
  const it = { name: 'Film plan', personName: 'Ana Gil', workspaceName: 'Studio', people: [] };
  assert.equal(itemHitKind('film', it), 'name');
  assert.equal(itemHitKind('studio', it), 'name');
  assert.equal(itemHitKind('ana', it), 'person');
  assert.equal(itemHitKind('film ana', it), 'person');
  assert.equal(itemHitKind('zzz', it), 'name', 'no match falls back to name');
  const mine = { name: 'Reel', people: [{ name: 'Bo Chen' }] };
  assert.equal(itemHitKind('chen', mine), 'person');
  assert.equal(itemHitKind('reel', mine), 'name');
});
