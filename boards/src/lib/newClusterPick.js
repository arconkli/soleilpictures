// newClusterPick — what the top bar's "+ New cluster" would take from each
// pane: how many cards are picked there, and the name "New cluster from N
// cards" would suggest for them (lib/clusterFromSelection).
//
// The canvas, or the file list, in each pane publishes it as its selection
// changes; NewClusterButton reads it for its count and its name field. A module
// store rather than App state: the selection changes on every click, only the
// button needs to know, and App is far too big to re-render for a badge.

const NONE = Object.freeze({ boardId: null, count: 0, suggestion: null });
const picks = new Map();   // paneId -> { boardId, count, suggestion }
const subs = new Set();

// pick: { boardId, count, suggestion } — or null when the pane holds nothing
// (and when its surface goes away).
export function publishNewClusterPick(paneId, pick) {
  const prev = picks.get(paneId) || NONE;
  const count = Math.max(0, Math.floor(Number(pick?.count) || 0));
  const next = pick && pick.boardId && count
    ? { boardId: pick.boardId, count, suggestion: pick.suggestion || null }
    : NONE;
  if (prev.boardId === next.boardId && prev.count === next.count && prev.suggestion === next.suggestion) return;
  picks.set(paneId, next);
  for (const fn of subs) { try { fn(); } catch (_) {} }
}

// The same object until the pick changes, as useSyncExternalStore needs. A
// pick published for another cluster (the pane has moved on) reads as none.
export function readNewClusterPick(paneId, boardId) {
  const p = picks.get(paneId);
  return p && boardId && p.boardId === boardId ? p : NONE;
}

export function subscribeNewClusterPick(fn) {
  subs.add(fn);
  return () => { subs.delete(fn); };
}
