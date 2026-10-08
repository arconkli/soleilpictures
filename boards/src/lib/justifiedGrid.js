// The Files grid as justified rows (components/clusterBrowser/JustifiedGallery
// .jsx). Pictures keep their own shape and every row fills the width, the way
// a photo library reads — instead of a fixed 4:3 box per item that crops a
// portrait to a sliver and letterboxes a panorama.
//
// Pure: what goes where, which tiles are near the viewport, which tile an
// arrow key lands on, and which stored size of a picture a tile should load.

import { justifiedRows } from './layoutEngine.js';

// Row height per tile size (S / M / L in the View menu) — the preview's
// height; the caption sits under it.
export const TILE_SIZES = Object.freeze({ s: 120, m: 170, l: 240 });
export const DEFAULT_TILE_SIZE = 'm';
export const GALLERY_GAP = 10;
export const CAPTION_H = 30;

// A tile narrower than half its height, or wider than 2.4×, stops reading as
// the picture: clamp so one panorama can't flatten a row.
export const ASPECT_MIN = 0.5;
export const ASPECT_MAX = 2.4;

// Things without a picture of their own get a shape that suits their preview.
const KIND_ASPECT = {
  pdf: 0.78, doc: 0.8, note: 1, file: 1, shape: 1,
  audio: 1.5, link: 1.5, palette: 1.5, schedule: 1.3, grid: 1.25, video: 16 / 9,
};

const clampAspect = (a) => Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, a));
const ratio = (w, h) => (Number(w) > 0 && Number(h) > 0 ? Number(w) / Number(h) : null);

// `meta` is the stored image's metadata (lib/imageMeta getMeta), when known.
export function aspectOfItem(item, meta = null) {
  if (!item) return 1;
  if (item.isGroup) return 1.25;
  const kind = item.kind;
  const card = item.card || {};
  if (kind === 'image' || kind === 'video') {
    const a = ratio(meta?.w, meta?.h) ?? ratio(card.w, card.h);
    if (a) return clampAspect(a);
  }
  if (kind === 'grid') {
    const a = ratio(card.w, card.h);
    if (a) return clampAspect(a);
  }
  return clampAspect(KIND_ASPECT[kind] ?? 1);
}

// Lay entries out in rows `width` wide. Each entry needs an id and an aspect.
// Returns tile rects (preview + caption) in entry order and the total height.
export function layoutGallery(entries, {
  width, rowHeight = TILE_SIZES[DEFAULT_TILE_SIZE], gap = GALLERY_GAP, captionH = CAPTION_H,
} = {}) {
  const list = entries || [];
  if (!list.length || !(width > 0)) return { tiles: [], height: 0 };
  const placed = justifiedRows(
    list.map((e) => ({ id: e.id, w: e.aspect * 100, h: 100 })),
    { width, gap, rowHeight, lastRowMaxStretch: 1 },
  );
  // justifiedRows stacks preview heights; give every row its caption too.
  const tops = [...new Set(placed.map((t) => t.y))].sort((a, b) => a - b);
  const rowOf = new Map(tops.map((y, i) => [y, i]));
  let height = 0;
  const tiles = placed.map((t) => {
    const row = rowOf.get(t.y);
    const tile = { id: t.id, row, x: t.x, y: t.y + row * captionH, w: t.w, h: t.h + captionH, previewH: t.h };
    height = Math.max(height, tile.y + tile.h);
    return tile;
  });
  return { tiles, height };
}

// Tiles overlapping [top − overscan, bottom + overscan], as an index range
// [start, end). Tiles come in row order, so the range is contiguous.
export function visibleRange(tiles, top, bottom, overscan = 600) {
  const n = tiles?.length || 0;
  if (!n) return [0, 0];
  const lo = top - overscan, hi = bottom + overscan;
  let start = 0;
  while (start < n && tiles[start].y + tiles[start].h < lo) start++;
  let end = start;
  while (end < n && tiles[end].y <= hi) end++;
  return [start, end];
}

// The tile an arrow key moves to. ←/→ step through the order (wrapping across
// rows, as reading does); ↑/↓ pick the tile in the row above/below whose
// centre is nearest. Stays put at the edges.
export function gridNeighbor(tiles, index, dir) {
  const n = tiles?.length || 0;
  if (!n || index < 0 || index >= n) return index;
  if (dir === 'left') return Math.max(0, index - 1);
  if (dir === 'right') return Math.min(n - 1, index + 1);
  const from = tiles[index];
  const targetRow = from.row + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0);
  if (targetRow === from.row) return index;
  const cx = from.x + from.w / 2;
  let best = index, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    if (tiles[i].row !== targetRow) continue;
    const d = Math.abs(tiles[i].x + tiles[i].w / 2 - cx);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// The stored size of a picture a tile should load: the 640px preview when it
// covers the tile on this screen, the 1280px one when that does, else the
// original. Never the original just because metadata hasn't arrived — that is
// the caller's call (it can wait or accept it).
export function tileImageSrc(src, meta, devicePx) {
  if (typeof src !== 'string' || !src.startsWith('r2:') || !meta) return src;
  const need = Number(devicePx) || 0;
  if (meta.previewSmKey && need <= (meta.previewSmW || 640)) return `r2:${meta.previewSmKey}`;
  if (meta.previewKey && need <= (meta.previewW || 1280)) return `r2:${meta.previewKey}`;
  if (meta.previewKey && !(meta.w > 0)) return `r2:${meta.previewKey}`;
  return src;
}

// Tile size preference — this device's, like the panel's width.
const SIZE_KEY = 'soleil.files.tileSize';
export function readTileSize(storage) {
  try {
    const s = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    const v = s?.getItem(SIZE_KEY);
    return TILE_SIZES[v] ? v : DEFAULT_TILE_SIZE;
  } catch (_) { return DEFAULT_TILE_SIZE; }
}
export function writeTileSize(size, storage) {
  if (!TILE_SIZES[size]) return;
  try {
    const s = storage !== undefined ? storage : (typeof localStorage !== 'undefined' ? localStorage : null);
    s?.setItem(SIZE_KEY, size);
  } catch (_) {}
}
