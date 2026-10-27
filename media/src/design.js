// Pictures inside the design files that aren't zips (the zip ones are
// zipPick.js's): Affinity's three keep PNGs inside their own container,
// InDesign keeps a small JPEG in its XMP, Illustrator is a PDF since CS (older
// ones are PostScript) and an EPS may carry a TIFF preview in a DOS binary
// header or an XMP thumbnail. These are finders over the bytes of the file,
// which designMain.js runs in a process of its own as the unprivileged user.
// Nothing is decoded here: what's found goes to vips (or pdftoppm) like any
// other picture. Pure.

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_MAX_BYTES = 64 * 1024 * 1024;
const PNG_MAX_SIGNATURES = 10_000;
// An XMP thumbnail is a small JPEG; its base64 is a third bigger.
const XMP_THUMB_MAX_CHARS = 16 * 1024 * 1024;

// Where the PNG starting at `at` ends (after IEND's CRC), by walking its
// chunks, or -1 when it doesn't hold together (cut short, not a PNG after all).
function pngEnd(buf, at) {
  let p = at + 8;
  if (p + 25 > buf.length || buf.readUInt32BE(p) !== 13 || buf.toString('latin1', p + 4, p + 8) !== 'IHDR') return -1;
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const next = p + 12 + len;
    if (next - at > PNG_MAX_BYTES || next > buf.length) return -1;
    if (type === 'IEND') return next;
    p = next;
  }
  return -1;
}

// The biggest complete PNG in the file, by its bytes: Affinity stores a small
// thumbnail and larger previews among its own data. { start, end } or null.
export function largestPng(buf) {
  let best = null;
  let at = 0;
  for (let seen = 0; seen < PNG_MAX_SIGNATURES; seen++) {
    at = buf.indexOf(PNG_SIG, at);
    if (at < 0) break;
    const end = pngEnd(buf, at);
    if (end < 0) { at += 8; continue; }
    if (!best || end - at > best.end - best.start) best = { start: at, end };
    at = end;
  }
  return best;
}

// The JPEG in an XMP packet's <xmpGImg:image>, as the element or as an
// attribute: base64, with the line breaks XMP writes as &#xA; and &#xD;.
// Bytes starting FF D8 FF, or null.
export function xmpThumbnail(buf) {
  const tag = Buffer.from('xmpGImg:image');
  let at = 0;
  for (let seen = 0; seen < 100; seen++) {
    at = buf.indexOf(tag, at);
    if (at < 0) return null;
    const after = at + tag.length;
    at = after;
    let from;
    let to;
    if (buf[after - tag.length - 1] === 0x3c /* < */ && buf[after] === 0x3e /* > */) {
      from = after + 1;
      to = buf.indexOf('</xmpGImg:image>', from);
    } else if (buf[after] === 0x3d /* = */ && (buf[after + 1] === 0x22 || buf[after + 1] === 0x27)) {
      from = after + 2;
      to = buf.indexOf(buf[after + 1], from);
    } else {
      continue;
    }
    if (to < 0 || to - from > XMP_THUMB_MAX_CHARS) continue;
    const text = buf.toString('latin1', from, to).replace(/&#x?[0-9a-f]+;|\s+/gi, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) continue;
    const bytes = Buffer.from(text, 'base64');
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return bytes;
  }
  return null;
}

// An EPS in a DOS binary header (C5 D0 D3 C6) points at a TIFF preview: its
// offset at byte 20 and length at 24, little-endian. { start, end } or null.
export function dosEpsTiff(buf) {
  if (buf.length < 30 || buf.readUInt32BE(0) !== 0xc5d0d3c6) return null;
  const start = buf.readUInt32LE(20);
  const len = buf.readUInt32LE(24);
  if (len < 8 || start < 30 || start + len > buf.length) return null;
  const magic = buf.toString('latin1', start, start + 4);
  if (magic !== 'II*\0' && magic !== 'MM\0*') return null;
  return { start, end: start + len };
}

const AFFINITY_EXTS = new Set(['afdesign', 'afphoto', 'afpub']);

// What picture a design file holds: { kind: 'pdf' } (an Illustrator file that
// is a PDF, whose first page pdftoppm draws), a span of the file ('png',
// 'jpeg', 'tiff'), JPEG bytes lifted out of the XMP, or null.
export function designPictureOf(buf, ext) {
  const e = String(ext || '').toLowerCase();
  const xmp = () => {
    const bytes = xmpThumbnail(buf);
    return bytes ? { kind: 'jpeg', bytes } : null;
  };
  if (e === 'ai') return buf.toString('latin1', 0, 4) === '%PDF' ? { kind: 'pdf' } : xmp();
  if (e === 'eps') {
    const tiff = dosEpsTiff(buf);
    return tiff ? { kind: 'tiff', ...tiff } : xmp();
  }
  if (e === 'indd') return xmp();
  if (AFFINITY_EXTS.has(e)) {
    const png = largestPng(buf);
    return png ? { kind: 'png', ...png } : xmp();
  }
  return null;
}
