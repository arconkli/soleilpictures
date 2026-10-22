import test from 'node:test';
import assert from 'node:assert/strict';
import { ROW_HEIGHTS, PEEK, flattenTree, layoutRows, visibleRange, contentRows } from './sidebarRows.js';

const item = (b, n) => ({ key: `${b}:${n}`, boardId: b, cardId: String(n), kind: 'image', name: `n${n}` });
const photos = (b, n, total = n) => ({
  id: 'photos', label: 'Photos', layout: 'rows', items: Array.from({ length: n }, (_, i) => item(b, i)), total,
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
  assert.equal(r[0].height, 36);
  assert.equal(build({ isExpanded: () => false, coarse: true })[0].height, 44);
  assert.equal(ROW_HEIGHTS.fine.file, 28);
});

test('loading and empty rows', () => {
  assert.deepEqual(types(build({ contentsOf: () => null })), ['cluster', 'loading']);
  assert.deepEqual(types(build({ contentsOf: () => ({ loading: true, shelves: [] }) })), ['cluster', 'loading']);
  const e = build({ contentsOf: () => ({ loading: false, shelves: [] }) });
  assert.deepEqual(types(e), ['cluster', 'empty']);
  assert.equal(e[1].key, 'e:A');
  assert.equal(e[1].depth, 1);
});

test('photos list as rows, like everything else: 12 peek 5 then Show 7 more; open, all 12', () => {
  const c = () => ({ loading: false, shelves: [photos('A', 12)] });
  let r = build({ contentsOf: c });
  assert.deepEqual(types(r), ['cluster', 'shelf', 'file', 'file', 'file', 'file', 'file', 'more']);
  assert.equal(r[1].count, 12);
  assert.equal(r[2].key, 'f:A:0');
  assert.equal(r.at(-1).count, 7);
  assert.equal(r.at(-1).expanded, false);
  r = build({ contentsOf: c, shelfState: () => ({ open: false, expanded: true }) });
  assert.equal(r.filter((x) => x.type === 'file').length, 12);
  assert.equal(r.at(-1).count, 0, 'all shown: the row only offers Show less');
  assert.equal(r.at(-1).expanded, true);
});

test('a search that only matched the cluster name shows no "nothing here" row', () => {
  const r = contentRows('F', 1, { contents: { loading: false, shelves: [], searching: true } });
  assert.deepEqual(r, []);
});

test('5 photos fit the peek exactly: no more row', () => {
  const r = build({ contentsOf: () => ({ loading: false, shelves: [photos('A', 5)] }) });
  assert.deepEqual(types(r), ['cluster', 'shelf', 'file', 'file', 'file', 'file', 'file']);
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

test('under files, the rest is one closed header a kind, each opening on its own', () => {
  const shelves = [rowsShelf('A', 'photos', 1), fold('links', 2), fold('more', 1), fold('other', 0)];
  let r = build({ contentsOf: () => ({ loading: false, shelves }) });
  assert.deepEqual(types(r), ['cluster', 'shelf', 'file', 'shelf', 'shelf']);
  assert.deepEqual(r.filter((x) => x.type === 'shelf').map((x) => [x.shelfId, x.count, x.closed, x.toggle]),
    [['photos', 1, false, 'shut'], ['links', 2, true, 'open'], ['more', 1, true, 'open']]);
  r = build({
    contentsOf: () => ({ loading: false, shelves }),
    shelfState: (b, s) => ({ open: s === 'links', expanded: false }),
  });
  assert.deepEqual(types(r), ['cluster', 'shelf', 'file', 'shelf', 'file', 'file', 'shelf']);
  assert.equal(r[4].shelfId, 'links');
  r = build({
    contentsOf: () => ({ loading: false, shelves }),
    shelfState: (b, s) => ({ shut: s === 'photos' }),
  });
  assert.deepEqual(types(r), ['cluster', 'shelf', 'shelf', 'shelf'], 'a files shelf closes too');
  assert.equal(r[1].closed, true);
});

test('with no files, nothing starts closed', () => {
  const r = build({ contentsOf: () => ({ loading: false, shelves: [fold('links', 2), fold('more', 1)] }) });
  assert.deepEqual(types(r), ['cluster', 'shelf', 'file', 'file', 'shelf', 'file']);
  assert.ok(r.filter((x) => x.type === 'shelf').every((x) => !x.closed));
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

test('the files list: a search or filter opens every shelf, and rows are as tall as asked', () => {
  const contents = { loading: false, shelves: [
    { id: 'photos', label: 'Photos', layout: 'rows', total: 3, items: Array.from({ length: 3 }, (_, i) => ({ cardId: `p${i}` })) },
    { id: 'links', label: 'Links', layout: 'fold', total: 2, items: [{ cardId: 'l1' }, { cardId: 'l2' }] },
  ] };
  const rows = contentRows('B', 0, { contents, foldMinor: false, heights: { file: 36 } });
  assert.deepEqual(rows.map((r) => r.type), ['shelf', 'file', 'file', 'file', 'shelf', 'file', 'file']);
  assert.deepEqual(rows.filter((r) => r.type === 'shelf').map((r) => r.toggle), [null, null], 'plain headings');
  // A shelf shut while browsing doesn't hide what a search or a filter found.
  const shutPhotos = contentRows('B', 0, { contents, foldMinor: false, shelfState: () => ({ shut: true }) });
  assert.deepEqual(shutPhotos.map((r) => r.type), ['shelf', 'file', 'file', 'file', 'shelf', 'file', 'file']);
  assert.equal(rows[1].height, 36);
  assert.equal(rows[0].height, ROW_HEIGHTS.fine.shelf);
  const folded = contentRows('B', 0, { contents });
  assert.deepEqual(folded.map((r) => r.type), ['shelf', 'file', 'file', 'file', 'shelf'], 'links closed by default');
  assert.equal(folded.at(-1).closed, true);
  assert.equal(folded.at(-1).count, 2, 'a closed header still says how many');
});
