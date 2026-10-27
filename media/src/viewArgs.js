// Pure helpers for the converter's views of photos and documents. Which files
// get a view, and what the views are called, is boards/src/lib/fileView.js,
// shared with the Worker. No I/O here, so node can test every rule.

import { RAW_EXTS, PSD_EXTS, DOC_EXTS } from '../../boards/src/lib/fileView.js';

// The vips decoder each format vips reads itself must come through.
export const EXT_LOADERS = Object.freeze({
  heic: 'heifload', heif: 'heifload', hif: 'heifload',
  tif: 'tiffload', tiff: 'tiffload',
  jxl: 'jxlload',
  exr: 'openexrload',
  jp2: 'jp2kload', j2k: 'jp2kload', jpf: 'jp2kload', jpx: 'jp2kload',
});

// How a view of a file with this extension is made: 'vips' reads it itself;
// a 'raw' gives up the JPEG its camera stored, or LibRaw develops it
// (raw.js); a 'psd' gives up its flattened picture (psd.js); a 'doc' is
// printed by LibreOffice (doc.js). null: none.
export function decoderOf(ext) {
  const e = String(ext || '').toLowerCase();
  if (Object.hasOwn(EXT_LOADERS, e)) return 'vips';
  if (RAW_EXTS.includes(e)) return 'raw';
  if (PSD_EXTS.includes(e)) return 'psd';
  if (DOC_EXTS.includes(e)) return 'doc';
  return null;
}

// The decoders vips may use on the file a job downloaded. The JPEG a raw
// gives up and the TIFF LibRaw or the PSD reader writes are read with their
// own (makeViews' `loaders`), never a stranger's file.
export const SOURCE_LOADERS = Object.freeze(['heifload', 'tiffload', 'jxlload', 'openexrload', 'jp2kload']);

// HEIF's major brands for still pictures (HEVC inside). AVIF is HEIF too, but
// every browser draws it, so it never needs a view.
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'mif2']);

// The decoder a file's first bytes call for, or null. EVERY FILE IS A
// STRANGER'S, and vips picks a loader from a file's content, not its name:
// a file whose first bytes are none of the SOURCE_LOADERS never reaches vips
// at all, so a "photo.tif" that is really an SVG, a PDF or an ImageMagick
// script stays unread. (JPEG and PNG are told apart for the pictures made on
// this box, raw.js's from raws and doc.js's of a document's first page, which
// vips reads with its trusted decoders.) (The image also ships without vips'
// ImageMagick, PDF and OpenSlide modules, and runs vips with untrusted
// loaders blocked.)
export function sniffLoader(head) {
  const b = head instanceof Uint8Array ? head : new Uint8Array(0);
  const at = (i, ...xs) => b.length >= i + xs.length && xs.every((x, j) => b[i + j] === x);
  if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a)
    || at(0, 0x49, 0x49, 0x2b, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2b)) return 'tiffload';
  if (at(0, 0x76, 0x2f, 0x31, 0x01)) return 'openexrload';
  if (at(0, 0xff, 0x0a) || at(0, 0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a)) return 'jxlload';
  if (at(0, 0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a) || at(0, 0xff, 0x4f, 0xff, 0x51)) return 'jp2kload';
  if (at(4, 0x66, 0x74, 0x79, 0x70) && HEIF_BRANDS.has(String.fromCharCode(...b.subarray(8, 12)))) return 'heifload';
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpegload';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'pngload';
  return null;
}

// True when a file's first bytes are a camera raw's: TIFF-shaped (Sony,
// Nikon, Canon's .cr2, Pentax, Samsung, a DNG, ...), Olympus's and
// Panasonic's TIFF variants, Fujifilm's, Canon's .cr3 and .crw, Sigma's and
// Minolta's. exiftool and LibRaw see nothing else.
export function sniffRaw(head) {
  const b = head instanceof Uint8Array ? head : new Uint8Array(0);
  const at = (i, s) => b.length >= i + s.length && [...s].every((c, j) => b[i + j] === (typeof c === 'number' ? c : c.charCodeAt(0)));
  return at(0, ['I', 'I', 0x2a, 0]) || at(0, ['M', 'M', 0, 0x2a])
    || at(0, 'IIRO') || at(0, 'IIRS') || at(0, 'MMOR')
    || at(0, ['I', 'I', 'U', 0])
    || at(0, 'FUJIFILMCCD-RAW')
    || (at(4, 'ftyp') && at(8, 'crx '))
    || (at(0, 'II') && at(6, 'HEAPCCDR'))
    || at(0, 'FOVb')
    || at(0, [0, 'M', 'R', 'M']);
}

