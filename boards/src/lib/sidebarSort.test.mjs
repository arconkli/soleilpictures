import test from 'node:test';
import assert from 'node:assert/strict';
import { SORTS, DEFAULT_SORT, compareItems, sortItems, groupItems, filterItems } from './sidebarSort.js';

const it = (cardId, o = {}) => ({
  key: `b:${cardId}`, boardId: 'b', cardId, kind: 'image', shelf: 'photos', name: o.title ?? '',
  title: o.title ?? '', snippet: '', meta: {}, createdAt: null, updatedAt: null,
  unplaced: false, sizeBytes: null, seq: null, ...o,
});
const ids = (xs) => xs.map((x) => x.cardId);

test('constants', () => {
  assert.deepEqual(SORTS, ['newest', 'name', 'size', 'canvas']);
  assert.equal(DEFAULT_SORT, 'newest');
});

test('newest: createdAt desc, nulls last, cardId asc tiebreak', () => {
  const xs = [it('b', { createdAt: 5 }), it('n'), it('a', { createdAt: 5 }), it('z', { createdAt: 9 })];
  assert.deepEqual(ids(sortItems(xs, 'newest')), ['z', 'a', 'b', 'n']);
  assert.deepEqual(ids(sortItems(xs, 'bogus')), ['z', 'a', 'b', 'n']);
});

test('name: natural, case-insensitive, empty last, ties by createdAt desc', () => {
  const xs = [
    it('1', { title: 'img10' }), it('2', { title: 'IMG2' }), it('3', { title: '' }),
    it('4', { title: 'img2', createdAt: 1 }), it('5', { title: 'img2', createdAt: 8 }),
  ];
  assert.deepEqual(ids(sortItems(xs, 'name')), ['5', '4', '2', '1', '3']);
});

test('size: desc, nulls last, tiebreaks', () => {
  const xs = [it('a'), it('b', { sizeBytes: 10, createdAt: 1 }), it('c', { sizeBytes: 10, createdAt: 2 }), it('d', { sizeBytes: 50 })];
  assert.deepEqual(ids(sortItems(xs, 'size')), ['d', 'c', 'b', 'a']);
});

test('canvas: y then x, nulls last', () => {
  const p = (x, y) => ({ meta: { pos: { x, y, w: 1, h: 1 } } });
  const xs = [it('none'), it('a', p(5, 2)), it('b', p(1, 2)), it('c', p(9, 1)), it('d', { meta: { pos: { x: 1 } } })];
  assert.deepEqual(ids(sortItems(xs, 'canvas')), ['c', 'b', 'a', 'd', 'none']);
});

test('sortItems returns a new array', () => {
  const xs = [it('b'), it('a')];
  const out = sortItems(xs, 'newest');
  assert.notEqual(out, xs);
  assert.deepEqual(ids(xs), ['b', 'a']);
  assert.equal(typeof compareItems('name'), 'function');
});

test('groupItems by type', () => {
  const xs = [it('1', { shelf: 'writing', kind: 'note' }), it('2'), it('3', { shelf: 'writing', kind: 'note' })];
  const g = groupItems(xs, {});
  assert.deepEqual(g.map((s) => [s.id, s.label, s.layout, ids(s.items)]), [
    ['photos', 'Photos', 'mosaic', ['2']], ['writing', 'Writing', 'rows', ['1', '3']],
  ]);
});

test('groupItems by canvas, with ungrouped fallback', () => {
  const xs = [
    it('1', { meta: { groupId: 'g2', groupName: 'Beta' } }),
    it('2', { meta: { groupId: 'g1', groupName: 'alpha' } }),
    it('3', { shelf: 'writing', kind: 'note', meta: { groupId: 'g1', groupName: 'alpha' } }),
    it('4', { meta: { groupId: 'g3' } }),
    it('5', { shelf: 'links', kind: 'link' }),
    it('6'),
  ];
  const g = groupItems(xs, { groupBy: 'canvas' });
  assert.deepEqual(g.map((s) => [s.id, s.label, s.layout]), [
    ['group:g1', 'alpha', 'rows'], ['group:g2', 'Beta', 'mosaic'], ['group:g3', 'Untitled group', 'mosaic'],
    ['photos', 'Photos', 'mosaic'], ['links', 'Links', 'fold'],
  ]);
  assert.deepEqual(ids(g[3].items), ['6']);
  assert.deepEqual(groupItems([it('1')], { groupBy: 'canvas' }).map((s) => s.id), ['photos']);
});

test('filterItems', () => {
  const xs = [
    it('1', { name: 'Sunset', unplaced: true }),
    it('2', { name: 'x', snippet: 'about SUNSET here', shelf: 'writing' }),
    it('3', { name: 'y', meta: { fileName: 'sunset.png' }, shelf: 'files' }),
    it('4', { name: 'other' }),
  ];
  assert.equal(filterItems(xs, {}).length, 4);
  assert.deepEqual(ids(filterItems(xs, { chip: 'unplaced' })), ['1']);
  assert.deepEqual(ids(filterItems(xs, { chip: 'writing' })), ['2']);
  assert.deepEqual(ids(filterItems(xs, { query: '  SunSet ' })), ['1', '2', '3']);
  assert.deepEqual(ids(filterItems(xs, { chip: 'files', query: 'sun' })), ['3']);
});
