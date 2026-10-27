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
// OpenDocument file either. A document's view is its first page (a
// spreadsheet's, its first sheet's cells), which its file card shows at the
// page's shape, and a PDF of its pages goes beside it for Quick look
// (LibreOffice on the converter makes both). Its card stays a file card.
//
// Design files (Sketch, Figma, Adobe XD, Procreate, Krita, OpenRaster,
// Affinity's three, InDesign, Illustrator and EPS) keep a picture of
// themselves inside, which the converter takes out without opening the
// design: the card shows it at its shape and stays a file card, as a
// document's does.
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

const EXT_RE = /\.([A-Za-z0-9]{1,9})$/;
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
// Design files, each with a picture inside it (media/src/zipPick.js and
// media/src/design.js say where). The uploader keeps eight letters of an
// extension (lib/uploads.js, party/upload.ts), so a Procreate file is stored,
// and its card named, as a .procreat.
export const DESIGN_EXTS = Object.freeze(['sketch', 'fig', 'xd', 'procreate', 'procreat', 'kra', 'ora',
  'afdesign', 'afphoto', 'afpub', 'indd', 'ai', 'eps']);
const DESIGN_SET = new Set(DESIGN_EXTS);

// Archives: a zip's contact sheet of what is inside it, read by byte ranges
// (media/src/zipJob.js), and the names inside any other archive, listed from
// the whole file (media/src/view.js), up to ARCHIVE_LIST_MAX_BYTES.
export const ZIP_EXTS = Object.freeze(['zip']);
export const LISTED_EXTS = Object.freeze(['7z', 'rar', 'tar', 'tgz', 'gz', 'bz2', 'tbz', 'tbz2', 'xz', 'txz']);
export const ARCHIVE_LIST_MAX_BYTES = 1024 * 1024 * 1024;

// What the converter makes views of: a photo's ('image'), a document's first
// page and PDF ('doc'), a design file's picture ('design'), an archive's
// contact sheet or names ('archive').
export const VIEW_KINDS = Object.freeze(['image', 'doc', 'design', 'archive']);
export const isViewKind = (kind) => VIEW_KINDS.includes(kind);
// The kinds that stay file cards and show their picture.
export const CARD_VIEW_KINDS = Object.freeze(['doc', 'design']);
export const isCardViewKind = (kind) => CARD_VIEW_KINDS.includes(kind);

