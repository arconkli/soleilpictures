import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SORT_TO_PAGE, sidebarSortOf, sortLabelOf, chipToFilter, filterToChip, chipCountsOf, pageChipsOf,
  chipLabelOf, sectionsOf, shelfClosed, shelfFoldable, screenOrderOf, navStep,
} from './filesView.js';
import { SORTS } from './sidebarSort.js';
import { FILTER_CHIPS, SHELF_BUCKETS } from './sidebarShelves.js';

const it = (id, kind, extra = {}) => ({ id, kind, name: id, ...extra });
const ids = (xs) => xs.map((x) => x.id);

test('every sidebar sort has a page sort, and maps back', () => {
  for (const s of SORTS) {
    const p = SORT_TO_PAGE[s];
    assert.ok(p, s);
    assert.equal(sidebarSortOf(p.key, p.dir), s);
  }
  assert.equal(sidebarSortOf('type', 'asc'), null);
  assert.equal(sidebarSortOf('name', 'desc'), null);
});

test('a sort the menu has no item for says what its column says', () => {
  assert.equal(sortLabelOf('created', 'desc'), 'Newest first');
  assert.equal(sortLabelOf('board', 'asc'), 'Canvas order');
  assert.equal(sortLabelOf('type', 'asc'), 'Kind ↑');
  assert.equal(sortLabelOf('updated', 'desc'), 'Modified ↓');
  assert.equal(sortLabelOf('bpm', 'asc'), 'Tempo ↑');
});

test('chips and the page filter map both ways', () => {
  for (const c of FILTER_CHIPS) {
    const f = chipToFilter(c.id);
    assert.equal(filterToChip(f.buckets, f.unplacedOnly), c.id, c.id);
  }
  assert.deepEqual(chipToFilter('more'), { buckets: [...SHELF_BUCKETS.more], unplacedOnly: false });
  assert.equal(filterToChip(SHELF_BUCKETS.more, false), 'more');
  assert.equal(filterToChip(new Set(['file', 'doc', 'pdf']), false), 'files');
  assert.equal(filterToChip(['image', 'pdf'], false), null);
  assert.equal(filterToChip(['image'], true), null);
});

test('chip counts follow the shelves; Not on board only where placement shows', () => {
  const items = [it('a', 'image', { unplaced: true }), it('b', 'image'), it('c', 'pdf'), it('d', 'grid', { unplaced: true }), it('e', 'note')];
  assert.deepEqual(chipCountsOf(items), { all: 5, unplaced: 2, photos: 2, files: 1, more: 1, writing: 1 });
  assert.equal(chipCountsOf(items, { placement: false }).unplaced, 0);
});

test('the menu offers chips with something behind them, and the one in force', () => {
  assert.deepEqual(ids(pageChipsOf({ all: 3, photos: 2, files: 1, unplaced: 0 }, 'all')), ['all', 'photos', 'files']);
  assert.deepEqual(ids(pageChipsOf({ all: 3, photos: 3 }, 'video')), ['all', 'photos', 'video']);
  assert.deepEqual(ids(pageChipsOf({ all: 2, more: 2, unplaced: 1 }, 'more')), ['all', 'more', 'unplaced']);
  assert.equal(chipLabelOf('all'), 'All files');
  assert.equal(chipLabelOf('writing'), 'Notes');
  assert.equal(chipLabelOf('more'), 'Other');
  assert.equal(chipLabelOf(null), 'Filtered');
});

test('sections: the card shelves in order, photos and video as a grid, families on Other', () => {
  const fam = { id: 'grp:t', isGroup: true, count: 3, members: [it('g1', 'grid'), it('g2', 'grid'), it('g3', 'grid')] };
  const s = sectionsOf([it('n', 'note'), it('v', 'video'), fam, it('p', 'image'), it('f', 'pdf'), it('l', 'link')]);
  assert.deepEqual(ids(s), ['photos', 'video', 'files', 'writing', 'links', 'more']);
  assert.deepEqual(s.map((x) => x.layout), ['grid', 'grid', 'rows', 'rows', 'rows', 'rows']);
  assert.deepEqual(s.map((x) => x.minor), [false, false, false, true, true, true]);
  assert.deepEqual(s.map((x) => x.label), ['Photos', 'Video', 'Files', 'Notes', 'Links', 'Other']);
  assert.equal(s.find((x) => x.id === 'more').count, 3);
  assert.deepEqual(sectionsOf([]), []);
});

test('a minor shelf starts closed until opened, searched or filtered to', () => {
  const [notes] = sectionsOf([it('n', 'note')]);
  const [photos] = sectionsOf([it('p', 'image')]);
  assert.equal(shelfClosed(photos), false);
  assert.equal(shelfClosed(notes), true);
  assert.equal(shelfClosed(notes, { opened: new Set(['writing']) }), false);
  assert.equal(shelfClosed(notes, { query: 'x' }), false);
  assert.equal(shelfClosed(notes, { chip: 'unplaced' }), false);
  assert.equal(shelfFoldable(notes), true);
  assert.equal(shelfFoldable(notes, { query: 'x' }), false);
  assert.equal(shelfFoldable(photos), false);
});

test('screen order: shelf by shelf, closed ones skipped, open families inlined', () => {
  const fam = { id: 'grp:t', isGroup: true, count: 2, members: [it('g1', 'grid'), it('g2', 'grid')] };
  const s = sectionsOf([it('p', 'image'), it('n', 'note'), fam]);
  assert.deepEqual(ids(screenOrderOf(s)), ['p', 'n', 'grp:t']);
  assert.deepEqual(ids(screenOrderOf(s, { closed: new Set(['writing']), expandedGroups: new Set(['grp:t']) })), ['p', 'grp:t', 'g1', 'g2']);
});

test('the arrows cross from shelf to shelf', () => {
  // Photos in two rows (a b c / d e), then a shelf of rows (x y).
  const tiles = [
    { row: 0, x: 0, w: 100 }, { row: 0, x: 110, w: 100 }, { row: 0, x: 220, w: 100 },
    { row: 1, x: 0, w: 160 }, { row: 1, x: 170, w: 160 },
  ];
  const parts = [{ layout: 'grid', ids: ['a', 'b', 'c', 'd', 'e'], tiles }, { layout: 'rows', ids: ['x', 'y'] }];
  assert.equal(navStep(parts, null, 'down'), 'a');
  assert.equal(navStep(parts, null, 'up'), 'y');
  assert.equal(navStep(parts, 'a', 'right'), 'b');
  assert.equal(navStep(parts, 'b', 'down'), 'd');
  assert.equal(navStep(parts, 'e', 'right'), 'x');
  assert.equal(navStep(parts, 'd', 'down'), 'x');
  assert.equal(navStep(parts, 'x', 'up'), 'e');
  assert.equal(navStep(parts, 'x', 'left'), 'x');
  assert.equal(navStep(parts, 'x', 'down'), 'y');
  assert.equal(navStep(parts, 'y', 'down'), 'y');
  assert.equal(navStep(parts, 'a', 'up'), 'a');
  assert.equal(navStep([], 'a', 'down'), null);
});
