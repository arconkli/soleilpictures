// A picture of every photo and every document, whatever its format.
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
// No browser shows a Word, PowerPoint, Excel, Keynote, Pages, Numbers or
// OpenDocument file either. A document's view is its first page, which its
// file card shows, and a PDF of its pages goes beside it for Quick look
// (LibreOffice on the converter makes both). Its card stays a file card.
//
// Views are named after their original, like the playable copies
// (lib/playCopy.js), but keep its extension, so a .heic and a .tif of the same
// name never share one:
//
//   <ws>/<name>.<ext>  →  <ws>/previews/<name>.<ext>.view.webp     the view
//                         <ws>/previews/<name>.<ext>.view_sm.webp  its small size
//                         <ws>/previews/<name>.<ext>.view.pdf      a document's pages
//
// Each has its own images row (retention-locked, no size), written by
// _file_view_finish (0661, 0662), which also makes the pictures the
// original's preview_path and preview_sm_path when it has none. Under
// previews/ they never count toward storage, and the party's preview presign
// (which takes `<uuid>.webp` only) can't overwrite one. They go when their
// original does (forgetPlayCopies in worker-playCopy.js), and with a deleted
// workspace.
//
// Pure, no imports: the Worker, the converter box and the app share it.

// The view's long edge: a screen's worth, for the lightbox and Quick look,
// where it stands in for an original the browser can't draw.
export const VIEW_EDGE = 2048;
// The small one, the size the canvas shows a zoomed-out card at.
export const VIEW_SM_EDGE = 640;
// Ceilings on what the converter takes on. Over them the card says "Preview
// not available" (a document's keeps its icon) and Download still gives the
// file. The docs quote these through {{fact:}}.
export const VIEW_MAX_BYTES = 1024 * 1024 * 1024;
export const VIEW_MAX_PIXELS = 300_000_000;
export const DOC_MAX_BYTES = 256 * 1024 * 1024;
// A document's PDF holds its first DOC_MAX_PAGES pages: a long spreadsheet
// prints to thousands.
export const DOC_MAX_PAGES = 200;

const EXT_RE = /\.([A-Za-z0-9]{1,8})$/;
const VIEW_RE = /\/previews\/[^/]+\.view(_sm)?\.webp$/i;
const VIEW_PDF_RE = /\/previews\/[^/]+\.view\.pdf$/i;
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
// Documents: Word, PowerPoint, Excel, Publisher and Visio (with their
// templates and macro-enabled kinds), Keynote, Pages and Numbers,
// OpenDocument and OpenOffice's older formats, RTF, WordPerfect and Works.
// PDFs are cards of their own, and text files show their text.
export const DOC_EXTS = Object.freeze([
  'doc', 'docx', 'docm', 'dot', 'dotx', 'dotm', 'odt', 'ott', 'rtf', 'wpd', 'wps', 'pages', 'sxw',
  'ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'ppsm', 'pot', 'potx', 'potm', 'odp', 'otp', 'key', 'sxi',
  'xls', 'xlsx', 'xlsm', 'xlsb', 'xlt', 'xltx', 'xltm', 'ods', 'ots', 'numbers', 'sxc',
  'vsd', 'vsdx', 'odg', 'otg', 'pub', 'sxd',
]);
const DOC_SET = new Set(DOC_EXTS);

// True for a key the converter wrote as a view (a picture). Never an
// original, and never a document's PDF.
export function isViewKey(key) {
  return typeof key === 'string' && VIEW_RE.test(key);
}

// True for a document's PDF the converter wrote.
export function isViewPdfKey(key) {
  return typeof key === 'string' && VIEW_PDF_RE.test(key);
}

// 'image' when the converter makes views of this key's photo, 'doc' when it
// makes a document's first page and PDF, else null.
export function viewKindOfKey(key) {
  if (typeof key !== 'string' || !key || isViewKey(key) || key.includes('/previews/')) return null;
  const m = key.match(EXT_RE);
  const ext = m ? m[1].toLowerCase() : '';
  if (VIEW_EXTS.has(ext)) return 'image';
  return DOC_SET.has(ext) ? 'doc' : null;
}

// Formats no browser draws at all, Safari included: raws, Photoshop documents,
// OpenEXR, and documents. A picture of one never loads the original (a
// browser would fetch the whole file, twice, only to find it can't show it)
// and waits for its view.
const DRAWN_NOWHERE = new Set([...RAW_EXTS, ...PSD_EXTS, 'exr']);
export function drawsNowhere(key) {
  const kind = viewKindOfKey(key);
  if (!kind) return false;
  return kind === 'doc' || DRAWN_NOWHERE.has(key.match(EXT_RE)[1].toLowerCase());
}

// A file card holding a photo that gets views, which turns into the picture
// card a drop makes now once its view is made (lib/fileViewClient.js
// viewFileCardPatch). One that's locked, or holds versions (whose files could
// be anything), stays a file card.
export function turnsIntoPicture(card) {
  if (!card || card.pending || card.kind !== 'file' || card.locked) return false;
  if (Array.isArray(card.versions) && card.versions.length) return false;
  const ref = card.fileSrc;
  return typeof ref === 'string' && ref.startsWith('r2:') && viewKindOfKey(ref.slice(3)) === 'image';
}

// The file a card shows that gets views, or '': an image card's photo, a
// file card's photo that turns into a picture (turnsIntoPicture), or a file
// card's document, whose first page the card shows.
export function viewKeyOfCard(card) {
  if (!card || card.pending) return '';
  const ref = card.kind === 'image' ? card.src : card.kind === 'file' ? card.fileSrc : null;
  if (typeof ref !== 'string' || !ref.startsWith('r2:')) return '';
  const key = ref.slice(3);
  const kind = viewKindOfKey(key);
  if (card.kind === 'image') return kind === 'image' ? key : '';
  return kind === 'doc' || turnsIntoPicture(card) ? key : '';
}

// The keys of an original's views, beside it in a previews/ folder. `pdf` is
// a document's.
export function viewKeys(key) {
  const s = String(key || '');
  const cut = s.lastIndexOf('/');
  const base = `${cut >= 0 ? s.slice(0, cut + 1) : ''}previews/${s.slice(cut + 1)}`;
  return { view: `${base}.view.webp`, sm: `${base}.view_sm.webp`, pdf: `${base}.view.pdf` };
}
