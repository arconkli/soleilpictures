// Embedded cover art, read out of the audio file itself.
//
// The docs promised "cover art, when the file carries it" while nothing
// anywhere read a tag — covers could only ever be set by hand. This reads the
// three containers that actually carry one:
//
//   • ID3v2 APIC   (.mp3, and .aiff/.wav files that carry an ID3 chunk)
//   • FLAC PICTURE (.flac)
//   • MP4 `covr`   (.m4a, .mp4)
//
// Worth knowing before spending time here: loop and sample packs are
// overwhelmingly .wav and .aif, and NEITHER carries cover art — WAV has no
// standard picture chunk. This earns its keep on a producer's released tracks,
// not on their loops. It is bounded accordingly: head reads only, hard size
// caps, and every failure path returns null so the card simply has no cover.
//
// Pure byte-walking over ArrayBuffers — no DOM — so it is testable in node.

// Read at most this much looking for a tag. ID3 and FLAC put their metadata at
// the FRONT; MP4 may put `moov` at the end, which is why there is a tail read.
const HEAD_BYTES = 1024 * 1024;
const TAIL_BYTES = 2 * 1024 * 1024;

// An embedded cover larger than this is someone's mastering artwork, not a
// thumbnail. Refuse rather than push it through the upload pipeline.
const MAX_COVER_BYTES = 8 * 1024 * 1024;

const PICTURE_TYPE_FRONT_COVER = 3;

const ascii = (u8, off, len) => {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(u8[off + i]);
  return s;
};

const u32be = (u8, o) => ((u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3]) >>> 0;

// ID3 sizes are "syncsafe": 7 bits per byte, high bit always clear, so a size
// field can never contain a false frame sync.
const syncsafe = (u8, o) =>
  ((u8[o] & 0x7f) << 21) | ((u8[o + 1] & 0x7f) << 14) | ((u8[o + 2] & 0x7f) << 7) | (u8[o + 3] & 0x7f);

function mimeForImage(raw) {
  const m = String(raw || '').toLowerCase().trim();
  if (!m) return null;
  if (m === 'jpeg' || m === 'jpg' || m === '-->') return m === '-->' ? null : 'image/jpeg';
  if (m === 'png') return 'image/png';
  if (m.startsWith('image/')) return m;
  return null;
}

function extForMime(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'jpg';
}

// Prefer the front cover; otherwise take the first picture found.
function pickBest(found) {
  if (!found.length) return null;
  return found.find(p => p.pictureType === PICTURE_TYPE_FRONT_COVER) || found[0];
}

function ok(pic) {
  if (!pic || !pic.bytes || !pic.bytes.length) return null;
  if (pic.bytes.length > MAX_COVER_BYTES) return null;
  if (!pic.mime) return null;
  return { bytes: pic.bytes, mime: pic.mime, ext: extForMime(pic.mime) };
}

// ── ID3v2 ───────────────────────────────────────────────────────────────────

// Index of the next 0x00 (or 0x00 0x00 for UTF-16) terminator at or after `o`.
function findTerminator(u8, o, end, wide) {
  if (wide) {
    for (let i = o; i + 1 < end; i += 2) if (u8[i] === 0 && u8[i + 1] === 0) return i;
    return -1;
  }
  for (let i = o; i < end; i++) if (u8[i] === 0) return i;
  return -1;
}

export function readId3Picture(u8) {
  if (u8.length < 10 || ascii(u8, 0, 3) !== 'ID3') return null;
  const major = u8[3];
  const flags = u8[5];
  const tagSize = syncsafe(u8, 6);
  let o = 10;
  const end = Math.min(u8.length, 10 + tagSize);

  // Extended header: skip it. Its own size field is syncsafe in v2.4 and a
  // plain integer in v2.3 — a difference that silently mis-seeks if ignored.
  if (flags & 0x40) {
    if (o + 4 > end) return null;
    const extSize = major >= 4 ? syncsafe(u8, o) : u32be(u8, o);
    o += major >= 4 ? extSize : extSize + 4;
  }

  const idLen = major <= 2 ? 3 : 4;
  const sizeLen = major <= 2 ? 3 : 4;
  const flagLen = major <= 2 ? 0 : 2;
  const found = [];

  while (o + idLen + sizeLen + flagLen <= end) {
    const id = ascii(u8, o, idLen);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break;   // padding or garbage — done
    let size;
    if (major <= 2) size = (u8[o + 3] << 16) | (u8[o + 4] << 8) | u8[o + 5];
    else if (major >= 4) size = syncsafe(u8, o + 4);
    else size = u32be(u8, o + 4);
    const body = o + idLen + sizeLen + flagLen;
    if (size <= 0 || body + size > end) break;

    if (id === 'APIC' || id === 'PIC') {
      const bEnd = body + size;
      let p = body;
      const enc = u8[p++];
      const wide = enc === 1 || enc === 2;   // UTF-16 descriptions are 2-byte
      let mime;
      if (id === 'PIC') {
        // v2.2 stores a 3-character format code ("JPG"/"PNG"), not a mime.
        mime = mimeForImage(ascii(u8, p, 3));
        p += 3;
      } else {
        const t = findTerminator(u8, p, bEnd, false);
        if (t < 0) { o = body + size; continue; }
        mime = mimeForImage(ascii(u8, p, t - p));
        p = t + 1;
      }
      const pictureType = u8[p++];
      const dEnd = findTerminator(u8, p, bEnd, wide);
      if (dEnd < 0) { o = body + size; continue; }
      p = dEnd + (wide ? 2 : 1);
      if (mime && p < bEnd) found.push({ mime, pictureType, bytes: u8.slice(p, bEnd) });
    }
    o = body + size;
  }
  return ok(pickBest(found));
}

