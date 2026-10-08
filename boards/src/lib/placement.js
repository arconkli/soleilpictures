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
import { withGeometry } from './moodboard.js';

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

// Put on board: lay the unplaced cards among `ids` out as one block in the
// free space nearest `at` (or beside the board's content when there's no
// point), keeping their sizes. Unlike a drop, nobody pointed at a spot, so the
// block never lands on what's already there. Returns
// [{ id, patch: { x, y, unplaced: false } }].
export function planPutOnBoard(allCards, ids, at = null, gap = 24) {
  const idSet = new Set(ids || []);
  const moving = (allCards || []).filter((c) => idSet.has(c?.id) && isUnplaced(c));
  if (!moving.length) return [];
  const solid = withGeometry(allCards);
  const block = layoutDrop(moving, { at: { x: 0, y: 0 }, layout: 'grid' });
  const left = Math.min(...block.map((c) => c.x)), top = Math.min(...block.map((c) => c.y));
  const w = Math.max(...block.map((c) => c.x + c.w)) - left;
  const h = Math.max(...block.map((c) => c.y + c.h)) - top;
  const want = Number.isFinite(at?.x) && Number.isFinite(at?.y)
    ? { x: at.x - w / 2, y: at.y - h / 2 }
    : besideContent(solid, gap + 16);
  const spot = nearestFreeSpot(solid, want, w, h, gap) || besideContent(solid, gap + 16);
  return block.map((c) => ({
    id: c.id,
    patch: { x: Math.round(c.x - left + spot.x), y: Math.round(c.y - top + spot.y), unplaced: false },
  }));
}

// The top-left nearest `want` where a w×h block clears every card by `gap`.
// Candidates are `want` itself and the four sides of each card (lined up with
// `want` or with the card), so the answer hugs the content instead of
// wandering a search grid. Null when nothing fits — besideContent always does.
export function nearestFreeSpot(solid, want, w, h, gap = 24) {
  const hits = (x, y) => solid.some((e) => (
    x < e.x + e.w + gap && x + w + gap > e.x && y < e.y + e.h + gap && y + h + gap > e.y
  ));
  if (!hits(want.x, want.y)) return want;
  const cands = [];
  for (const e of solid) {
    for (const x of [e.x + e.w + gap, e.x - w - gap]) cands.push({ x, y: want.y }, { x, y: e.y });
    for (const y of [e.y + e.h + gap, e.y - h - gap]) cands.push({ x: want.x, y }, { x: e.x, y });
  }
  const d = (p) => Math.hypot(p.x - want.x, p.y - want.y);
  cands.sort((a, b) => d(a) - d(b));
  return cands.find((p) => !hits(p.x, p.y)) || null;
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
