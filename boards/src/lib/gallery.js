// gallery — the pictures on a board, in the order a person reads them, at a
// size a model can afford to look at. Backs GET /api/v1/boards/:id/gallery and
// the view_board tool; the inline cluster view (MCP Apps) will read the same
// manifest.
//
// Pure: the route reads the rows and the bytes, this decides which picture,
// which rendition and how many fit.

import { entityUrl } from './entityUrl.js';

export const GALLERY = {
  // Pictures per page, and the most one page may ask for.
  defaultLimit: 12,
  maxLimit: 24,
  // The most cards named in one call (card_ids).
  maxCardIds: 24,
  // Bytes embedded per picture and per response with inline=1. The small
  // rendition (640px on its longest edge) is usually tens of KB; past these the
  // picture is listed without its bytes, saying why, rather than one heavy
  // picture crowding out the rest.
  inlineSmMaxBytes: 400 * 1024,
  inlinePreviewMaxBytes: 1024 * 1024,
  inlineTotalMaxBytes: 1536 * 1024,
  // An original stands in for a missing rendition only when it is this small.
  originalMaxBytes: 400 * 1024,
};

// What counts as a picture: an image with its stored key, or a video with a
// poster frame. A card that is in the cluster but not on its board is left out.
export function pictureOf(card) {
  if (!card || card.unplaced === true) return null;
  const src = (v) => (typeof v === 'string' && v.startsWith('r2:') ? v.slice(3) : null);
  if ((card.kind || 'note') === 'image') {
    const key = src(card.src);
    return key ? { key, from: 'image' } : null;
  }
  if (card.kind === 'video') {
    const key = src(card.poster);
    return key ? { key, from: 'poster' } : null;
  }
  return null;
}

// Reading order: top to bottom, then left to right. Cards whose tops sit within
// half a typical card of each other read as one row, so a ragged row of photos
// is not interleaved by a few pixels of misalignment.
const ROW_TOLERANCE = 80;
export function readingOrder(cards) {
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const sorted = [...cards].sort((a, b) => num(a.y) - num(b.y) || num(a.x) - num(b.x));
  const rows = [];
  for (const c of sorted) {
    const row = rows[rows.length - 1];
    if (row && num(c.y) - row.top <= ROW_TOLERANCE) row.cards.push(c);
    else rows.push({ top: num(c.y), cards: [c] });
  }
  return rows.flatMap((r) => r.cards.sort((a, b) => num(a.x) - num(b.x)));
}

// The pictures of a board in reading order: [{ card, key, from }].
export function boardPictures(cards) {
  const out = [];
  for (const card of readingOrder(cards || [])) {
    const p = pictureOf(card);
    if (p) out.push({ card, ...p });
  }
  return out;
}

// Which rendition to show from an images row: the 640px one for a page of
// pictures, the 1280px one when a few are looked at closely, each falling back
// to the other, and the original only when it is small. Null when nothing is fit.
export function pickRendition(row, size = 'sm') {
  if (!row) return null;
  const sm = row.preview_sm_path
    ? { key: row.preview_sm_path, variant: 'sm', width: row.preview_sm_w ?? null, height: row.preview_sm_h ?? null }
    : null;
  const pv = row.preview_path
    ? { key: row.preview_path, variant: 'preview', width: row.preview_w ?? null, height: row.preview_h ?? null }
    : null;
  const pick = size === 'preview' ? (pv || sm) : (sm || pv);
  if (pick) return pick;
  // Number(null) is 0, and an original of unknown size is not a small one.
  const bytes = row.size_bytes == null ? NaN : Number(row.size_bytes);
  if (Number.isFinite(bytes) && bytes <= GALLERY.originalMaxBytes) {
    return { key: row.storage_path, variant: 'original', width: row.width ?? null, height: row.height ?? null };
  }
  return null;
}

// A cursor is where the next page starts in the reading order, nothing more:
// the order is recomputed from the board on every call.
export const encodeCursor = (offset) => `p${offset}`;
export function decodeCursor(cursor) {
  if (cursor == null || cursor === '') return 0;
  const m = /^p(\d{1,6})$/.exec(String(cursor));
  return m ? Number(m[1]) : null;
}

// Links that open the board, or the board with the card picked, in the app at
// `origin` — the API's own origin, so a preview's links open the preview.
export const boardUrl = (origin, boardId) =>
  entityUrl({ kind: 'board', id: boardId }, { origin, pathname: '/' });
export const cardUrl = (origin, boardId, cardId) =>
  entityUrl({ kind: 'card', boardId, cardId }, { origin, pathname: '/' });

// Base64 in chunks: String.fromCharCode(...bytes) throws a RangeError somewhere
// around 100 KB, and a rendition is often past that.
export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// Hands out the inline byte budget in order: each picture is embedded while it
// fits under its own ceiling and what is left of the total.
export function makeInlineBudget(size = 'sm') {
  const perImage = size === 'preview' ? GALLERY.inlinePreviewMaxBytes : GALLERY.inlineSmMaxBytes;
  let left = GALLERY.inlineTotalMaxBytes;
  return (bytes) => {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return 'unknown_size';
    if (n > perImage) return 'too_large';
    if (n > left) return 'budget';
    left -= n;
    return null;
  };
}
