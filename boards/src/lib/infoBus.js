// Info, from anywhere. A right-click menu, ⌘I, the sidebar or Files asks for
// Info with openInfo(); the drawer is mounted once at the app level (App.jsx,
// LocalBoardsApp.jsx) and resolves the live cards itself — the same no-prop-
// drilling shape as soleil-open-backlinks.
//
//   openInfo({ boardId, cardIds })          one card, or a summary of several
//   openInfo({ clusterId })                 a cluster (folder, sidebar, canvas background)
//   openInfo({ boardId, groupId })          a canvas group
//   openInfo({ …, cards })                  snapshot cards, for a cluster that isn't open
//   openInfo({ …, follow: 'canvas:main' })  keep up with that surface's selection
//   openInfo({ …, toggle: true })           ⌘I: close it if it's already open
//
// Surfaces report their selection with reportSelection(source, boardId, ids);
// a drawer opened with `follow` re-targets as the selection changes, the way
// an inspector does.

export const INFO_EVENT = 'soleil-open-info';
export const INFO_CLOSE_EVENT = 'soleil-close-info';

export function openInfo(detail) {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent(INFO_EVENT, { detail: detail || {} }));
}

// closeInfo() closes it; closeInfo({ follow }) only if it's following that
// surface (which is going away).
export function closeInfo(detail = null) {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent(INFO_CLOSE_EVENT, { detail }));
}

const selections = new Map();   // source → { boardId, ids }
const subscribers = new Set();

// `extra.clusterIds`: folders selected instead of cards (Files). `extra.cards`:
// the cards behind the ids when their cluster isn't open in a pane (Files
// browsing another cluster), so the drawer can still describe them.
export function reportSelection(source, boardId, ids, extra = {}) {
  if (!source) return;
  const list = Array.isArray(ids) ? ids : [...(ids || [])];
  const clusterIds = Array.isArray(extra.clusterIds) ? extra.clusterIds : [];
  const same = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
  const prev = selections.get(source);
  if (prev && prev.boardId === boardId && same(prev.ids, list) && same(prev.clusterIds, clusterIds) && prev.cards === (extra.cards || null)) return;
  const next = { boardId: boardId || null, ids: list, clusterIds, cards: extra.cards || null };
  selections.set(source, next);
  for (const fn of subscribers) { try { fn(source, next); } catch (_) {} }
}

// The surface went away: forget its selection (and any cards it carried).
export function clearSelection(source) {
  selections.delete(source);
}

export function readSelection(source) {
  return selections.get(source) || null;
}

export function subscribeSelection(fn) {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

// What a follow-mode drawer should show for a selection: the card, a summary
// of several, or — nothing selected — the cluster itself.
export function targetForSelection(sel, base = {}) {
  if (!sel || !sel.boardId) return null;
  const cards = sel.cards || null;
  const folders = sel.clusterIds || [];
  // Several things, folders among them: a summary of all of them.
  if (sel.ids.length && folders.length) return { ...base, boardId: sel.boardId, cardIds: sel.ids, clusterIds: folders, clusterId: null, groupId: null, cards };
  if (sel.ids.length) return { ...base, boardId: sel.boardId, cardIds: sel.ids, clusterId: null, groupId: null, cards };
  if (folders.length > 1) return { ...base, boardId: sel.boardId, cardIds: [], clusterIds: folders, clusterId: null, groupId: null, cards: null };
  const clusterId = folders.length === 1 ? folders[0] : sel.boardId;
  return { ...base, boardId: sel.boardId, cardIds: null, clusterId, groupId: null, cards: clusterId === sel.boardId ? cards : null };
}

// A key pressed inside the Info drawer is the drawer's — ⌘C copies its text,
// ⌘A selects its text, Backspace deletes nothing on the board behind it.
export function inInfoDrawer(e) {
  return !!e?.target?.closest?.('.info-host');
}
