// Filenames for downloaded images. Pure, split out of imageExport.js (which
// reaches Supabase through r2.js) so node tests can pin it.

export const IMAGE_EXT_RE = /\.(jpe?g|jfif|png|gif|webp|avif|heic|heif|bmp|svg|tiff?|jxl)$/i;

// Safe download filename. `forceExt` overrides the extension (used when the
// baked blob is a PNG regardless of the source format).
export function filenameFor(s, t, forceExt) {
  let base = (t || '').toString().trim();
  if (!base) {
    const m = String(s || '').match(/([^/?#]+)(?:[?#]|$)/);
    base = m ? decodeURIComponent(m[1]) : 'image';
  }
  base = base.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
  // Kept files arrive with their own extension (fileIngest keeps the real
  // name), so the list covers what cameras and scanners write — a scan.tif
  // must not come down as scan.tif.jpg.
  if (forceExt) {
    base = base.replace(IMAGE_EXT_RE, '');
    return `${base}.${forceExt}`;
  }
  if (!IMAGE_EXT_RE.test(base)) base += '.jpg';
  return base;
}

// The extension a downloaded image's bytes actually are. A card with no kept
// filename downloads under its title, and that used to get ".jpg" whatever the
// bytes were, so a pasted PNG screenshot saved as "Hero frame.jpg" (MEDIA-18).
// The blob's type first; the storage key's own suffix when the type is
// missing or generic (R2 serves what the upload declared).
const TYPE_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif', 'image/heic': 'heic', 'image/heif': 'heif',
  'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/tiff': 'tif', 'image/jxl': 'jxl',
};
export function imageExtFor(type, src) {
  const t = String(type || '').toLowerCase().split(';')[0].trim();
  if (TYPE_EXT[t]) return TYPE_EXT[t];
  const m = String(src || '').split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i);
  const ext = m ? m[1].toLowerCase() : '';
  return IMAGE_EXT_RE.test(`x.${ext}`) ? (ext === 'jpeg' ? 'jpg' : ext) : null;
}

// The name a downloaded original gets: the title as given when it already
// ends in an image extension (a kept camera filename), otherwise the title
// with the extension of what the bytes are.
export function originalFilename(src, title, blobType) {
  const t = (title || '').toString().trim();
  if (t && IMAGE_EXT_RE.test(t)) return filenameFor(src, t);
  const ext = imageExtFor(blobType, src);
  return ext ? filenameFor(src, t, ext) : filenameFor(src, t);
}

