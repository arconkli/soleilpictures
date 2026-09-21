// One download path for every card kind, on every surface.
//
// There were five hand-rolled copies of fetch → blob → createObjectURL →
// <a download> → click → revoke (two in CanvasSurface's context menu, one in
// DetailPanel, one in FileCard, one in PdfViewer), each with its own filename
// rule and its own failure behaviour. Three consequences, all of them real:
//
//   1. NONE of them worked inside the native Capacitor app. <a download> does
//      not save a file in an iOS/Android WebView — the tap did nothing at all.
//      exportDelivery.deliverFile has handled that since the document exports
//      shipped, by writing to the cache directory and presenting the OS share
//      sheet; no card download had ever been routed through it.
//   2. Audio and video had no download affordance anywhere except the cluster
//      browser's detail panel, and that one produced an EXTENSIONLESS file as
//      soon as anyone renamed the card — because audio cards kept the filename
//      in the editable `title` and carried no `fileName`.
//   3. Nothing logged consistently, so "do people download from public links"
//      was only answerable for images.
//
// Filename resolution is the interesting part and lives in assetFilename,
// which is pure and tested.

import { resolveSrc } from './r2.js';
import { deliverFile } from './exportDelivery.js';
import { downloadImage } from './imageExport.js';
import { createStoreZip, ZipLimitError, ZIP_MAX_BYTES, ZIP_MAX_ENTRIES } from './zipStore.js';
import { makeLimiter } from './asyncPool.js';
import { DOWNLOADABLE, assetSrcFor, assetFilename } from './cardAssetName.js';
import { logEvent } from './analytics.js';
import { EV } from './analyticsEvents.js';

export { ZipLimitError, ZIP_MAX_BYTES, ZIP_MAX_ENTRIES };

export {
  DOWNLOADABLE, assetSrcFor, assetFilename, zipNameFor,
} from './cardAssetName.js';

// True when an anonymous visitor is taking this on a public surface. Mirrors
// imageExport's own check — kept here so every kind reports it, not just
// images.
export function isPublicSurface() {
  try {
    const p = window.location.pathname;
    return p.startsWith('/share/') || p.startsWith('/c/');
  } catch (_) { return false; }
}

// Three cards at a time. R2 is not the bottleneck; the browser's per-host
// connection budget is, and saturating it makes the rest of the board stop
// loading its images while a pack downloads.
const FETCH_CONCURRENCY = 3;

// Fetch the bytes behind a card as a Blob. Blob, never arrayBuffer — the zip
// path depends on these staying out of the JS heap.
export async function fetchCardBlob(card, kind) {
  const src = assetSrcFor(card, kind);
  if (!src) return null;
  const url = await resolveSrc(src);
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return res.blob();
}

// Download ONE card.
//
// Images keep going through imageExport.downloadImage because it bakes photo
// adjustments into the file so what you get matches what is on the board; that
// behaviour has to survive this consolidation.
export async function downloadCardAsset(card, kind, { surface = null } = {}) {
  if (kind === 'image' && card?.src) {
    await downloadImage({ src: card.src, title: card.title || card.label || '', adjust: card.adjust });
    return true;
  }
  const src = assetSrcFor(card, kind);
  if (!src) return false;
  const name = assetFilename(card, kind);
  try {
    const blob = await fetchCardBlob(card, kind);
    if (!blob) return false;
    logEvent(EV.FILE_DOWNLOAD, { kind, is_public: isPublicSurface(), surface, bulk: false });
    await deliverFile(blob, name);
    return true;
  } catch (err) {
    // Last resort: hand the signed URL to the browser. Preserves what the PDF
    // and file menu items already did on a fetch failure.
    try {
      const url = await resolveSrc(src);
      if (url) { window.open(url, '_blank', 'noopener,noreferrer'); return true; }
    } catch (_) { /* fall through */ }
    throw err;
  }
}

// Bulk zip is web-only, on purpose.
//
// deliverFile on native writes through a FileReader as base64 — a 500 MB zip
// becomes ~667 MB of string in the JS heap and takes the app out. Refusing
// with a sentence that says what to do instead beats a crash.
export function bulkDownloadSupported() {
  try {
    // Capacitor sets this on the window; checking it here avoids importing
    // @capacitor/core into every surface that wants to show the button.
    return !(window.Capacitor?.isNativePlatform?.());
  } catch (_) { return true; }
}

// Download MANY cards as one zip. `cards` is [{ card, kind }].
//
// Returns { count, skipped } so the caller can tell the user when something in
// the selection had no bytes behind it (a note, an empty card) rather than
// silently shipping a smaller archive than they asked for.
export async function downloadCardAssets(cards, { zipName = 'download.zip', onProgress = null, surface = null } = {}) {
  const items = (cards || []).filter(it => it && DOWNLOADABLE.has(it.kind) && assetSrcFor(it.card, it.kind));
  const skipped = (cards || []).length - items.length;
  if (!items.length) return { count: 0, skipped };

  if (items.length > ZIP_MAX_ENTRIES) {
    throw new ZipLimitError(
      `That is ${items.length} files — zip downloads are capped at ${ZIP_MAX_ENTRIES}.`,
      { entries: items.length });
  }

  // Fetch into a fixed-size slot array so entry order matches selection order
  // regardless of which request finishes first.
  const slots = new Array(items.length).fill(null);
  const limit = makeLimiter(FETCH_CONCURRENCY);
  let fetched = 0;
  await Promise.all(items.map((it, i) => limit(async () => {
    const blob = await fetchCardBlob(it.card, it.kind);
    if (blob) slots[i] = { name: assetFilename(it.card, it.kind, { fallback: `file-${i + 1}` }), blob };
    fetched++;
    onProgress?.({ phase: 'fetch', done: fetched, total: items.length });
  })));

  const entries = slots.filter(Boolean);
  if (!entries.length) return { count: 0, skipped: (cards || []).length };

  const zip = await createStoreZip(entries, {
    onProgress: (p) => onProgress?.({ phase: 'pack', ...p }),
  });
  logEvent(EV.FILE_DOWNLOAD, {
    kind: 'zip', is_public: isPublicSurface(), surface, bulk: true, n: entries.length,
  });
  await deliverFile(zip, zipName);
  return { count: entries.length, skipped: skipped + (items.length - entries.length) };
}
