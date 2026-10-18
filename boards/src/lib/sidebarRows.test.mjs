import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROW_HEIGHTS, PEEK, mosaicPerLine, flattenTree, layoutRows, visibleRange,
} from './sidebarRows.js';

const item = (b, n) => ({ key: `${b}:${n}`, boardId: b, cardId: String(n), kind: 'image', name: `n${n}` });
const photos = (b, n, total = n) => ({
  id: 'photos', label: 'Photos', layout: 'mosaic', items: Array.from({ length: n }, (_, i) => item(b, i)), total,
});
const rowsShelf = (b, id, n, total = n) => ({
  id, label: id, layout: 'rows', items: Array.from({ length: n }, (_, i) => item(b, `${id}${i}`)), total,
});
const fold = (id, n) => ({
  id, label: id, layout: 'fold', items: Array.from({ length: n }, (_, i) => item('A', `${id}${i}`)), total: n,
});

function build(over = {}) {
  return flattenTree({
    rootIds: ['A'],
    childrenOf: () => [],
    isExpanded: () => true,
    contentsOf: () => ({ loading: false, shelves: [] }),
    shelfState: () => ({ open: false, expanded: false }),
    ...over,
  });
}
const types = (rows) => rows.map((r) => r.type);

test('collapsed cluster is one row; heights follow coarse', () => {
  const r = build({ isExpanded: () => false });
  assert.deepEqual(types(r), ['cluster']);
  assert.equal(r[0].height, 34);
  assert.equal(build({ isExpanded: () => false, coarse: true })[0].height, 44);
  assert.equal(ROW_HEIGHTS.fine.mosaic, 46);
});

test('mosaicPerLine', () => {
  assert.equal(mosaicPerLine(300), Math.floor(304 / 44));
  assert.equal(mosaicPerLine(10), 3);
  assert.equal(mosaicPerLine(300, { inset: 40 }), Math.floor(264 / 44));
});

test('loading and empty rows', () => {
  assert.deepEqual(types(build({ contentsOf: () => null })), ['cluster', 'loading']);
  assert.deepEqual(types(build({ contentsOf: () => ({ loading: true, shelves: [] }) })), ['cluster', 'loading']);
  const e = build({ contentsOf: () => ({ loading: false, shelves: [] }) });
  assert.deepEqual(types(e), ['cluster', 'empty']);
  assert.equal(e[1].key, 'e:A');
  assert.equal(e[1].depth, 1);
});

test('12-photo mosaic at 5 per line peeks 2 lines then a more row', () => {
  const r = build({ perLine: 5, contentsOf: () => ({ loading: false, shelves: [photos('A', 12)] }) });
  assert.deepEqual(types(r), ['cluster', 'shelf', 'mosaic', 'mosaic', 'more']);
  assert.equal(r[1].count, 12);
  assert.equal(r[2].items.length, 5);
  assert.equal(r[4].count, 2);
});

test('mosaic with 20 photos: more counts the rest; expanded shows all lines', () => {
  const c = () => ({ loading: false, shelves: [photos('A', 20)] });
  let r = build({ contentsOf: c, perLine: 5 });
  assert.deepEqual(types(r), ['cluster', 'shelf', 'mosaic', 'mosaic', 'more']);
  assert.equal(r[4].count, 10);
  assert.equal(r[4].expanded, false);
  assert.equal(r[3].key, 'm:A:photos:1');
  r = build({ contentsOf: c, perLine: 5, shelfState: () => ({ open: false, expanded: true }) });
  assert.deepEqual(types(r), ['cluster', 'shelf', 'mosaic', 'mosaic', 'mosaic', 'mosaic']);
});

test('12 photos at 6 per line fits the peek exactly: no more row', () => {
  const r = build({ contentsOf: () => ({ loading: false, shelves: [photos('A', 12)] }) });
  assert.deepEqual(types(r), ['cluster', 'shelf', 'mosaic', 'mosaic']);
});

test('12 photos at 4 per line: 3rd line hidden behind more(4)', () => {
  const r = build({ perLine: 4, contentsOf: () => ({ loading: false, shelves: [photos('A', 12)] }) });
  assert.deepEqual(types(r), ['cluster', 'shelf', 'mosaic', 'mosaic', 'more']);
  assert.equal(r[4].count, 4);
});

