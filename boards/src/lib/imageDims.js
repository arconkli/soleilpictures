// Read an image's pixel dimensions out of its header bytes.
//
// WHY THIS EXISTS. `/api/v1/uploads` writes straight to R2 from the Worker, and
// Workers have no image decoder — no `Image`, no canvas, no sharp. But the
// `images` row wants width and height, and so does the card: an image card
// created without them gets the generic 280×180 default and appears stretched
// until someone resizes it by hand. The browser path gets these from
// readImageDims() decoding the file; the edge has to read the header instead.
//
// Every format below states its dimensions in the first few dozen bytes, in a
// fixed place, so this is exact rather than approximate — it is the same number
// a decoder would produce, just without decoding.
//
// UNKNOWN IS A VALID ANSWER. HEIC and AVIF are ISOBMFF, where the dimensions
// live in an `ispe` box at the end of a nested box walk, and getting that wrong
// silently is worse than not knowing. Those return null, the caller stores null,
// and the card falls back to its default size. Callers must treat null as
// "no answer" and never as zero — a zero-width card is invisible.

const ascii = (b, o, s) => String.fromCharCode(...b.subarray(o, o + s.length)) === s;
const u16be = (b, o) => (b[o] << 8) | b[o + 1];
const u16le = (b, o) => b[o] | (b[o + 1] << 8);
const u24le = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32be = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

// A result is only returned if BOTH dimensions are sane. A header that parses to
// 0×0 means the parse was wrong, not that the image is empty.
const dims = (w, h) => (w > 0 && h > 0 && w <= 65535 && h <= 65535 ? { width: w, height: h } : null);

function pngDims(b) {
  // Signature, then the IHDR chunk is required by spec to come first: 8 bytes
  // signature + 4 length + 4 type, so width is at 16 and height at 20.
  if (b.length < 24) return null;
  if (!ascii(b, 12, 'IHDR')) return null;
  return dims(u32be(b, 16), u32be(b, 20));
}

function gifDims(b) {
  // Logical Screen Descriptor, immediately after the 6-byte signature.
  if (b.length < 10) return null;
  return dims(u16le(b, 6), u16le(b, 8));
}

function jpegDims(b) {
  // Walk the segment chain to a Start Of Frame. JPEG has no fixed offset — the
  // SOF can sit behind any amount of EXIF, ICC or thumbnail data, which is
  // exactly what a phone photo has a lot of.
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) { o++; continue; }          // resync past padding
    const marker = b[o + 1];
    if (marker === 0xff) { o++; continue; }        // fill byte
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { o += 2; continue; }
    const len = u16be(b, o + 2);
    if (len < 2) return null;                      // malformed
    // Every SOF variant lays out [precision][height:2][width:2] after the
    // length. DHT/DAC/SOS (c4/c8/cc) share the range and are NOT frames.
    const isSof = (marker >= 0xc0 && marker <= 0xcf)
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (o + 9 > b.length) return null;
      return dims(u16be(b, o + 7), u16be(b, o + 5));
    }
    if (marker === 0xda) return null;              // image data — no SOF found
    o += 2 + len;
  }
  return null;
}

function webpDims(b) {
  if (b.length < 30) return null;
  const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (chunk === 'VP8X') {
    // Extended: canvas size, stored minus one, 24-bit LE.
    return dims(u24le(b, 24) + 1, u24le(b, 27) + 1);
  }
  if (chunk === 'VP8 ') {
    // Lossy. The keyframe start code must be present or this is not a keyframe
    // and the offsets below mean something else.
    if (!(b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a)) return null;
    return dims(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;               // lossless signature byte
    // 14 bits each, minus one, packed across four bytes.
    const w = ((b[21] | (b[22] << 8)) & 0x3fff) + 1;
    const h = ((((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10))) & 0x3fff) + 1;
    return dims(w, h);
  }
  return null;
}

// bytes → { width, height } | null.
//
// Takes a Uint8Array. Only the head is ever read, so a caller streaming a large
// upload can hand over the first few KB rather than the whole file.
export function imageDimensions(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length < 10) return null;

  if (b[0] === 0x89 && ascii(b, 1, 'PNG')) return pngDims(b);
  if (ascii(b, 0, 'GIF8')) return gifDims(b);
  if (b[0] === 0xff && b[1] === 0xd8) return jpegDims(b);
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return webpDims(b);
  return null;                                     // HEIC/AVIF/TIFF/SVG → unknown
}

// The content types the API accepts, and the extension each one gets in R2.
//
// A closed list rather than a regex on `image/*`: the extension becomes part of
// the object key, and letting a caller name that is how you end up with a `.js`
// in a bucket that other things serve from. SVG is deliberately absent — it is a
// document that can carry script, not a picture, and it would be served from a
// domain where a session lives.
export const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
};

export function extensionFor(contentType) {
  return IMAGE_TYPES[String(contentType || '').toLowerCase().split(';')[0].trim()] || null;
}
