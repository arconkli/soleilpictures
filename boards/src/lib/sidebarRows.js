// The sidebar as one flat list of fixed-height rows.
//
// A cluster can hold thousands of cards and the sidebar shows all of them, so
// it cannot render a nested tree. Instead the expanded tree plus whatever
// contents have loaded are flattened here into rows of known height; the view
// finds the visible slice with a binary search over row offsets and renders
// only that. Fixed heights are what make that cheap — a row never has to be
// measured.

// A shelf header's height includes the air above its label (it is what
// separates one shelf from the next).
export const ROW_HEIGHTS = {
  fine: { cluster: 36, shelf: 28, file: 28, more: 28, loading: 28, empty: 28 },
  coarse: { cluster: 44, shelf: 36, file: 44, more: 44, loading: 44, empty: 44 },
};

// One level of the tree, in px: cluster rows step in by it (SidebarBoardTree),
// and a cluster's files panel sits one step past its name (ClusterShelves).
export const INDENT = 16;

// How much of a shelf shows before "Show N more": five rows.
export const PEEK = { rows: 5 };

// One cluster's contents as rows: its shelves (header, file rows, "Show N
// more"), or a single loading / empty row. `depth` is the indent the rows
// take; `hasChildren` says whether sub-clusters sit above them (a cluster with
// sub-clusters and nothing of its own is not "empty").
//
// A shelf's header opens and closes it. Files start open; the shelves laid out
// 'fold' (notes, links, everything else) start closed, so the list is the
// files and, under them, one header a kind saying what else is there (owner,
// 2026-10-18). A shelf's state says which way it was turned: `open` for one
// that starts closed, `shut` for one that starts open. With no files at all
// nothing starts closed (then the rest is all there is), and `foldMinor:
// false` — a search, a filter, Starred — shows every shelf open under a plain
// heading (`toggle: null`): what was asked for is never kept behind a header,
// and a shelf shut while browsing doesn't hide what a search found.
//
// `heights` overrides row heights by type (the files list's rows are roomier
// than the tree's).
export function contentRows(b, depth, {
  contents, shelfState = () => ({}), coarse = false, hasChildren = false,
  heights: heightOverrides = null, foldMinor = true,
} = {}) {
  const heights = { ...ROW_HEIGHTS[coarse ? 'coarse' : 'fine'], ...(heightOverrides || {}) };
  const rows = [];
  const push = (type, key, extra) =>
    rows.push({ key, type, depth, height: heights[type], boardId: b, ...extra });

  const pushItems = (shelf, st) => {
    const items = shelf.items || [];
    const shown = st.expanded ? items : items.slice(0, PEEK.rows);
    for (const item of shown) push('file', `f:${b}:${item.cardId}`, { shelfId: shelf.id, item });
    return shown.length;
  };
  // Past the peek: "Show N more", and once a shelf is open, "Show less" too.
  const pushMore = (shelf, shown, st) => {
    const rest = Math.max(0, shelf.total - shown);
    if (rest > 0 || st.expanded) {
      push('more', `x:${b}:${shelf.id}`, { shelfId: shelf.id, count: rest, expanded: !!st.expanded });
    }
  };

  const c = contents;
  const shelves = (c && c.shelves) || [];
  if (!c || (c.loading && !shelves.length)) {
    push('loading', `l:${b}`, {});
    return rows;
  }
  if (!hasChildren && !shelves.some((s) => s.total > 0 || (s.items && s.items.length))) {
    // A search unfolds a cluster whose NAME matched; with no files matching
    // too, it shows nothing rather than claim the cluster is empty.
    if (!c.searching) push('empty', `e:${b}`, {});
    return rows;
  }
  const folding = foldMinor && shelves.some((s) => s.layout !== 'fold' && s.total > 0);
  for (const shelf of shelves) {
    if (!(shelf.total > 0)) continue;
    const st = shelfState(b, shelf.id) || {};
    const minor = folding && shelf.layout === 'fold';
    const toggle = !foldMinor ? null : minor ? 'open' : 'shut';
    const closed = toggle === 'open' ? !st.open : toggle === 'shut' ? !!st.shut : false;
    push('shelf', `s:${b}:${shelf.id}`, {
      shelfId: shelf.id, count: shelf.total, label: shelf.label, closed, toggle,
    });
    if (closed) continue;
    pushMore(shelf, pushItems(shelf, st), st);
  }
  return rows;
}

export function flattenTree({
  rootIds, childrenOf, isExpanded, contentsOf, shelfState, coarse = false,
}) {
  const heights = ROW_HEIGHTS[coarse ? 'coarse' : 'fine'];
  const rows = [];
  const seen = new Set();

  function walk(id, depth) {
    if (seen.has(id)) return;
    seen.add(id);
    rows.push({ key: `c:${id}`, type: 'cluster', depth, height: heights.cluster, boardId: id });
    if (!isExpanded(id)) return;
    const kids = childrenOf(id) || [];
    for (const k of kids) walk(k, depth + 1);
    rows.push(...contentRows(id, depth + 1, {
      contents: contentsOf(id), shelfState, coarse, hasChildren: kids.length > 0,
    }));
  }

  for (const id of rootIds || []) walk(id, 0);
  return rows;
}

export function layoutRows(rows) {
  const offsets = new Array(rows.length);
  let y = 0;
  for (let i = 0; i < rows.length; i++) { offsets[i] = y; y += rows[i].height; }
  return { offsets, total: y };
}

// [start, end) of the rows touching the viewport plus overscan.
export function visibleRange(layout, scrollTop, viewportHeight, overscan = 300) {
  const { offsets, total } = layout;
  const n = offsets.length;
  if (!n) return { start: 0, end: 0 };
  const lo = Math.max(0, scrollTop - overscan);
  const hi = scrollTop + viewportHeight + overscan;
  if (lo >= total) return { start: n, end: n };
  // last row whose top <= lo
  let a = 0, b = n - 1;
  while (a < b) {
    const mid = (a + b + 1) >> 1;
    if (offsets[mid] <= lo) a = mid; else b = mid - 1;
  }
  const start = a;
  // first row whose top >= hi
  a = start; b = n;
  while (a < b) {
    const mid = (a + b) >> 1;
    if (offsets[mid] >= hi) b = mid; else a = mid + 1;
  }
  return { start, end: a };
}
