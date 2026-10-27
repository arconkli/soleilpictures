// Which entry of a zip-based design file is its picture, and how many bytes of
// the zip it takes to read it (zipJob.js asks for exactly those). Pure.
//
// Sketch, Adobe XD, Krita, OpenRaster, Procreate and Figma (since 2023) files
// are zips with a picture of the design inside. The picture is a small PNG or
// JPEG, however large the zip (a Procreate file is gigabytes of timelapse).

// The EOCD, its longest comment and the ZIP64 locator before it.
export const ZIP_TAIL_BYTES = 65557 + 20;
// A central directory over this isn't read (200k entries is a few tens of MB).
export const ZIP_CD_MAX_BYTES = 64 * 1024 * 1024;
// A picture entry over this, compressed or not, isn't taken out.
export const ENTRY_MAX_BYTES = 256 * 1024 * 1024;
// Most the box fetches of one zip in rounds, in all.
export const ZIP_FETCH_MAX_BYTES = 1024 * 1024 * 1024;
// Most byte ranges the zip reader may ask for in one round.
export const MAX_NEED_RANGES = 8;
// A picture inside a zip over this, compressed or not, is a file's tile on
// the zip's contact sheet, not a picture.
export const SHEET_PHOTO_MAX_BYTES = 64 * 1024 * 1024;

// A local header is 30 bytes and a name and extra field of up to 65535 each
// (the central directory's lengths for them can differ from the local's), then
// the data.
export function entryWindow(entry, size) {
  return [entry.offset, Math.min(size, entry.offset + 30 + 65535 * 2 + entry.compressedSize)];
}

// Each format's picture, best first.
export const DESIGN_PICTURES = Object.freeze({
  sketch: ['previews/preview.png'],
  xd: ['preview.png', 'thumbnail.png'],
  kra: ['mergedimage.png', 'preview.png'],
  ora: ['mergedimage.png', 'Thumbnails/thumbnail.png'],
  procreate: ['QuickLook/Thumbnail.png'],
  // A .procreate as the uploader stores it (boards/src/lib/fileView.js).
  procreat: ['QuickLook/Thumbnail.png'],
  fig: ['thumbnail.png'],
});

const usable = (e) => !e.dir && !(e.flags & 1) && e.size <= ENTRY_MAX_BYTES && e.compressedSize <= ENTRY_MAX_BYTES;

// The entry holding the design's picture: its format's own path first
// (case-insensitive), else the largest PNG or JPEG named like a preview or a
// thumbnail. Never a folder, an encrypted entry or one over ENTRY_MAX_BYTES.
export function designEntry(entries, ext) {
  const paths = DESIGN_PICTURES[String(ext || '').toLowerCase()];
  if (!paths) return null;
  const pool = entries.filter(usable);
  for (const want of paths) {
    const hit = pool.find((e) => e.path.toLowerCase() === want.toLowerCase());
    if (hit) return hit;
  }
  let best = null;
  for (const e of pool) {
    const base = e.path.slice(e.path.lastIndexOf('/') + 1).toLowerCase();
    if (!/\.(png|jpe?g)$/.test(base) || !/preview|thumb/.test(base)) continue;
    if (!best || e.size > best.size) best = e;
  }
  return best;
}