test('rows shelf peeks 5, server total drives more; expanded loads next page', () => {
  const c = () => ({ loading: false, shelves: [rowsShelf('A', 'video', 8, 40)] });
  let r = build({ contentsOf: c });
  assert.equal(r.filter((x) => x.type === 'file').length, PEEK.rows);
  assert.equal(r.at(-1).count, 35);
  r = build({ contentsOf: c, shelfState: () => ({ open: false, expanded: true }) });
  assert.equal(r.filter((x) => x.type === 'file').length, 8);
  const more = r.at(-1);
  assert.equal(more.type, 'more');
  assert.equal(more.count, 32);
  assert.equal(more.expanded, true);
  assert.equal(r.find((x) => x.type === 'file').key, 'f:A:video0');
});

test('shelves with zero total are skipped', () => {
  const r = build({ contentsOf: () => ({ loading: false, shelves: [rowsShelf('A', 'video', 0), rowsShelf('A', 'audio', 1)] }) });
  assert.deepEqual(types(r), ['cluster', 'shelf', 'file']);
});

test('fold row lists fold shelves in order; open fold shelf shows its rows', () => {
  const shelves = [fold('links', 2), fold('more', 1), fold('other', 0)];
  let r = build({ contentsOf: () => ({ loading: false, shelves }) });
  assert.deepEqual(types(r), ['cluster', 'fold']);
  assert.deepEqual(r[1].parts, [{ shelfId: 'links', count: 2, label: 'links' }, { shelfId: 'more', count: 1, label: 'more' }]);
  assert.equal(r[1].key, 'o:A');
  r = build({
    contentsOf: () => ({ loading: false, shelves }),
    shelfState: (b, s) => ({ open: s === 'links', expanded: false }),
  });
  assert.deepEqual(types(r), ['cluster', 'fold', 'file', 'file']);
  assert.equal(r[2].shelfId, 'links');
});

test('children come before contents, one level deeper', () => {
  const kids = { A: ['B'], B: [] };
  const contents = (id) => ({ loading: false, shelves: [rowsShelf(id, 'files', 1)] });
  const r = build({ childrenOf: (id) => kids[id] || [], contentsOf: contents });
  assert.deepEqual(r.map((x) => x.key), ['c:A', 'c:B', 's:B:files', 'f:B:files0', 's:A:files', 'f:A:files0']);
  assert.deepEqual(r.map((x) => x.depth), [0, 1, 2, 2, 1, 1]);
});

test('a cluster with children but no items is not empty', () => {
  const r = build({ childrenOf: (id) => (id === 'A' ? ['B'] : []), isExpanded: (id) => id === 'A' });
  assert.deepEqual(types(r), ['cluster', 'cluster']);
});

test('cycles do not recurse forever and keys stay unique', () => {
  const kids = { A: ['B'], B: ['A', 'B'] };
  const r = build({ rootIds: ['A', 'B'], childrenOf: (id) => kids[id] || [] });
  assert.equal(r.filter((x) => x.type === 'cluster').length, 2);
  assert.equal(new Set(r.map((x) => x.key)).size, r.length);
});

test('layoutRows offsets and total', () => {
  const l = layoutRows([{ height: 10 }, { height: 20 }, { height: 5 }]);
  assert.deepEqual(l, { offsets: [0, 10, 30], total: 35 });
  assert.deepEqual(layoutRows([]), { offsets: [], total: 0 });
});

test('visibleRange on a 5,000-row list: top, middle, end, empty', () => {
  const layout = layoutRows(Array.from({ length: 5000 }, () => ({ height: 26 })));
  assert.deepEqual(visibleRange(layout, 0, 600), { start: 0, end: Math.ceil(900 / 26) });
  // middle: window [60000-300, 60000+600+300] = [59700, 60900]
  const m = visibleRange(layout, 60000, 600);
  assert.equal(m.start, Math.floor(59700 / 26));
  assert.equal(m.end, Math.ceil(60900 / 26));
  assert.ok(layout.offsets[m.start] <= 59700 && layout.offsets[m.start] + 26 > 59700);
  // end: scrolled to the bottom
  const e = visibleRange(layout, layout.total - 600, 600);
  assert.equal(e.end, 5000);
  assert.equal(e.start, Math.floor((layout.total - 900) / 26));
  assert.deepEqual(visibleRange(layout, layout.total + 5000, 600), { start: 5000, end: 5000 });
  assert.deepEqual(visibleRange(layoutRows([]), 0, 600), { start: 0, end: 0 });
});
