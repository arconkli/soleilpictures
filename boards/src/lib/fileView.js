// A picture of every photo, whatever its format.
//
// Browsers draw a handful of image formats: only Safari draws HEIC, TIFF and
// JPEG XL, and none draws OpenEXR, a camera's raw files or a Photoshop
// document. A card holding one of those said "Preview not available"
// everywhere else (raws and .psd were file cards with no picture at all). Now
// the converter (media/, on Fly) makes a VIEW of it, a WebP at up to VIEW_EDGE
// on its long side and a small one at VIEW_SM_EDGE, and the file's images row
// records them as its previews, so every surface that shows previews (cards,
// Files, Quick look, the lightbox, shared links) shows them. Download still
// gives the original, byte for byte. A raw's view is the JPEG its camera
// stored beside the sensor data (or the sensor data developed, when it stored
// none worth showing); a .psd's is the flattened picture Photoshop keeps
// beside the layers.
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
// Camera raws: Sony, Canon, Nikon, Fujifilm, Olympus/OM, Panasonic and Leica,
// Pentax, Samsung, Hasselblad, Phase One, Epson, Mamiya, Leaf, Minolta,
// Kodak, Sigma, GoPro, and every DNG.
export const RAW_EXTS = Object.freeze(['dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf',
  'rw2', 'rwl', 'pef', 'srw', '3fr', 'fff', 'iiq', 'erf', 'mef', 'mos', 'mrw', 'kdc', 'dcr', 'x3f', 'gpr']);
// Photoshop documents, and its large-document format.
export const PSD_EXTS = Object.freeze(['psd', 'psb']);
// Image formats that reach an image card (fileIngest classifyDropFile) and
// that some browser can't draw. AVIF, WebP, PNG, JPEG, GIF and BMP draw
// everywhere.
const VIEW_EXTS = new Set(['heic', 'heif', 'hif', 'tif', 'tiff', 'jxl', 'exr', 'jp2', 'j2k', 'jpf', 'jpx',
  ...RAW_EXTS, ...PSD_EXTS]);

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

// Formats no browser draws at all, Safari included: raws, Photoshop documents,
// OpenEXR. A picture of one never loads the original (a browser would fetch
// the whole file, twice, only to find it can't show it) and waits for its view.
const DRAWN_NOWHERE = new Set([...RAW_EXTS, ...PSD_EXTS, 'exr']);
export function drawsNowhere(key) {
  if (!viewKindOfKey(key)) return false;
  return DRAWN_NOWHERE.has(key.match(EXT_RE)[1].toLowerCase());
}

// The file a card shows that gets views, or '': an image card's, or a file
// card's, which turns into the picture card a drop makes now once its view is
// made (lib/fileViewClient.js viewFileCardPatch). A file card that's locked,
// or holds versions (whose files could be anything), stays a file card, so it
// asks for none.
export function viewKeyOfCard(card) {
  if (!card || card.pending) return '';
  const ref = card.kind === 'image' ? card.src
    : card.kind === 'file' && !card.locked && !(Array.isArray(card.versions) && card.versions.length) ? card.fileSrc
      : null;
  if (typeof ref !== 'string' || !ref.startsWith('r2:')) return '';
  return viewKindOfKey(ref.slice(3)) ? ref.slice(3) : '';
}

// The keys of an original's views, beside it in a previews/ folder.
export function viewKeys(key) {
  const s = String(key || '');
  const cut = s.lastIndexOf('/');
  const base = `${cut >= 0 ? s.slice(0, cut + 1) : ''}previews/${s.slice(cut + 1)}`;
  return { view: `${base}.view.webp`, sm: `${base}.view_sm.webp` };
}