// A document's family, for the size its card first lands at and the glyph it
// wears: 'slides' (a deck), 'sheet' (a spreadsheet, whose picture is its first
// sheet's cells: media/src/doc.js) or 'page' (the rest, which print to pages).
// null for a file that isn't a document.
const SLIDE_EXTS = new Set(['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'ppsm', 'pot', 'potx', 'potm', 'odp', 'otp', 'key', 'sxi']);
const SHEET_EXTS = new Set(['xls', 'xlsx', 'xlsm', 'xlsb', 'xlt', 'xltx', 'xltm', 'ods', 'ots', 'numbers', 'sxc']);
export function docFamily(ext) {
  const e = String(ext || '').toLowerCase();
  if (!DOC_SET.has(e)) return null;
  return SLIDE_EXTS.has(e) ? 'slides' : SHEET_EXTS.has(e) ? 'sheet' : 'page';
}

// The size a new document's card lands at, before its first page is made: a
// page's (a PDF card's) or a slide's. A card still this size takes its page's
// own shape when the page comes (lib/fileViewClient.js viewFileCardPatch),
// and goes back to a file card's 240×150 when none will (noPageCardPatch).
export const DOC_DROP_PAGE = Object.freeze({ w: 300, h: 388 });
export const DOC_DROP_SLIDE = Object.freeze({ w: 400, h: 225 });
export function docDropSize(ext) {
  const family = docFamily(ext);
  return family === 'slides' ? DOC_DROP_SLIDE : family ? DOC_DROP_PAGE : null;
}

// The families a card draws from what the file says (FamilyFace.jsx on a
// card, FileStages.jsx in Quick look), named by extension first, then by
// type for a file with none. A document is one by its extension alone, as
// it always was, and so is a font, or by a font's type; an email is one by
// .eml or .msg, or by its type; a type of video, audio or image is never
// text: a .ts is a camera's as often as TypeScript, and a system that knows
// the camera's says video/mp2t.
export const CODE_EXTS = 'js jsx mjs cjs ts tsx py rb go rs c h cpp cc java kt swift sh bash zsh sql css scss html htm xml json yml yaml toml'.split(' ');
export const FAMILY_EXTS = Object.freeze({
  markdown: ['md', 'markdown', 'mdown', 'mkd'],
  table: ['csv', 'tsv'],
  subtitles: ['srt', 'vtt'],
  code: CODE_EXTS,
  text: 'txt text log ini env conf cfg nfo'.split(' '),
  font: ['ttf', 'otf', 'woff', 'woff2', 'ttc'],
  mail: ['eml', 'msg'],
});
export const DRAWN_FAMILIES = Object.keys(FAMILY_EXTS);
const FAMILY_OF = new Map(DRAWN_FAMILIES.flatMap((family) => FAMILY_EXTS[family].map((e) => [e, family])));
export const isDrawnFamily = (family) => DRAWN_FAMILIES.includes(family);

export function fileFamily(ext, mime = '') {
  const e = String(ext || '').toLowerCase();
  const m = String(mime || '').toLowerCase();
  if (DOC_SET.has(e)) return 'doc';
  // Before the type guard: an .eps arrives as image/x-eps, an .ora as image/openraster.
  if (DESIGN_SET.has(e)) return 'design';
  if (/^font\/|^application\/(x-)?font-/.test(m)) return 'font';
  if (m === 'message/rfc822' || m === 'application/vnd.ms-outlook') return 'mail';
  if (/^(video|audio|image)\//.test(m)) return null;
  const family = FAMILY_OF.get(e);
  if (family) return family;
  if (m === 'application/json' || m === 'application/xml') return 'code';
  return m.startsWith('text/') ? 'text' : null;
}

// A table is wider than it is tall, and so is a font's specimen; every
// other drawn page is a page.
export const TABLE_DROP = Object.freeze({ w: 400, h: 236 });
export const FONT_DROP = Object.freeze({ w: 320, h: 220 });
// A design file's card, until its picture is made (then it takes the picture's shape).
export const DESIGN_DROP = Object.freeze({ w: 320, h: 240 });

// The size a new file card lands at: its family's shape, so the card doesn't
// jump when its face arrives. Null: a file card's own 240 x 150.
export function fileDropSize(ext, mime = '') {
  const family = fileFamily(ext, mime);
  if (family === 'doc') return docDropSize(ext);
  if (family === 'table') return TABLE_DROP;
  if (family === 'font') return FONT_DROP;
  if (family === 'design') return DESIGN_DROP;
  return family ? DOC_DROP_PAGE : null;
}

// The extension of a stored file's key (or its "r2:" ref), lowercased, or ''.
export function extOfKey(key) {
  const m = String(key || '').match(EXT_RE);
  return m ? m[1].toLowerCase() : '';
}

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
// makes a document's first page and PDF, 'design' when it takes a design
// file's picture out of it, else null.
export function viewKindOfKey(key) {
  if (typeof key !== 'string' || !key || isViewKey(key) || key.includes('/previews/')) return null;
  const m = key.match(EXT_RE);
  const ext = m ? m[1].toLowerCase() : '';
  if (VIEW_EXTS.has(ext)) return 'image';
  if (DOC_SET.has(ext)) return 'doc';
  return DESIGN_SET.has(ext) ? 'design' : null;
}

// Formats no browser draws at all, Safari included: raws, Photoshop documents,
// OpenEXR, documents and design files. A picture of one never loads the original (a
// browser would fetch the whole file, twice, only to find it can't show it)
// and waits for its view.
const DRAWN_NOWHERE = new Set([...RAW_EXTS, ...PSD_EXTS, 'exr']);
export function drawsNowhere(key) {
  const kind = viewKindOfKey(key);
  if (!kind) return false;
  return kind !== 'image' || DRAWN_NOWHERE.has(key.match(EXT_RE)[1].toLowerCase());
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
// card's document or design file, whose picture the card shows.
export function viewKeyOfCard(card) {
  if (!card || card.pending) return '';
  const ref = card.kind === 'image' ? card.src : card.kind === 'file' ? card.fileSrc : null;
  if (typeof ref !== 'string' || !ref.startsWith('r2:')) return '';
  const key = ref.slice(3);
  const kind = viewKindOfKey(key);
  if (card.kind === 'image') return kind === 'image' ? key : '';
  return isCardViewKind(kind) || turnsIntoPicture(card) ? key : '';
}

// The keys of an original's views, beside it in a previews/ folder. `pdf` is
// a document's.
export function viewKeys(key) {
  const s = String(key || '');
  const cut = s.lastIndexOf('/');
  const base = `${cut >= 0 ? s.slice(0, cut + 1) : ''}previews/${s.slice(cut + 1)}`;
  return { view: `${base}.view.webp`, sm: `${base}.view_sm.webp`, pdf: `${base}.view.pdf` };
}
