// Per-kind prefetchers. The wiring layer (components) calls these;
// they call into the central scheduler in prefetch.js, which handles
// dedup + TTL + idle queueing.
//
// Domain knowledge lives here — what does it mean to "prefetch a
// board" or "prefetch an entity"? Components don't need to know.

import { prefetch, peek } from './prefetch.js';
import { loadBoardSnapshot } from './boardsApi.js';
import { resolveSrc } from './r2.js';
import { decodeViaWorker } from './previewWorkerClient.js';
import { primeImageMeta, getMeta } from './imageMeta.js';
import { pickVariantKey } from './imageVariantPick.js';

const BOARD_TTL = 30_000;       // 30s — board navigation is short-tail
const IMAGE_TTL = 5 * 60_000;   // 5 min — decoded image bytes stay hot

// Prefetch a board's persisted snapshot. Returns a Promise that
// resolves to the base64 snapshot string (or null if missing).
//
// Side effect: once the snapshot lands, fire-and-forget warm the
// first ~6 image refs found in the doc so the canvas paints with
// bytes already decoded by the browser. Not on the 'high' lane: that is
// yboard's own cold open, which is about to decode this snapshot for real
// and mount those images itself — warming them too only decoded the
// snapshot a second time (PERF-06).
export function prefetchBoard(boardId, { lane = 'normal' } = {}) {
  if (!boardId) return Promise.resolve(null);
  return prefetch(`board:${boardId}`, async () => {
    const b64 = await loadBoardSnapshot(boardId);
    if (b64 && lane !== 'high') {
      // Microtask defer so the await chain in the consumer (yboard
      // cold-load) gets the snapshot first, then the image warm-up
      // happens off the critical path.
      queueMicrotask(() => {
        warmTopImagesFromSnapshot(b64).catch(() => {});
      });
    }
    return b64;
  }, { lane, cacheTtl: BOARD_TTL });
}

// Synchronous peek for cold-load consumers (yboard.js).
export function peekBoardSnapshot(boardId) {
  if (!boardId) return null;
  return peek(`board:${boardId}`);
}

// Prefetch an image source. Resolves the URL (cheap, batched in
// r2.js) then `new Image().decode()`s it so the bytes land in the
// browser HTTP cache and are fully decoded before the visible
// `<img>` mounts.
export function prefetchImage(src, { lane = 'normal' } = {}) {
  if (!src || typeof src !== 'string') return Promise.resolve(null);
  return prefetch(`img:${src}`, async () => {
    const url = await resolveSrc(src);
    if (!url) return null;
    if (typeof Image === 'undefined') return url;
    const img = new Image();
    img.decoding = 'async';
    // fetchPriority is supported in Chromium-based browsers; harmless
    // on others (just ignored).
    try { img.fetchPriority = lane === 'high' ? 'high' : 'low'; } catch (_) {}
    const t0 = performance.now();
    img.src = url;
    try {
      await img.decode();
      const ms = (performance.now() - t0).toFixed(0);
      // Per-image timing is too chatty for the [prefetch] channel.
      // Gated behind window.__SOLEIL_PREFETCH_DEBUG_IMAGES__ for when
      // someone actually wants to inspect image-specific timing.
      if (typeof window !== 'undefined' && window.__SOLEIL_PREFETCH_DEBUG_IMAGES__) {
        console.log(`%c[prefetch] image decoded in ${ms}ms`, 'color:#a3854b', src.slice(0, 32));
      }
    } catch { /* unsupported / abort — bytes may still be cached */ }
    return url;
  }, { lane, cacheTtl: IMAGE_TTL });
}

// Entity-link prefetch — by kind. Most entity navigations resolve to
// a board snapshot fetch, so we route through prefetchBoard.
//
// For card/doc/group refs that don't carry boardId, we currently
// can't prefetch (would require a card_index roundtrip — defer until
// the user actually clicks). Most refs in practice DO carry boardId
// because they were minted from a known location.
export function prefetchEntity(ref, { lane = 'normal' } = {}) {
  if (!ref) return Promise.resolve(null);
  switch (ref.kind) {
    case 'board':
      return prefetchBoard(ref.id, { lane });
    case 'card':
    case 'doc':
    case 'docPos':
    case 'group':
      if (ref.boardId) return prefetchBoard(ref.boardId, { lane });
      return Promise.resolve(null);
    // message / user / url / tag → no expensive fetch on hover today.
    default:
      return Promise.resolve(null);
  }
}

// Clipboard payload prefetch. Walks the items, finds anything with a
// boardId or an r2: src, warms them. Called from clipboard.js when
// setClipboard runs so paste targets are warm on arrival.
export function prefetchClipboardPayload(items) {
  if (!Array.isArray(items) || !items.length) return;
  const seenBoards = new Set();
  const seenImages = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    // boardlink/board cards or items that originated from a board
    // and carry the boardId for back-navigation.
    if (item.boardId && !seenBoards.has(item.boardId)) {
      seenBoards.add(item.boardId);
      prefetchBoard(item.boardId, { lane: 'normal' });
    }
    if (typeof item.src === 'string' && item.src.startsWith('r2:') && !seenImages.has(item.src)) {
      seenImages.add(item.src);
      prefetchImage(item.src, { lane: 'normal' });
    }
  }
}

// Internal: find image refs in a board snapshot and prefetch up to N of
// them so the canvas paints with already-decoded bytes when the user clicks
// through.
//
// Runs on hover, so it must stay cheap (PERF-06): the snapshot is decoded in
// the preview worker (no worker → no warm-up, never a main-thread
// Y.applyUpdate), and what gets warmed is the preview tier the canvas will
// actually mount, never the original. Warming the original downloaded and
// decoded a 12 MP photo (~48 MB) per card on a mere hover, and once its URL
// was cached pickInitialTier preferred it over the preview on open.
async function warmTopImagesFromSnapshot(b64) {
  const job = decodeViaWorker(b64);
  if (!job) return;
  const { data } = await job;
  const picks = [];
  for (const c of (data && data.cards) || []) {
    if (picks.length >= 6) break;
    if (c && typeof c.src === 'string' && c.src.startsWith('r2:')) picks.push(c);
  }
  if (!picks.length) return;
  await primeImageMeta(picks.map(c => c.src.slice(3)));
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  for (const c of picks) {
    const key = c.src.slice(3);
    const variant = pickVariantKey(key, getMeta(key), (Number(c.w) || 320) * dpr);
    // No preview (a GIF, a row not yet backfilled): leave it to the canvas.
    if (!variant || variant === key) continue;
    prefetchImage(`r2:${variant}`, { lane: 'normal' });
  }
}
