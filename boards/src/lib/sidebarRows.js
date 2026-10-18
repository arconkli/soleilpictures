// The sidebar as one flat list of fixed-height rows.
//
// A cluster can hold thousands of cards and the sidebar shows all of them, so
// it cannot render a nested tree. Instead the expanded tree plus whatever
// contents have loaded are flattened here into rows of known height; the view
// finds the visible slice with a binary search over row offsets and renders
// only that. Fixed heights are what make that cheap — a row never has to be
// measured.

export const ROW_HEIGHTS = {
  fine: { cluster: 34, shelf: 24, file: 26, mosaic: 46, fold: 26, more: 26, loading: 26, empty: 26 },
  coarse: { cluster: 44, shelf: 32, file: 44, mosaic: 58, fold: 44, more: 44, loading: 44, empty: 44 },
};

// How much of a shelf shows before "N more": two lines of thumbnails, five rows.
export const PEEK = { mosaicLines: 2, rows: 5 };

export function mosaicPerLine(widthPx, { thumb = 40, gap = 4, inset = 0 } = {}) {
  return Math.max(3, Math.floor((widthPx - inset + gap) / (thumb + gap)));
}

export function flattenTree({
  rootIds, childrenOf, isExpanded, contentsOf, shelfState, perLine = 6, coarse = false,
}) {
  const heights = ROW_HEIGHTS[coarse ? 'coarse' : 'fine'];
  const rows = [];
  const seen = new Set();
  const push = (type, depth, boardId, key, extra) =>
    rows.push({ key, type, depth, height: heights[type], boardId, ...extra });

  function pushItems(b, depth, shelf, st) {
    const items = shelf.items || [];
    const shown = st.expanded ? items : items.slice(0, PEEK.rows);
    for (const item of shown) push('file', depth, b, `f:${b}:${item.cardId}`, { shelfId: shelf.id, item });
    return shown.length;
  }

  function pushMore(b, depth, shelf, shown, st) {
    if (shelf.total > shown) {
      push('more', depth, b, `x:${b}:${shelf.id}`, { shelfId: shelf.id, count: shelf.total - shown, expanded: !!st.expanded });
    }
  }

  function pushContents(b, depth, kids) {
    const c = contentsOf(b);
    const shelves = (c && c.shelves) || [];
    if (!c || (c.loading && !shelves.length)) {
      push('loading', depth, b, `l:${b}`, {});
      return;
    }
    if (!kids.length && !shelves.some((s) => s.total > 0 || (s.items && s.items.length))) {
      push('empty', depth, b, `e:${b}`, {});
      return;
    }
    const folds = [];
    for (const shelf of shelves) {
      if (shelf.layout === 'fold') { if (shelf.total > 0) folds.push(shelf); continue; }
      if (!(shelf.total > 0)) continue;
      const st = shelfState(b, shelf.id) || {};
      push('shelf', depth, b, `s:${b}:${shelf.id}`, { shelfId: shelf.id, count: shelf.total });
      let shown;
      if (shelf.layout === 'mosaic') {
        const items = shelf.items || [];
        const lines = [];
        for (let i = 0; i < items.length; i += perLine) lines.push(items.slice(i, i + perLine));
        const showLines = st.expanded ? lines : lines.slice(0, PEEK.mosaicLines);
        showLines.forEach((chunk, i) =>
          push('mosaic', depth, b, `m:${b}:${shelf.id}:${i}`, { shelfId: shelf.id, items: chunk, line: i }));
        shown = showLines.reduce((n, l) => n + l.length, 0);
      } else {
        shown = pushItems(b, depth, shelf, st);
      }
      pushMore(b, depth, shelf, shown, st);
    }
    if (folds.length) {
      push('fold', depth, b, `o:${b}`, { parts: folds.map((s) => ({ shelfId: s.id, count: s.total })) });
      for (const shelf of folds) {
        const st = shelfState(b, shelf.id) || {};
        if (!st.open) continue;
        const shown = pushItems(b, depth, shelf, st);
        pushMore(b, depth, shelf, shown, st);
      }
    }
  }

  function walk(id, depth) {
    if (seen.has(id)) return;
    seen.add(id);
    push('cluster', depth, id, `c:${id}`, {});
    if (!isExpanded(id)) return;
    const kids = childrenOf(id) || [];
    for (const k of kids) walk(k, depth + 1);
    pushContents(id, depth + 1, kids);
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
