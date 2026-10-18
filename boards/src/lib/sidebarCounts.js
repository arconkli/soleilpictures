// The numbers on cluster rows and shelf headers.
//
// A closed cluster's counts come from sidebar_shelf_counts (one row per
// cluster and shelf); the open one's from its live doc, which is ahead of
// card_index until the next sync, so withLive lets it win. A cluster's row
// shows its own contents plus everything nested under it, hence rollupCounts.
//
// counts: { byShelf: { [shelfId]: n }, total, unplaced }

import { SHELF_IDS } from './sidebarShelves.js';

export function emptyCounts() {
  return { byShelf: {}, total: 0, unplaced: 0 };
}

function add(counts, shelf, n, unplaced) {
  counts.byShelf[shelf] = (counts.byShelf[shelf] || 0) + n;
  counts.total += n;
  counts.unplaced += unplaced;
}

export function countsFromRows(rows) {
  const out = new Map();
  for (const r of rows || []) {
    if (!r || !r.shelf || !SHELF_IDS.includes(r.shelf)) continue;
    if (!out.has(r.board_id)) out.set(r.board_id, emptyCounts());
    add(out.get(r.board_id), r.shelf, Number(r.n) || 0, Number(r.n_unplaced) || 0);
  }
  return out;
}

export function countsFromItems(items) {
  const c = emptyCounts();
  for (const i of items || []) {
    if (!i || !SHELF_IDS.includes(i.shelf)) continue;
    add(c, i.shelf, 1, i.unplaced ? 1 : 0);
  }
  return c;
}

export function rollupCounts(boards, own) {
  const live = (boards || []).filter((b) => b && !b.deleted_at);
  const children = new Map();
  for (const b of live) {
    if (b.parent_board_id == null) continue;
    if (!children.has(b.parent_board_id)) children.set(b.parent_board_id, []);
    children.get(b.parent_board_id).push(b.id);
  }
  const alive = new Set(live.map((b) => b.id));
  const out = new Map();
  for (const b of live) {
    // Each board walks its own subtree with its own visited set, so a parent
    // loop ends at the first repeat and nothing is counted twice.
    const seen = new Set([b.id]);
    const stack = [b.id];
    let total = 0;
    let unplaced = 0;
    while (stack.length) {
      const id = stack.pop();
      const c = own?.get(id);
      if (c) { total += c.total; unplaced += c.unplaced; }
      for (const kid of children.get(id) || []) {
        if (!alive.has(kid) || seen.has(kid)) continue;
        seen.add(kid);
        stack.push(kid);
      }
    }
    out.set(b.id, { own: own?.get(b.id) || emptyCounts(), total, unplaced });
  }
  return out;
}

export function withLive(own, boardId, liveCounts) {
  const next = new Map(own || []);
  next.set(boardId, liveCounts);
  return next;
}