// True when a file's first bytes are a document's container: a ZIP (Word,
// PowerPoint and Excel since 2007, OpenDocument, Keynote, Pages and Numbers,
// Visio's .vsdx), an OLE2 compound file (their older formats, Publisher,
// Works), RTF, or WordPerfect's. LibreOffice opens far more (HTML, SVG, XML,
// plain text, pictures), some of which point at other files, so nothing else
// reaches it, whatever its name.
export function sniffDoc(head) {
  const b = head instanceof Uint8Array ? head : new Uint8Array(0);
  const at = (...xs) => b.length >= xs.length && xs.every((x, j) => b[j] === x);
  return at(0x50, 0x4b, 0x03, 0x04)
    || at(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)
    || at(0x7b, 0x5c, 0x72, 0x74, 0x66)
    || at(0xff, 0x57, 0x50, 0x43);
}

// True when a file's first bytes are a Photoshop document's (or a .psb's).
export function sniffPsd(head) {
  const b = head instanceof Uint8Array ? head : new Uint8Array(0);
  return b.length >= 6 && b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53
    && b[4] === 0 && (b[5] === 1 || b[5] === 2);
}

// libvips marks some decoders untrusted (not fuzzed against hostile files),
// and these three formats come only through one. A file whose bytes are one of
// them runs with that block off; every other run keeps it on. Either way vips
// runs as the unprivileged user, with no secrets, on bytes already checked.
const UNTRUSTED_LOADERS = new Set(['jxlload', 'openexrload', 'jp2kload']);

// The environment for a vips run on a file `loader` reads: the untrusted block
// unless the format needs it off, and two threads (the machine has two cores,
// and an upload may be running beside it).
export function vipsEnv(loader) {
  return UNTRUSTED_LOADERS.has(loader)
    ? { VIPS_CONCURRENCY: '2' }
    : { VIPS_BLOCK_UNTRUSTED: '1', VIPS_CONCURRENCY: '2' };
}

// vips thumbnail: at most `edge` on the long side and never enlarged, turned
// upright (it reads the orientation), in sRGB. `strip` is asked for, but the
// vips this image ships (8.14) still writes the original's EXIF into a WebP,
// camera, software and GPS included: stripWebpMetadata is what removes it.
export function thumbnailArgs(input, output, edge, quality) {
  return ['thumbnail', input, `${output}[Q=${quality},strip]`, String(edge),
    '--height', String(edge), '--size', 'down', '--export-profile', 'srgb'];
}

// The JPEG 2000 resolution level to decode for a view: the smallest one still
// at least `edge` on its long side (each level halves the last), never past
// the file's own levels. vips' thumbnail picks one far too small (a 4032-wide
// file came out 126 wide), so a view of one is decoded at this level first.
export function jp2kLevel(w, h, levels, edge) {
  let k = 0;
  while (k + 1 < levels && Math.ceil(Math.max(w, h) / 2 ** (k + 1)) >= edge) k += 1;
  return k;
}

const FOURCC = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
// VP8X's flags for the chunks dropped below: ICC profile, EXIF, XMP.
const META_CHUNKS = new Set(['ICCP', 'EXIF', 'XMP ']);
const META_FLAGS = 0x20 | 0x08 | 0x04;

// A WebP with its ICC profile, EXIF and XMP chunks removed and its header's
// flags to match: nothing about the camera, the software or the place leaves
// with a view. The picture is sRGB already, which is what a browser takes an
// untagged image to be. Throws on anything that is not a well-formed WebP.
export function stripWebpMetadata(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(0);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 20 || FOURCC(b, 0) !== 'RIFF' || FOURCC(b, 8) !== 'WEBP') throw new Error('not a WebP');
  const end = Math.min(b.length, 8 + view.getUint32(4, true));
  const kept = [];
  for (let i = 12; i < end;) {
    if (i + 8 > end) throw new Error('truncated WebP');
    const id = FOURCC(b, i);
    const size = view.getUint32(i + 4, true);
    const next = i + 8 + size + (size & 1);
    if (next > end + (size & 1)) throw new Error('truncated WebP');
    if (!META_CHUNKS.has(id)) {
      const chunk = b.slice(i, Math.min(next, end));
      if (id === 'VP8X') chunk[8] &= ~META_FLAGS;
      kept.push(chunk);
    }
    i = next;
  }
  const body = kept.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(12 + body);
  out.set(b.subarray(0, 12));
  new DataView(out.buffer).setUint32(4, 4 + body, true);
  let o = 12;
  for (const c of kept) { out.set(c, o); o += c.length; }
  return out;
}

// The original's size upright: the header's sides, laid the way the view
// lies (vips turned the view upright; a header may hold the stored shape).
export function uprightDims(w, h, view) {
  if (!view || !(view.w > 0) || !(view.h > 0) || view.w === view.h) return { w, h };
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  return view.h > view.w ? { w: short, h: long } : { w: long, h: short };
}
