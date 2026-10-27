// Which stored tier of an image to fetch when it will be drawn at a known
// size. Pure (no Supabase, no DOM) so the stored-thumbnail renderer and the
// hover prefetch share one rule and node tests can pin it.
//
// The tiers: the original (any size, often a 12 MP camera JPEG), the ~1280px
// preview (`previewKey`) and the ~640px small preview (`previewSmKey`), all
// from images rows via imageMeta.rowToMeta. Readers that drew or warmed the
// ORIGINAL paid a full download plus a full decode for something shown at a
// few hundred pixels (PERF-01, PERF-06).

import { drawsNowhere } from './fileView.js';

// `meta` is getMeta(origKey) (or null when it has not been primed);
// `drawnPx` is the longest edge the image will occupy, in device pixels.
// Returns a bare storage key (no r2: prefix): the small preview when it covers
// the draw, else the 1280 preview, else the original, or null for a format no
// browser draws (a raw, a .psd: lib/fileView.js drawsNowhere) with no preview
// yet, whose original would be downloaded whole only to fail. When even the 1280
// preview is smaller than the draw it is still chosen — every reader of this
// draws into a downscaled surface (thumbnails are supersampled and shown at
// half size; the prefetch only warms the cache), so the original's extra
// pixels are never seen.
export function pickVariantKey(origKey, meta, drawnPx = Infinity) {
  if (!origKey || typeof origKey !== 'string') return null;
  const original = drawsNowhere(origKey) ? null : origKey;
  if (!meta) return original;
  const smEdge = Math.max(meta.previewSmW || 0, meta.previewSmH || 0);
  if (meta.previewSmKey && smEdge > 0 && drawnPx <= smEdge) return meta.previewSmKey;
  if (meta.previewKey) return meta.previewKey;
  // A small preview with no large one only happens on rows a backfill
  // half-wrote; it still beats decoding the original.
  if (meta.previewSmKey) return meta.previewSmKey;
  return original;
}

// The same, for an `r2:` card src (null where pickVariantKey is). Non-r2 srcs
// (a data: URL, a link card's remote image) have no tiers and come back
// unchanged.
export function pickVariantSrc(src, getMeta, drawnPx = Infinity) {
  if (typeof src !== 'string' || !src.startsWith('r2:')) return src;
  const key = src.slice(3);
  let meta = null;
  try { meta = typeof getMeta === 'function' ? getMeta(key) : null; } catch (_) { meta = null; }
  const picked = pickVariantKey(key, meta, drawnPx);
  return picked ? `r2:${picked}` : null;
}

// The longest edge at or below which an original is its own Tier-1 preview
// (uploads.js PREVIEW_LONGEST_EDGE; migration 0402 uses the same 1280).
export const ORIGINAL_IS_PREVIEW_EDGE = 1280;

// True when variant generation has nothing left to make for this image, so
// the backfill must not download and re-decode it again (PERF-04). Either the
// server said so (0402's variants_checked_at → meta.checked), a preview
// exists, or the blur is recorded and the original is small enough to serve
// as its own preview — the case that never got a preview by design and so
// used to be re-processed on every writer session, forever.
export function variantsSettled(meta) {
  if (!meta) return false;
  if (meta.checked || meta.previewKey) return true;
  const edge = Math.max(Number(meta.w) || 0, Number(meta.h) || 0);
  return !!meta.blur && edge > 0 && edge <= ORIGINAL_IS_PREVIEW_EDGE;
}
