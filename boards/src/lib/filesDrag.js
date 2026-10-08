// Dragging from Files onto a board (components/ListSurface.jsx → the
// FILES_DRAG_MIME branch of CanvasSurface's drop handler). Pure planning, so
// what a drop does can be tested without a canvas.
//
// What a drop means depends on where the items came from:
//
//   same cluster as the board    the cards are already there: move them to
//                                the drop point (one undo step)
//   another cluster              a file arrives as a LINKED COPY — a new card
//                                on the same stored file, no re-upload, with
//                                sourceRef pointing back at the original. If
//                                this board already holds a copy of that file,
//                                the drop moves that copy instead (⌥ makes
//                                another).
//                                Notes, docs and grids carry their content in
//                                live Yjs structures a copy can't take along,
//                                so they are offered as a move instead.
//
// Every card in a cluster is on its board today, so "is it on this board" is
// answered by the board's own cards, keyed by the stored file (onBoardIndex).

import { FILES_DRAG_MIME } from './dragMimes.js';
import { layoutDrop } from './layoutEngine.js';
import { isStillUploading } from './abandonedUploads.js';

export { FILES_DRAG_MIME };

// Kinds whose whole content is plain fields — a stored file, a URL, a set of
// colours — so a copy made from a saved snapshot is complete.
export const COPYABLE_KINDS = new Set(['image', 'video', 'audio', 'pdf', 'file', 'link', 'palette']);

// Clusters travel as folders (BOARD_REF_MIME), never as files.
const NEVER_DRAGGED = new Set(['board', 'boardlink']);

// Fields that belong to the card's place on its own board, not to the file.
// `unplaced` too: a linked copy is made by dropping it on a board, so it's on
// that board whatever the original's state (lib/placement.js).
const PLACE_FIELDS = new Set([
  'id', 'z', 'groupId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy',
  'sourceRef', 'locked', 'lockedBy', 'unplaced',
]);

function isPlainValue(v) {
  if (v === null || typeof v !== 'object') return typeof v !== 'function';
  // A live Y type (Map/Array/Text/XmlFragment) never rides in a drag payload.
  if (typeof v.toJSON === 'function' && (typeof v.observe === 'function' || typeof v.observeDeep === 'function' || v._item !== undefined)) return false;
  return true;
}

export function canDragFromFiles(card) {
  return !!card && !!card.id && !NEVER_DRAGGED.has(card.kind) && !isStillUploading(card);
}

// The card as data: no live Yjs values, nothing tied to its place.
export function plainCardForCopy(card) {
  const out = {};
  for (const [k, v] of Object.entries(card || {})) {
    if (PLACE_FIELDS.has(k)) continue;
    if (!isPlainValue(v)) continue;
    out[k] = v;
  }
  return out;
}

// The stored file a card shows — the identity two copies share.
export function fileKeyOf(card) {
  if (!card) return null;
  const k = card.pdfSrc || card.fileSrc || card.src || null;
  return typeof k === 'string' && k ? k : null;
}

// Stored file → id of the card that already shows it on this board.
export function onBoardIndex(cards) {
  const m = new Map();
  for (const c of cards || []) {
    if (!c || !COPYABLE_KINDS.has(c.kind)) continue;
    const k = fileKeyOf(c);
    if (k && !m.has(k)) m.set(k, c.id);
  }
  return m;
}

// ── payload ──────────────────────────────────────────────────────────────
// Cards are carried whole: the board they land on may never have loaded the
// cluster they came from.
export function buildFilesPayload({ sourceBoardId, sourceName = '', cards }) {
  const list = (cards || []).filter(canDragFromFiles).map((c) => ({ ...plainCardForCopy(c), id: c.id }));
  if (!sourceBoardId || !list.length) return null;
  return JSON.stringify({ v: 1, sourceBoardId, sourceName, cards: list });
}

export function parseFilesPayload(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let p;
  try { p = JSON.parse(raw); } catch (_) { return null; }
  if (!p || p.v !== 1 || typeof p.sourceBoardId !== 'string' || !Array.isArray(p.cards)) return null;
  const cards = p.cards.filter((c) => c && typeof c.id === 'string' && typeof c.kind === 'string' && !NEVER_DRAGGED.has(c.kind));
  if (!cards.length) return null;
  return { sourceBoardId: p.sourceBoardId, sourceName: typeof p.sourceName === 'string' ? p.sourceName : '', cards };
}

