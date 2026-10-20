import test from 'node:test';
import assert from 'node:assert/strict';
import { clustersInTreeOrder, findClusters, plainText, sortSiblings } from './clusterSwitchList.js';

const b = (id, name, parent, created, updated = null) => ({
  id, name, parent_board_id: parent, created_at: created, updated_at: updated || created,
});
// The root's projects: Music video was made first, Feature film was worked on
// last. Inside Feature film: Locations, then Casting, then Shot list, by when
// they were made (not by name).
const LIST = [
  b('root', 'Studio', null, '2026-01-01T00:00:00Z'),
  b('mv', 'Music video', 'root', '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z'),
  b('film', 'Feature film', 'root', '2026-02-02T00:00:00Z', '2026-10-19T00:00:00Z'),
  b('cast', 'Casting', 'film', '2026-02-04T00:00:00Z'),
  b('loc', 'Locations', 'film', '2026-02-03T00:00:00Z'),
  b('shots', 'Shot list', 'film', '2026-02-05T00:00:00Z'),
  b('key', 'Key art', 'root', '2026-02-06T00:00:00Z', '2026-04-01T00:00:00Z'),
];
const names = (rows) => rows.map((r) => `${'  '.repeat(r.depth)}${r.board.name}`);

test('the list keeps the tree’s order: projects by recent work, inside them by when they were made', () => {
  assert.deepEqual(names(clustersInTreeOrder(LIST, 'root')), [
    'Studio',
    '  Feature film',
    '    Locations',
    '    Casting',
    '    Shot list',
    '  Key art',
    '  Music video',
  ]);
});

test('sortSiblings is the tree’s own sort', () => {
  const kids = LIST.filter((x) => x.parent_board_id === 'root');
  assert.deepEqual(sortSiblings([...kids], 'root', 'root').map((x) => x.id), ['film', 'key', 'mv']);
  const film = LIST.filter((x) => x.parent_board_id === 'film');
  assert.deepEqual(sortSiblings([...film], 'film', 'root').map((x) => x.id), ['loc', 'cast', 'shots']);
});

test('a cluster cut off from the root still shows, and a loop can’t hang it', () => {
  const stray = [...LIST, b('lost', 'Lost', null, '2026-05-01T00:00:00Z'), b('x', 'X', 'y', '2026-05-02T00:00:00Z'), b('y', 'Y', 'x', '2026-05-03T00:00:00Z')];
  const rows = clustersInTreeOrder(stray, 'root');
  assert.equal(rows[0].board.id, 'root');
  assert.ok(rows.some((r) => r.board.id === 'lost'));
  assert.equal(rows.filter((r) => r.board.id === 'x').length, 0, 'x and y have no way in from the top');
  assert.deepEqual(clustersInTreeOrder(null, 'root'), []);
});

test('finding: flat, names that start with it first, each with the cluster it’s in and where the match is', () => {
  const rows = clustersInTreeOrder(LIST, 'root');
  const found = findClusters(rows, 'ca');
  assert.deepEqual(found.map((r) => r.board.name), ['Casting', 'Locations']);
  assert.ok(found.every((r) => r.depth === 0));
  assert.deepEqual(found.map((r) => r.parentName), ['Feature film', 'Feature film']);
  assert.deepEqual(found.map((r) => r.hit), [{ at: 0, length: 2 }, { at: 2, length: 2 }]);
  assert.equal(findClusters(rows, '  '), rows, 'nothing typed: the whole list');
  assert.deepEqual(findClusters(rows, 'zzz'), []);
});

test('finding ignores accents and case', () => {
  const rows = clustersInTreeOrder([...LIST, b('cafe', 'Café scenes', 'film', '2026-03-01T00:00:00Z')], 'root');
  assert.deepEqual(findClusters(rows, 'CAFE').map((r) => r.board.name), ['Café scenes']);
  assert.deepEqual(findClusters(rows, 'café').map((r) => r.hit), [{ at: 0, length: 4 }]);
  assert.equal(plainText('Éclair'), 'eclair');
});

test('a name whose letters came apart is found, without a mark it can’t place', () => {
  const decomposed = 'Café';
  const rows = clustersInTreeOrder([...LIST, b('d', decomposed, 'film', '2026-03-02T00:00:00Z')], 'root');
  const found = findClusters(rows, 'cafe');
  assert.equal(found.length, 1);
  assert.equal(found[0].hit, null);
});
