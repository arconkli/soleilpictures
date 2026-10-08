// Files that are in a cluster but not on its board.
//
// A card normally IS its place on the canvas. A file dropped into Files stays
// off the board instead: it's a card with `unplaced: true` — in the cluster,
// listed in Files, counted like any card, but not drawn on the canvas until
// it's placed (dragged onto the board, or Put on board). Remove from board on
// the canvas sets it back.
//
// The flag is only ever read through isUnplaced: a card without it (every
// card that existed before this) is on the board. Placing writes
// `unplaced: false` rather than deleting the key — the mutators only `set`,
// and undo restores the exact value.
//
// An unplaced card keeps a finite x/y: a free spot below the board's content,
// chosen the way a Files drop always chose one. Clients that predate the flag
// draw it there, sanely; geometry code never meets a NaN.

import { arrangeInFreeSpace } from './canvasGeom.js';
import { layoutDrop } from './layoutEngine.js';

export function isUnplaced(card) {
  return card?.unplaced === true;
}

// The cards the canvas draws. The same array back when nothing is off the
// board, so memoized consumers downstream don't see a change.
const placedCache = new WeakMap();
export function placedOf(cards) {
  if (!Array.isArray(cards)) return [];
  const hit = placedCache.get(cards);
  if (hit) return hit;
  const out = cards.some(isUnplaced) ? cards.filter((c) => !isUnplaced(c)) : cards;
  placedCache.set(cards, out);
  return out;
}

export function countUnplaced(cards) {
  let n = 0;
  for (const c of cards || []) if (isUnplaced(c)) n++;
  return n;
}

// What Remove from board applies to: things that are files or simple content.
// Grids, docs and schedules hold structure the board is for; clusters and
// cluster links are the folders themselves.
export const UNPLACEABLE_KINDS = Object.freeze(['image', 'video', 'audio', 'pdf', 'file', 'link', 'palette', 'note']);
const UNPLACEABLE = new Set(UNPLACEABLE_KINDS);
export function canUnplace(card) {
  return !!card && !isUnplaced(card) && !card.locked && UNPLACEABLE.has(card.kind);
}

// Where unplaced files wait: free space over EVERY card, placed or not, so on
// a client that ignores the flag a batch from Files never lands on the board's
// content or on an earlier batch.
export function positionUnplaced(allCards, items, opts = {}) {
  return arrangeInFreeSpace(allCards, items, opts);
}

// Put on board: lay the unplaced cards among `ids` out as one block centred on
// `at` (or beside the board's content when there's no point), keeping their
// sizes. Returns [{ id, patch: { x, y, unplaced: false } }].
export function planPutOnBoard(allCards, ids, at = null) {
  const idSet = new Set(ids || []);
  const moving = (allCards || []).filter((c) => idSet.has(c?.id) && isUnplaced(c));
  if (!moving.length) return [];
  let target = at;
  if (!Number.isFinite(target?.x) || !Number.isFinite(target?.y)) {
    const block = layoutDrop(moving, { at: { x: 0, y: 0 }, layout: 'grid' });
    const w = Math.max(...block.map((c) => c.x + c.w)) - Math.min(...block.map((c) => c.x));
    const h = Math.max(...block.map((c) => c.y + c.h)) - Math.min(...block.map((c) => c.y));
    const spot = besideContent(placedOf(allCards));
    target = { x: spot.x + w / 2, y: spot.y + h / 2 };
  }
  const laid = layoutDrop(moving, { at: target, layout: 'grid' });
  return laid.map((c) => ({ id: c.id, patch: { x: c.x, y: c.y, unplaced: false } }));
}

// The top-left of a spot just right of everything on the board.
export function besideContent(placed, gap = 40) {
  let right = -Infinity, top = Infinity;
  for (const c of placed || []) {
    if (!Number.isFinite(c?.x) || !Number.isFinite(c?.y)) continue;
    right = Math.max(right, c.x + (Number.isFinite(c.w) ? c.w : 0));
    top = Math.min(top, c.y);
  }
  if (!Number.isFinite(right)) return { x: 80, y: 80 };
  return { x: Math.round(right + gap), y: Math.round(top) };
}
