// A minimal ZIP writer using the STORE method (no compression).
//
// No dependency on purpose. The whole reason bulk download exists here is
// sample packs, and audio is already compressed — DEFLATE on a folder of MP3s
// and 24-bit WAVs buys somewhere between nothing and a few percent, which is
// not worth ~40KB of bundle and a worker. A stored-entry zip is four record
// types and a CRC table.
//
// MEMORY is the real design constraint. A 500 MB pack must not be 500 MB of JS
// heap, so nothing here ever calls arrayBuffer() on a whole asset:
//   • each asset stays a Blob, which browsers back with disk-spilling blob
//     storage rather than the heap;
//   • its CRC-32 is computed incrementally off blob.stream() in 1 MB chunks,
//     so peak transient heap is one chunk, not one file;
//   • the archive is assembled as `new Blob([header, blob, header, blob, …])`,
//     an array of Blob HANDLES — the bytes are never copied through JS.
//
// Deliberately NOT Zip64. Zip64 is only needed past 4 GB or 65,535 entries,
// and implementing it to support a download we should refuse anyway is
// backwards — see ZIP_MAX_BYTES / ZIP_MAX_ENTRIES, which refuse with a message
// that names the actual numbers.

// A selection bigger than this is a sync, not a download, and both the browser
// and the tab have opinions about it. Stated to the user rather than enforced
// silently.
export const ZIP_MAX_BYTES = 500 * 1024 * 1024;
export const ZIP_MAX_ENTRIES = 500;

const CHUNK = 1024 * 1024;

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

// Incremental CRC-32. Seed with crc32Update(undefined, bytes) and carry the
// return value between chunks; crc32Final turns it into the stored value.
export function crc32Update(state, bytes) {
  const t = crcTable();
  let c = state === undefined ? 0xFFFFFFFF : state;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return c >>> 0;
}
export function crc32Final(state) {
  return ((state === undefined ? 0xFFFFFFFF : state) ^ 0xFFFFFFFF) >>> 0;
}
// One-shot, for tests and small buffers.
export function crc32(bytes) {
  return crc32Final(crc32Update(undefined, bytes));
}

// Stream a Blob through the CRC without ever holding it whole.
async function crcOfBlob(blob) {
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader();
    let state;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      state = crc32Update(state, value);
    }
    return crc32Final(state);
  }
  // Older WebViews with no Blob.stream: chunk with slice() rather than
  // materializing the whole file.
  let state;
  for (let off = 0; off < blob.size; off += CHUNK) {
    const buf = await blob.slice(off, Math.min(blob.size, off + CHUNK)).arrayBuffer();
    state = crc32Update(state, new Uint8Array(buf));
  }
  return crc32Final(state);
}

const utf8 = (s) => new TextEncoder().encode(s);

function writer(size) {
  const buf = new Uint8Array(size);
  const view = new DataView(buf.buffer);
  let o = 0;
  return {
    u16(v) { view.setUint16(o, v, true); o += 2; },
    u32(v) { view.setUint32(o, v >>> 0, true); o += 4; },
    bytes(b) { buf.set(b, o); o += b.length; },
    done() { return buf; },
  };
}

// MS-DOS date/time. Pre-1980 is unrepresentable, so clamp.
function dosDateTime(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date(0);
  const year = Math.max(1980, d.getFullYear());
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
  const dat = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: time & 0xFFFF, date: dat & 0xFFFF };
}

