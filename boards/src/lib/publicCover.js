// publicCover.js — which picture a public cluster's link preview is, and what
// the page may say about it.
//
// /api/public-thumb/<slug> is the og:image of /c/<slug> and the picture beside
// each example cluster on the search pages. A cover (public_boards.og_image_key)
// is a photo stored as it was uploaded, several megabytes at its largest, and it
// went out at that size. The app already keeps a share-sized WebP of a picture
// (images.preview_path, 1280 px on its longest edge, uploads.js and
// scripts/backfill-image-variants.mjs), and get_public_board_meta returns the
// cover's as `og_cover` (migration 0890). This module picks it, with the
// original as the fallback, and says the type and size of the pick so the
// og:image tags describe the bytes that are served.
//
// Pure: no bucket, no network. The Worker's handlePublicThumb and
// injectPublicBoard both read from here, so the tags and the bytes cannot
// disagree about which object is the cover.

const stripR2 = (k) => String(k || '').replace(/^r2:/, '');

const EXT_TYPE = { png: 'image/png', webp: 'image/webp', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', avif: 'image/avif' };
function typeOfKey(key) {
  const ext = (String(key).split('.').pop() || '').toLowerCase();
  return EXT_TYPE[ext] || null;
}

const dim = (v) => (Number.isInteger(v) && v > 0 && v < 100000 ? v : null);

// A preview is served only from where the app writes one: the same workspace
// folder as the original, under previews/, a .webp, no path tricks. The
// database answers with the same rule (0890); this is the second lock, because
// the picture goes out to anyone and preview_path is a column a workspace
// writer can stamp (set_image_variant).
export function isCoverPreviewKey(originalKey, previewKey) {
  const orig = stripR2(originalKey);
  const prev = stripR2(previewKey);
  const ws = orig.split('/')[0];
  if (!ws || !prev || prev === orig) return false;
  if (prev.includes('..') || prev.includes('//') || /[\s\\?#]/.test(prev)) return false;
  return prev.startsWith(`${ws}/previews/`) && /\.webp$/i.test(prev);
}

// The board's link-preview picture, from get_public_board_meta's answer.
//   { key, fallbackKey, type, width, height, version } or null when it has none.
// `key` is what to serve; `fallbackKey` the original to serve when `key` is not
// in the bucket (null when `key` is already the original). `type`, `width` and
// `height` describe `key`; any of them is null when it is not known, and the
// page then says nothing rather than something untrue.
export function publicCover(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const original = stripR2(meta.og_image_key);
  if (original) {
    const version = String(meta.updated_at || meta.thumb_updated_at || '');
    const c = meta.og_cover && typeof meta.og_cover === 'object' ? meta.og_cover : {};
    if (isCoverPreviewKey(original, c.preview_key)) {
      return {
        key: stripR2(c.preview_key), fallbackKey: original, type: 'image/webp',
        width: dim(c.preview_w), height: dim(c.preview_h), version,
      };
    }
    return {
      key: original, fallbackKey: null, type: typeOfKey(original),
      width: dim(c.w), height: dim(c.h), version,
    };
  }
  const thumb = stripR2(meta.thumb_key);
  if (!thumb) return null;
  // The app's own rendered thumbnail (renderThumbnail.js): WebP, 1200x675 since
  // thumb version 2 and 800x600 before it.
  const v2 = (meta.thumb_version || 0) >= 2;
  return {
    key: thumb, fallbackKey: null, type: 'image/webp',
    width: v2 ? 1200 : 800, height: v2 ? 675 : 600,
    version: String(meta.thumb_updated_at || meta.updated_at || ''),
  };
}

// Read the cover from the bucket: the share-sized copy first, the original when
// that copy is missing or unreadable. Answers { obj, key } or null.
export async function readPublicCover(bucket, cover) {
  if (!bucket || !cover?.key) return null;
  let obj = null;
  try { obj = await bucket.get(cover.key); } catch { obj = null; }
  if (obj) return { obj, key: cover.key };
  if (!cover.fallbackKey) return null;
  obj = await bucket.get(cover.fallbackKey);
  return obj ? { obj, key: cover.fallbackKey } : null;
}