// ── what a drop does ─────────────────────────────────────────────────────
const num = (v, d) => (Number.isFinite(v) ? v : d);

// Same cluster: move the cards so their block centres on the drop point,
// keeping their arrangement. Uses the board's live geometry where it has it.
export function planMoveToPoint(cards, at, liveById = null) {
  const list = (cards || []).map((c) => (liveById?.get?.(c.id) || c)).filter(Boolean);
  if (!list.length || !Number.isFinite(at?.x) || !Number.isFinite(at?.y)) return [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of list) {
    const x = num(c.x, 0), y = num(c.y, 0);
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + num(c.w, 100)); maxY = Math.max(maxY, y + num(c.h, 100));
  }
  const dx = at.x - (minX + maxX) / 2;
  const dy = at.y - (minY + maxY) / 2;
  return list.map((c) => ({ id: c.id, patch: { x: Math.round(num(c.x, 0) + dx), y: Math.round(num(c.y, 0) + dy) } }));
}

// Another cluster: sort each dragged card into what the drop does with it.
//   copies   new linked-copy cards, laid out as one block on the drop point
//   moves    cards already on this board showing the same file → move here
//   moveOnly notes, docs, grids… — offered as a move from their cluster
export function planCrossDrop(cards, at, {
  sourceBoardId, boardCards = [], extraCopy = false, makeId,
} = {}) {
  const index = extraCopy ? new Map() : onBoardIndex(boardCards);
  const toCopy = [], alreadyHere = [], moveOnly = [];
  const seen = new Set();
  for (const c of cards || []) {
    if (!c || NEVER_DRAGGED.has(c.kind)) continue;
    if (!COPYABLE_KINDS.has(c.kind)) { moveOnly.push(c); continue; }
    const existing = index.get(fileKeyOf(c));
    if (existing) { if (!seen.has(existing)) { seen.add(existing); alreadyHere.push(existing); } continue; }
    toCopy.push(c);
  }
  const mk = makeId || ((c, i) => `${c.kind || 'card'}-${Date.now()}-${i}-${Math.floor(Math.random() * 1e6)}`);
  const sized = toCopy.map((c, i) => ({
    ...plainCardForCopy(c),
    id: mk(c, i),
    w: num(c.w, 240), h: num(c.h, 200),
    sourceRef: { boardId: sourceBoardId, cardId: c.id },
  }));
  // The same shapes a drop from the desktop makes: photographs in justified
  // rows, anything mixed as a uniform grid, a single card at its own size.
  const allImages = sized.length > 1 && sized.every((c) => c.kind === 'image');
  const copies = sized.length ? layoutDrop(sized, { at, layout: allImages ? 'justified' : 'grid' }) : [];
  const liveById = new Map((boardCards || []).map((c) => [c.id, c]));
  const moves = alreadyHere.length ? planMoveToPoint(alreadyHere.map((id) => liveById.get(id)).filter(Boolean), at) : [];
  return { copies, moves, moveOnly };
}

export function summarizeDrop({ copied = 0, moved = 0, sourceName = '' }) {
  const parts = [];
  const from = sourceName ? ` from “${sourceName}”` : '';
  if (copied) parts.push(`Linked ${copied} ${copied === 1 ? 'file' : 'files'}${from}`);
  if (moved) parts.push(`${copied ? 'moved' : 'Moved'} ${moved} already on this board`);
  return parts.join(' · ');
}

// Arrows whose two ends are both in idMap (old id → new id), re-pointed at the
// new ids — the arrows that travel with cards moved together.
function arrowEnd(r) { return typeof r === 'string' ? r : r?.cardId; }
export function arrowsBetween(arrows, idMap) {
  const out = [];
  for (const a of arrows || []) {
    const f = arrowEnd(a?.from), t = arrowEnd(a?.to);
    if (!idMap?.[f] || !idMap?.[t]) continue;
    out.push({
      ...a,
      from: typeof a.from === 'string' ? idMap[f] : { ...a.from, cardId: idMap[f] },
      to: typeof a.to === 'string' ? idMap[t] : { ...a.to, cardId: idMap[t] },
    });
  }
  return out;
}