// ── FLAC ────────────────────────────────────────────────────────────────────

export function readFlacPicture(u8) {
  if (u8.length < 8 || ascii(u8, 0, 4) !== 'fLaC') return null;
  let o = 4;
  const found = [];
  while (o + 4 <= u8.length) {
    const last = (u8[o] & 0x80) !== 0;
    const type = u8[o] & 0x7f;
    const size = (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3];
    const body = o + 4;
    if (size < 0 || body + size > u8.length) break;
    if (type === 6) {          // METADATA_BLOCK_PICTURE
      let p = body;
      const pictureType = u32be(u8, p); p += 4;
      const mimeLen = u32be(u8, p); p += 4;
      if (p + mimeLen > body + size) break;
      const mime = mimeForImage(ascii(u8, p, mimeLen)); p += mimeLen;
      const descLen = u32be(u8, p); p += 4 + descLen;
      p += 16;                 // width, height, depth, colour count
      if (p + 4 > body + size) break;
      const dataLen = u32be(u8, p); p += 4;
      if (mime && dataLen > 0 && p + dataLen <= u8.length) {
        found.push({ mime, pictureType, bytes: u8.slice(p, p + dataLen) });
      }
    }
    if (last) break;
    o = body + size;
  }
  return ok(pickBest(found));
}

// ── MP4 / M4A ───────────────────────────────────────────────────────────────

// Walk sibling boxes in [start, end) looking for `type`. Returns the payload
// range, or null. `skip` handles `meta`, which — alone among these — carries a
// 4-byte version/flags field before its children.
function findBox(u8, start, end, type, skip = 0) {
  let o = start;
  while (o + 8 <= end) {
    const size = u32be(u8, o);
    const name = ascii(u8, o + 4, 4);
    // size 0 means "to end of file"; size 1 means a 64-bit size follows, which
    // only happens on boxes far larger than anything we read.
    const boxEnd = size === 0 ? end : o + size;
    if (size === 1) return null;
    if (boxEnd <= o || boxEnd > end) return null;
    if (name === type) return { start: o + 8 + skip, end: boxEnd };
    o = boxEnd;
  }
  return null;
}

export function readMp4Cover(u8) {
  const moov = findBox(u8, 0, u8.length, 'moov');
  if (!moov) return null;
  const udta = findBox(u8, moov.start, moov.end, 'udta');
  if (!udta) return null;
  const meta = findBox(u8, udta.start, udta.end, 'meta', 4);
  if (!meta) return null;
  const ilst = findBox(u8, meta.start, meta.end, 'ilst');
  if (!ilst) return null;
  const covr = findBox(u8, ilst.start, ilst.end, 'covr');
  if (!covr) return null;
  const data = findBox(u8, covr.start, covr.end, 'data');
  if (!data) return null;
  // data box: 4-byte version+flags (the flags say what the payload IS —
  // 13 = JPEG, 14 = PNG), then 4 reserved bytes, then the image.
  const typeFlags = u32be(u8, data.start) & 0x00ffffff;
  const p = data.start + 8;
  if (p >= data.end) return null;
  const mime = typeFlags === 14 ? 'image/png' : typeFlags === 13 ? 'image/jpeg' : sniffImage(u8, p);
  return ok({ mime, pictureType: PICTURE_TYPE_FRONT_COVER, bytes: u8.slice(p, data.end) });
}

// Last resort when a container does not declare the image type.
function sniffImage(u8, o) {
  if (u8[o] === 0xff && u8[o + 1] === 0xd8) return 'image/jpeg';
  if (u8[o] === 0x89 && ascii(u8, o + 1, 3) === 'PNG') return 'image/png';
  return null;
}

// ── Entry point ─────────────────────────────────────────────────────────────

// Try every parser against a buffer. Order does not matter — each checks its
// own magic — except MP4, which has none at offset 0.
export function readCoverFromBuffer(buf) {
  if (!buf || !buf.byteLength) return null;
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return readId3Picture(u8) || readFlacPicture(u8) || readMp4Cover(u8);
}

// Read embedded cover art from a local File. Resolves null on anything that
// isn't there or can't be parsed — the card just has no cover, which is what
// it had before.
export async function readEmbeddedCover(file) {
  if (!file || typeof file.slice !== 'function') return null;
  try {
    const head = new Uint8Array(await file.slice(0, Math.min(HEAD_BYTES, file.size || HEAD_BYTES)).arrayBuffer());
    const fromHead = readCoverFromBuffer(head);
    if (fromHead) return fromHead;
    // A non-faststart MP4 export puts `moov` at the END, so the head read
    // found nothing but a huge `mdat`. Only worth a second read for MP4.
    if (file.size > HEAD_BYTES && findBox(head, 0, head.length, 'ftyp')) {
      const tail = new Uint8Array(await file.slice(Math.max(0, file.size - TAIL_BYTES)).arrayBuffer());
      return readMp4Cover(tail);
    }
    return null;
  } catch (_) { return null; }
}