// Zip entry names: forward slashes only, no absolute or parent traversal, and
// no characters that would make the extracted file unopenable.
export function sanitizeEntryName(name, fallback = 'file') {
  let s = String(name || '').replace(/\\/g, '/');
  s = s.split('/').pop() || '';
  // Written with escapes rather than literal control bytes: a raw \x00 in a
  // character class is invisible in a diff and survives review unnoticed.
  s = s.replace(/[\x00-\x1f<>:"|?*]/g, '').replace(/^\.+/, '').trim();
  return s || fallback;
}

// "kick.wav" seen twice becomes "kick.wav" and "kick (2).wav". Extension-aware
// so the second copy still opens.
export function dedupeName(name, seen) {
  const base = sanitizeEntryName(name);
  if (!seen.has(base.toLowerCase())) { seen.add(base.toLowerCase()); return base; }
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : '';
  for (let n = 2; n < 10000; n++) {
    const cand = `${stem} (${n})${ext}`;
    if (!seen.has(cand.toLowerCase())) { seen.add(cand.toLowerCase()); return cand; }
  }
  const last = `${stem} (${seen.size})${ext}`;
  seen.add(last.toLowerCase());
  return last;
}

export class ZipLimitError extends Error {
  constructor(message, { entries = 0, bytes = 0 } = {}) {
    super(message);
    this.name = 'ZipLimitError';
    this.code = 'zip_too_large';
    this.entries = entries;
    this.bytes = bytes;
  }
}

// Build a zip from [{ name, blob }]. Returns a Blob.
//
// onProgress({ done, total, name }) fires as each entry's CRC completes, which
// is the only part that takes real time once the bytes are local.
export async function createStoreZip(entries, { onProgress = null, date = null } = {}) {
  const list = (entries || []).filter(e => e && e.blob);
  if (!list.length) throw new Error('Nothing to zip');
  if (list.length > ZIP_MAX_ENTRIES) {
    throw new ZipLimitError(
      `That is ${list.length} files — zip downloads are capped at ${ZIP_MAX_ENTRIES}.`,
      { entries: list.length });
  }
  const total = list.reduce((n, e) => n + (e.blob.size || 0), 0);
  if (total > ZIP_MAX_BYTES) {
    throw new ZipLimitError(
      `That is ${Math.round(total / 1024 / 1024)} MB — zip downloads are capped at ${Math.round(ZIP_MAX_BYTES / 1024 / 1024)} MB.`,
      { entries: list.length, bytes: total });
  }

  const { time, date: dosDate } = dosDateTime(date || new Date());
  const seen = new Set();
  const parts = [];
  const central = [];
  let offset = 0;

  for (let i = 0; i < list.length; i++) {
    const { name, blob } = list[i];
    const entryName = dedupeName(name || `file-${i + 1}`, seen);
    const nameBytes = utf8(entryName);
    const size = blob.size || 0;
    const crc = await crcOfBlob(blob);
    onProgress?.({ done: i + 1, total: list.length, name: entryName });

    // Local file header. Flag bit 11 marks the name as UTF-8, which is what
    // keeps a loop called "Café Pad.wav" extracting under its own name.
    const lh = writer(30 + nameBytes.length);
    lh.u32(0x04034b50);
    lh.u16(20);            // version needed
    lh.u16(0x0800);        // flags: UTF-8 name
    lh.u16(0);             // method: store
    lh.u16(time); lh.u16(dosDate);
    lh.u32(crc); lh.u32(size); lh.u32(size);
    lh.u16(nameBytes.length); lh.u16(0);
    lh.bytes(nameBytes);
    const lhBytes = lh.done();

    parts.push(lhBytes, blob);
    central.push({ entryName, nameBytes, crc, size, offset });
    offset += lhBytes.length + size;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const e of central) {
    const ch = writer(46 + e.nameBytes.length);
    ch.u32(0x02014b50);
    ch.u16(20);            // version made by
    ch.u16(20);            // version needed
    ch.u16(0x0800);        // flags: UTF-8 name
    ch.u16(0);             // method: store
    ch.u16(time); ch.u16(dosDate);
    ch.u32(e.crc); ch.u32(e.size); ch.u32(e.size);
    ch.u16(e.nameBytes.length); ch.u16(0); ch.u16(0);
    ch.u16(0);             // disk number start
    ch.u16(0);             // internal attrs
    ch.u32(0);             // external attrs
    ch.u32(e.offset);
    ch.bytes(e.nameBytes);
    const b = ch.done();
    parts.push(b);
    cdSize += b.length;
  }

  const eo = writer(22);
  eo.u32(0x06054b50);
  eo.u16(0); eo.u16(0);
  eo.u16(central.length); eo.u16(central.length);
  eo.u32(cdSize); eo.u32(cdStart);
  eo.u16(0);
  parts.push(eo.done());

  return new Blob(parts, { type: 'application/zip' });
}
