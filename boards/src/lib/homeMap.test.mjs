import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clusterName, starLabels, findClusters, labelRank, visibleLabels,
  cardPlacement, viewOffset, workspaceLine,
} from './homeMap.js';

const WS = 'ws1';
const boards = {
  root: { id: 'root', name: 'Studio', parent_board_id: null, workspace_id: WS },
  film: { id: 'film', name: 'Feature film', parent_board_id: 'root', workspace_id: WS },
  cast: { id: 'cast', name: 'Casting', parent_board_id: 'film', workspace_id: WS },
  cafe: { id: 'cafe', name: 'Café scenes', parent_board_id: 'root', workspace_id: WS },
  short: { id: 'short', name: 'Short film', parent_board_id: 'root', workspace_id: WS },
  blank: { id: 'blank', name: 'Untitled cluster', parent_board_id: 'root', workspace_id: WS },
  gone: { id: 'gone', name: 'Deleted', parent_board_id: 'root', workspace_id: WS, deleted_at: '2026-10-01' },
  lost: { id: 'lost', name: 'Orphan', parent_board_id: 'nowhere', workspace_id: WS },
  theirs: { id: 'theirs', name: 'Shared in', parent_board_id: 'root', workspace_id: 'other' },
  mirror: { id: 'mirror', name: 'Mirror', parent_board_id: 'root', workspace_id: WS, _shared: true },
};

test('clusterName: trims, and an empty or default name reads Untitled cluster', () => {
  assert.equal(clusterName({ name: '  Feature film ' }), 'Feature film');
  assert.equal(clusterName({ name: '' }), 'Untitled cluster');
  assert.equal(clusterName({ name: 'Untitled list' }), 'Untitled cluster');
  assert.equal(clusterName(null), 'Untitled cluster');
});

test('starLabels: every live cluster of the workspace, as root, top or nested, on the universe\'s ids', () => {
  const labels = starLabels(boards, 'root', { workspaceId: WS });
  const byId = Object.fromEntries(labels.map((l) => [l.boardId, l]));
  assert.deepEqual(Object.keys(byId).sort(), ['blank', 'cafe', 'cast', 'film', 'root', 'short']);
  assert.equal(byId.root.kind, 'root');
  assert.equal(byId.film.kind, 'top');
  assert.equal(byId.cast.kind, 'nested');
  assert.equal(byId.cast.parentId, 'film');
  assert.equal(byId.film.id, 'board:film');
  assert.equal(byId.blank.name, 'Untitled cluster');
  assert.deepEqual(starLabels(null, 'root'), []);
  assert.deepEqual(starLabels(boards, null), []);
});

test('findClusters: accent and case blind, names that start with it first, empty finds nothing', () => {
  const labels = starLabels(boards, 'root', { workspaceId: WS });
  assert.deepEqual(findClusters(labels, ''), []);
  assert.deepEqual(findClusters(labels, '   '), []);
  assert.deepEqual(findClusters(labels, 'CAFE'), ['cafe']);
  const film = findClusters(labels, 'film');
  assert.deepEqual(film.slice().sort(), ['film', 'short']);
  // "f" starts Feature film only; Café holds an f too, after it.
  const f = findClusters(labels, 'f');
  assert.equal(f[0], 'film');
  assert.ok(f.includes('cafe') && f.includes('short'));
  assert.ok(f.indexOf('film') < f.indexOf('cafe'));
});

test('labelRank: picked, then pointed at, then found, then root, top, nested', () => {
  const r = (o) => labelRank({ kind: 'nested', ...o });
  assert.ok(r({ selected: true }) < r({ hover: true }));
  assert.ok(r({ hover: true }) < r({ hit: true }));
  assert.ok(r({ hit: true }) < labelRank({ kind: 'root' }));
  assert.ok(labelRank({ kind: 'root' }) < labelRank({ kind: 'top' }));
  assert.ok(labelRank({ kind: 'top' }) < labelRank({ kind: 'nested' }));
});

test('visibleLabels: the lower rank keeps its place, an overlapping one hides, off the area hides', () => {
  const items = [
    { id: 'a', x: 100, y: 100, w: 80, h: 14, rank: 4 },
    { id: 'b', x: 150, y: 104, w: 80, h: 14, rank: 5 },  // covers a, ranks lower: hidden
    { id: 'c', x: 150, y: 104, w: 80, h: 14, rank: 1 },  // covers a, ranks higher: shown, a hides
    { id: 'd', x: 400, y: 300, w: 60, h: 14, rank: 4 },
    { id: 'e', x: 10, y: 300, w: 60, h: 14, rank: 4 },   // left of the area
  ];
  const shown = visibleLabels(items, { left: 50, right: 1000, top: 0, bottom: 800 });
  assert.deepEqual([...shown].sort(), ['c', 'd']);
  assert.deepEqual([...visibleLabels([])], []);
});

test('cardPlacement: right of the star when it fits, else left; centred on it and kept inside', () => {
  const area = { left: 330, top: 52, right: 1440, bottom: 830 };
  const card = { w: 336, h: 340 };
  const right = cardPlacement({ x: 700, y: 450 }, card, area);
  assert.deepEqual(right, { left: 730, top: 280, side: 'right' });
  const left = cardPlacement({ x: 1300, y: 450 }, card, area);
  assert.equal(left.side, 'left');
  assert.equal(left.left, 1300 - 30 - 336);
  const high = cardPlacement({ x: 700, y: 60 }, card, area);
  assert.equal(high.top, 52);
  const low = cardPlacement({ x: 700, y: 820 }, card, area);
  assert.equal(low.top, 830 - 340);
  // No room either side: on the right, held inside the area.
  const tight = cardPlacement({ x: 500, y: 450 }, card, { left: 330, top: 0, right: 760, bottom: 900 });
  assert.equal(tight.side, 'right');
  assert.equal(tight.left, 760 - 336);
});

test('viewOffset: half the difference of the insets, so the open area is the centre', () => {
  assert.deepEqual(viewOffset({ left: 330, right: 0, top: 52, bottom: 80 }), { x: -165, y: 14 });
  assert.deepEqual(viewOffset({}), { x: 0, y: 0 });
  assert.deepEqual(viewOffset(null), { x: 0, y: 0 });
});

test('workspaceLine: whose it is, how many people (not when it is only you), when it last changed', () => {
  const ws = { id: 'w', created_by: 'me' };
  assert.equal(workspaceLine({ workspace: ws, selfUserId: 'me', memberCount: 4, when: '2h ago' }),
    'Your workspace · 4 people · updated 2h ago');
  assert.equal(workspaceLine({ workspace: ws, personalWorkspaceId: 'w', selfUserId: 'me', memberCount: 1, when: 'Just now' }),
    'Your personal workspace · updated just now');
  assert.equal(workspaceLine({ workspace: { id: 'w', created_by: 'x', _myRole: 'coowner' }, selfUserId: 'me', memberCount: 3 }),
    'You co-own this · 3 people');
  assert.equal(workspaceLine({ workspace: { id: 'w', created_by: 'x' }, selfUserId: 'me' }), 'Shared with you');
  assert.equal(workspaceLine({}), '');
});
