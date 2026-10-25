// Pure helpers for the converter's views of photos. Which files get a view,
// and what the views are called, is boards/src/lib/fileView.js, shared with
// the Worker. No I/O here, so node can test every rule.

// The decoder each format a view is made of must come through.
export const EXT_LOADERS = Object.freeze({
  heic: 'heifload', heif: 'heifload', hif: 'heifload',
  tif: 'tiffload', tiff: 'tiffload',
  jxl: 'jxlload',
  exr: 'openexrload',
  jp2: 'jp2kload', j2k: 'jp2kload', jpf: 'jp2kload', jpx: 'jp2kload',
});

// HEIF's major brands for still pictures (HEVC inside). AVIF is HEIF too, but
// every browser draws it, so it never needs a view.
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'mif2']);

// The decoder a file's first bytes call for, or null. EVERY FILE IS A
// STRANGER'S, and vips picks a loader from a file's content, not its name:
// a file whose first bytes are none of these never reaches vips at all, so
// a "photo.tif" that is really an SVG, a PDF or an ImageMagick script stays
// unread. (The image also ships without vips' ImageMagick, PDF and OpenSlide
// modules, and runs vips with untrusted loaders blocked.)
export function sniffLoader(head) {
  const b = head instanceof Uint8Array ? head : new Uint8Array(0);
  const at = (i, ...xs) => b.length >= i + xs.length && xs.every((x, j) => b[i + j] === x);
  if (at(0, 0x49, 0x49, 0x2a, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2a)
    || at(0, 0x49, 0x49, 0x2b, 0x00) || at(0, 0x4d, 0x4d, 0x00, 0x2b)) return 'tiffload';
  if (at(0, 0x76, 0x2f, 0x31, 0x01)) return 'openexrload';
  if (at(0, 0xff, 0x0a) || at(0, 0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a)) return 'jxlload';
  if (at(0, 0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a) || at(0, 0xff, 0x4f, 0xff, 0x51)) return 'jp2kload';
  if (at(4, 0x66, 0x74, 0x79, 0x70) && HEIF_BRANDS.has(String.fromCharCode(...b.subarray(8, 12)))) return 'heifload';
  return null;
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
