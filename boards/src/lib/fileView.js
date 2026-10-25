// A picture of every photo, whatever its format.
//
// Browsers draw a handful of image formats: only Safari draws HEIC, TIFF and
// JPEG XL, and none draws OpenEXR. A card holding one of those said "Preview
// not available" everywhere else. Now the converter (media/, on Fly) makes a
// VIEW of it, a WebP at up to VIEW_EDGE on its long side and a small one at
// VIEW_SM_EDGE, and the file's images row records them as its previews, so
// every surface that shows previews (cards, Files, Quick look, the lightbox,
// shared links) shows them. Download still gives the original, byte for byte.
//
// Views are named after their original, like the playable copies
// (lib/playCopy.js), but keep its extension, so a .heic and a .tif of the same
// name never share one:
//
//   <ws>/<name>.<ext>  →  <ws>/previews/<name>.<ext>.view.webp     the view
//                         <ws>/previews/<name>.<ext>.view_sm.webp  its small size
//
// Each has its own images row (retention-locked, no size), written by
// _file_view_finish (0661), which also makes them the original's
// preview_path and preview_sm_path when it has none. Under previews/ they
// never count toward storage, and the party's preview presign (which takes
// `<uuid>.webp` only) can't overwrite one. They go when their original does
// (forgetPlayCopies in worker-playCopy.js), and with a deleted workspace.
//
// Pure, no imports: the Worker, the converter box and the app share it.

// The view's long edge: a screen's worth, for the lightbox and Quick look,
// where it stands in for an original the browser can't draw.
export const VIEW_EDGE = 2048;
// The small one, the size the canvas shows a zoomed-out card at.
export const VIEW_SM_EDGE = 640;
// Ceilings on what the converter takes on. Over them the card says "Preview
// not available" and Download still gives the file. The docs quote these
// through {{fact:}}.
export const VIEW_MAX_BYTES = 1024 * 1024 * 1024;
export const VIEW_MAX_PIXELS = 300_000_000;

const EXT_RE = /\.([A-Za-z0-9]{1,8})$/;
const VIEW_RE = /\/previews\/[^/]+\.view(_sm)?\.webp$/i;
// Image formats that reach an image card (fileIngest classifyDropFile) and
// that some browser can't draw. AVIF, WebP, PNG, JPEG, GIF and BMP draw
// everywhere; PSD and camera raws become file cards.
const VIEW_EXTS = new Set(['heic', 'heif', 'hif', 'tif', 'tiff', 'jxl', 'exr', 'jp2', 'j2k', 'jpf', 'jpx']);

// True for a key the converter wrote as a view. Never an original.
export function isViewKey(key) {
  return typeof key === 'string' && VIEW_RE.test(key);
}

// 'image' when the converter makes views of this key's file, else null.
export function viewKindOfKey(key) {
  if (typeof key !== 'string' || !key || isViewKey(key) || key.includes('/previews/')) return null;
  const m = key.match(EXT_RE);
  return m && VIEW_EXTS.has(m[1].toLowerCase()) ? 'image' : null;
}

// The keys of an original's views, beside it in a previews/ folder.
export function viewKeys(key) {
  const s = String(key || '');
  const cut = s.lastIndexOf('/');
  const base = `${cut >= 0 ? s.slice(0, cut + 1) : ''}previews/${s.slice(cut + 1)}`;
  return { view: `${base}.view.webp`, sm: `${base}.view_sm.webp` };
}
