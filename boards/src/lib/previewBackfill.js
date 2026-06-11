// Whole-board preview self-heal. R2Image's lazy backfill only covers an image
// a writer scrolls into view WHILE it's still shown as the original; this
// sweep covers every image card on a board a writer opens, so an image whose
// upload-time variant generation failed (tab closed mid-upload, old client)
// heals on the next open instead of surviving as a multi-MB original forever.
// The bulk backlog is handled by the operator script
// (scripts/backfill-image-variants.mjs); this is the going-forward guard.
//
// Fired from CanvasSurface once per board open (writers only), a few seconds
// after the last card change so it never competes with first paint. Each job
// downloads the original (CORS-clean fetch via its signed URL — r2-cors.json
// allows GET from the app origin) and runs the SAME variant engine the upload
// path uses (generateAndUploadVariants: thumbhash + 1280/640 webp + the
// set_image_variant RPC). Everything is best-effort and RLS/authorization is
// enforced server-side; a viewer-role caller just gets a quiet RPC denial.

import { getMeta } from './imageMeta.js';
import { getSignedUrl } from './r2.js';
import { runGated } from './backfillGate.js';
import { importWithReload } from './lazyWithReload.js';

// One attempt per image key per session (success OR definitive failure),
// SHARED with R2Image's on-view backfill — a duplicate generation would
// orphan a retention-locked preview row that the R2 sweep can never reclaim.
// Cleared only by a page reload.
export const backfillAttempted = new Set();

// Conservative caps: this is a self-heal, not a migration. A board with more
// broken images than the cap heals over successive sessions. Kept small and
// late because the sweep's multi-MB original downloads compete with the
// interactive image fetches the user actually sees.
const MAX_PER_SWEEP = 6;
const START_DELAY_MS = 10000;
const MAX_BYTES = 25 * 1024 * 1024;
// Raster only: svg/audio/video rows also live in the images table (it doubles
// as the sign-reads allowlist), and a static preview would freeze a gif card.
const RASTER_RE = /\.(png|jpe?g|webp)$/i;

async function backfillOne(key, boardId) {
  const url = await getSignedUrl(key);
  if (!url) return;
  // priority:'low' keeps the multi-MB original download behind the user's
  // visible image fetches (Chromium honors it; other engines ignore unknown
  // RequestInit members, so it degrades to a normal fetch).
  const res = await fetch(url, { priority: 'low' });
  if (!res.ok) return;
  const len = parseInt(res.headers.get('content-length') || '0', 10);
  if (len > MAX_BYTES) { try { res.body?.cancel(); } catch (_) {} return; }
  const blob = await res.blob();
  if (blob.size > MAX_BYTES) return;
  // Same dynamic import as R2Image's backfill: keeps the canvas-encode path
  // out of the main bundle until a writer actually backfills something.
  const m = await importWithReload(() => import('./uploads.js'));
  await m.generateAndUploadVariants({
    workspaceId: key.split('/')[0],
    boardId,
    storagePath: key,
    imageSource: blob,
  });
}

// Schedule a sweep over a board's image keys. Returns a cancel function so the
// caller's effect cleanup can drop a pending sweep when the board changes (or
// cards keep changing — rescheduling debounces against active edits). Keys
// with no cached meta yet are skipped, not failed: the board-open meta prime
// almost always lands well within START_DELAY_MS, and a miss just retries on
// the next session.
export function scheduleBoardPreviewBackfill({ boardId, keys, enabled = true }) {
  if (!enabled || !boardId || !Array.isArray(keys) || keys.length === 0) return undefined;
  // Respect constrained connections — a sweep can download multi-MB originals,
  // which is exactly wrong on save-data mode or a 2G link.
  try {
    const c = navigator.connection;
    if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return undefined;
  } catch (_) {}
  const t = setTimeout(() => {
    let started = 0;
    for (const key of keys) {
      if (started >= MAX_PER_SWEEP) break;
      if (!key || backfillAttempted.has(key) || !RASTER_RE.test(key)) continue;
      const meta = getMeta(key);
      if (!meta || meta.previewKey) continue;
      backfillAttempted.add(key);
      started += 1;
      runGated(() => backfillOne(key, boardId));
    }
  }, START_DELAY_MS);
  return () => clearTimeout(t);
}
