// The cluster tab's list (components/sidebar/ClusterSwitch.jsx): every
// cluster of the workspace in the tree's order, or the ones whose name has
// what was typed.
//
// The tree's order is SidebarBoardTree's, and both take it from sortSiblings:
// the root's children (the person's projects) by recent work, so the one
// they're in now is near the top; deeper levels in the order they were made,
// so a project's own structure doesn't reshuffle when a card moves. The list
// keeps it, so a cluster sits where the tree above has it.

import { boardRecency } from './projectsHome.js';

// Sorts one parent's children in place, and returns them.
export function sortSiblings(arr, parentId, rootId) {
  if (rootId && parentId === rootId) return arr.sort((a, b) => boardRecency(b) - boardRecency(a));
  return arr.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
}

// Every cluster with its depth, the root first, each followed by its own.
export function clustersInTreeOrder(list, rootId) {
  const kids = new Map();
  for (const b of list || []) {
    if (!b?.id) continue;
    const p = b.parent_board_id || null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(b);
  }
  for (const [p, arr] of kids) sortSiblings(arr, p, rootId);
  const out = [];
  const seen = new Set();
  const walk = (b, depth) => {
    if (!b || seen.has(b.id) || depth > 30) return;
    seen.add(b.id);
    out.push({ board: b, depth });
    for (const k of kids.get(b.id) || []) walk(k, depth + 1);
  };
  walk((list || []).find((b) => b?.id === rootId), 0);
  for (const b of kids.get(null) || []) walk(b, 0);
  return out;
}

// Accents and case don't matter when finding a cluster by name.
export const plainText = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Found by name: flat, the names that start with it first (the tree's order
// otherwise), each with where the match is, to show it, and the cluster it's
// in, to tell two of the same name apart.
export function findClusters(rows, query, byId = null) {
  const q = plainText(String(query || '').trim());
  if (!q) return rows;
  const index = byId || new Map(rows.map((r) => [r.board.id, r.board]));
  const get = (id) => (index instanceof Map ? index.get(id) : index[id]) || null;
  return rows
    .map((r, i) => {
      const name = r.board.name || 'Untitled';
      const plain = plainText(name);
      const at = plain.indexOf(q);
      if (at < 0) return null;
      // Only where the plain name lines up with the name (no letters that
      // came apart into a letter and a mark) can the match be shown.
      const shows = plain.length === name.length;
      return {
        board: r.board, depth: 0, i, starts: at === 0,
        hit: shows ? { at, length: q.length } : null,
        parentName: get(r.board.parent_board_id)?.name || '',
      };
    })
    .filter(Boolean)
    .sort((x, y) => Number(y.starts) - Number(x.starts) || x.i - y.i)
    .map(({ i, starts, ...r }) => r);
}
