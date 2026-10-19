// A dependency-free ZIP reader for the browser. The counterpart of zipStore.js.
//
// Users drop a Google Takeout / Google Drive "Download" / Dropbox download zip,
// often several multi-GB parts, and its folders become nested folders in the
// app. The bytes of a 20 GB export must never be JS heap, so the design is the
// mirror image of zipStore's:
//   • the archive stays a Blob (a File from the picker is disk-backed). Nothing
//     here ever calls arrayBuffer() on a whole zip or a whole entry;
//   • the central directory is read with blob.slice() in pieces of at most 8 MB
//     and parsed incrementally, carrying a header that straddles a piece
//     boundary into the next read. A 200k-entry Takeout is a few tens of MB of
//     directory, never held whole as one buffer;
//   • openEntry() for a STORED entry is `blob.slice(...)`: a Blob handle, zero
//     bytes through JS and no CRC pass (re-hashing multi-GB videos would cost
//     more than the import). A DEFLATEd entry goes through the platform's own
//     DecompressionStream('deflate-raw'), with the CRC computed per chunk, and
//     the chunks are folded into Blobs every ~8 MB so the heap holds one
//     window, not one file;
//   • the declared size from the central directory is a hard ceiling while
//     inflating. A zip bomb declares 1 KB and inflates to 4 GB; we cancel the
//     stream the moment the count passes the declared size.
//
// Sizes always come from the central directory, never the local header: an
// entry written by a streaming writer has zeros there and the real numbers in
// a trailing data descriptor. The local header is read only for its two
// length fields, which is where the data actually starts.
//
// ZIP64 is supported (Takeout parts are 2-50 GB), read-only. Encrypted entries
// and methods other than STORE / DEFLATE are counted and skipped, not guessed
// at. Entry names are sanitized on the way in: a name is data from a stranger.

import { crc32Update, crc32Final } from './zipStore.js';

// Largest piece of the central directory read in one go.
const PIECE_BYTES = 8 * 1024 * 1024;
// The EOCD is 22 bytes plus a comment of up to 65,535 bytes.
const EOCD_SCAN = 65557;
// Heap window while inflating: fold pending chunks into a Blob this often.
const FOLD_BYTES = 8 * 1024 * 1024;

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export class ZipReadError extends Error {
  // code: 'not_zip' | 'truncated' | 'too_big' | 'crc' | 'no_inflate'
  constructor(code, message) {
    super(message || code);
    this.name = 'ZipReadError';
    this.code = code;
  }
}

// Whether this browser can inflate. DecompressionStream('deflate-raw') is the
// whole reason there is no inflate implementation in this file; an old WebView
// without it can still import STORED entries and is told so for the rest.
export function canInflate() {
  try {
    if (typeof DecompressionStream !== 'function') return false;
    new DecompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
}

// IBM code page 437, bytes 0x80-0xFF. Zips written without the UTF-8 flag
// (older Windows tools, some NAS exports) use it; below 0x80 it is ASCII.
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' +
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeCp437(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    s += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  }
  return s;
}

// A 64-bit little-endian value as a JS number. Past 2^53 it cannot be held
// exactly, and an offset we cannot represent is an offset we cannot trust.
function u64(view, o) {
  const lo = view.getUint32(o, true);
  const hi = view.getUint32(o + 4, true);
  const v = hi * 4294967296 + lo;
  if (hi > 0x1FFFFF || v > Number.MAX_SAFE_INTEGER) {
    throw new ZipReadError('too_big', 'ZIP64 value is larger than this browser can address.');
  }
  return v;
}

async function readRange(blob, start, end) {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

const viewOf = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// Zip entry names are untrusted. Backslashes become slashes, then empty, "."
// and ".." segments are dropped (so "../../etc/passwd" can only ever be
// "etc/passwd"), control characters are stripped. Escapes rather than literal
// control bytes in the class, as in zipStore.js.
function sanitizePath(raw) {
  const segs = [];
  for (const seg of String(raw).replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.' || seg === '..') continue;
    const clean = seg.replace(/[\x00-\x1f]/g, '').trim();
    if (clean === '' || clean === '.' || clean === '..') continue;
    segs.push(clean);
  }
  return segs.join('/');
}

function dosToMs(date, time) {
  const ms = new Date(
    1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31,
    time >> 11, (time >> 5) & 63, (time & 31) * 2,
  ).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

// Parse the extra field. Returns the ZIP64 values (only those present) and the
// extended-timestamp mtime if there is one.
function parseExtra(bytes, view, start, end, want) {
  const out = { size: null, compressedSize: null, offset: null, mtime: null };
  let p = start;
  while (p + 4 <= end) {
    const id = view.getUint16(p, true);
    const len = view.getUint16(p + 2, true);
    const body = p + 4;
    if (body + len > end) break;
    if (id === 0x0001) {
      // Holds ONLY the fields whose 32-bit value was 0xFFFFFFFF, in this order.
      let q = body;
      if (want.size && q + 8 <= body + len) { out.size = u64(view, q); q += 8; }
      if (want.compressedSize && q + 8 <= body + len) { out.compressedSize = u64(view, q); q += 8; }
      if (want.offset && q + 8 <= body + len) { out.offset = u64(view, q); q += 8; }
    } else if (id === 0x5455 && len >= 5 && (bytes[body] & 1)) {
      out.mtime = view.getUint32(body + 1, true) * 1000;
    }
    p = body + len;
  }
  return out;
}

// Parse the central-directory header at bytes[p]; the caller has already
// checked the whole record is in the buffer. Returns null for an entry that
// is skipped (counted into `skipped` or left out silently).
function parseHeader(bytes, view, p, skipped) {
  const flags = view.getUint16(p + 8, true);
  const method = view.getUint16(p + 10, true);
  const time = view.getUint16(p + 12, true);
  const date = view.getUint16(p + 14, true);
  const crc32 = view.getUint32(p + 16, true);
  let compressedSize = view.getUint32(p + 20, true);
  let size = view.getUint32(p + 24, true);
  const nameLen = view.getUint16(p + 28, true);
  const extraLen = view.getUint16(p + 30, true);
  let offset = view.getUint32(p + 42, true);

  const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
  const extraStart = p + 46 + nameLen;
  const extra = parseExtra(bytes, view, extraStart, extraStart + extraLen, {
    size: size === 0xFFFFFFFF,
    compressedSize: compressedSize === 0xFFFFFFFF,
    offset: offset === 0xFFFFFFFF,
  });
  if (extra.size !== null) size = extra.size;
  if (extra.compressedSize !== null) compressedSize = extra.compressedSize;
  if (extra.offset !== null) offset = extra.offset;

  // Bit 11: UTF-8. Otherwise CP437, which is what the spec says an unflagged
  // name is (not "whatever the machine's locale was").
  const rawName = (flags & 0x800)
    ? new TextDecoder('utf-8').decode(nameBytes)
    : decodeCp437(nameBytes);
  const dir = /[\\/]$/.test(rawName);
  const path = sanitizePath(rawName);
  if (!path) return null;

  // A directory entry carries no data, so there is nothing to refuse.
  if (!dir) {
    if (flags & 1) { skipped.encrypted++; return null; }
    if (method !== 0 && method !== 8) { skipped.unsupported++; return null; }
  }

  const lastModified = extra.mtime ?? dosToMs(date, time);
  return { path, dir, method, compressedSize, size, crc32, offset, flags, lastModified };
}

// Read the central directory of `blob`. `pieceBytes` is the read granularity
// (default 8 MB); tests lower it to exercise a header straddling two reads.
export async function readZipDirectory(blob, { onProgress, pieceBytes = PIECE_BYTES } = {}) {
  const total = blob.size;
  if (total < 22) throw new ZipReadError('not_zip', 'Not a zip file.');

  // Find the EOCD in the tail (plus the 20 bytes before it, for the ZIP64 locator).
  const tailStart = Math.max(0, total - EOCD_SCAN - 20);
  const tail = await readRange(blob, tailStart, total);
  const tv = viewOf(tail);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) !== SIG_EOCD) continue;
    // A comment may itself contain the signature; the real record's comment
    // length must fit in what remains.
    if (i + 22 + tv.getUint16(i + 20, true) <= tail.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipReadError('not_zip', 'Not a zip file.');

  let entryCount = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);

  const hasLocator = eocd >= 20 && tv.getUint32(eocd - 20, true) === SIG_ZIP64_LOCATOR;
  const saturated = entryCount === 0xFFFF || cdSize === 0xFFFFFFFF || cdOffset === 0xFFFFFFFF;
  let zip64 = false;
  if (hasLocator || saturated) {
    if (!hasLocator) throw new ZipReadError('truncated', 'ZIP64 locator is missing.');
    const recAt = u64(tv, eocd - 20 + 8);
    if (recAt + 56 > total) throw new ZipReadError('truncated', 'ZIP64 record is past the end of the file.');
    const rec = await readRange(blob, recAt, recAt + 56);
    const rv = viewOf(rec);
    if (rv.getUint32(0, true) !== SIG_ZIP64_EOCD) throw new ZipReadError('truncated', 'ZIP64 record is damaged.');
    entryCount = u64(rv, 32);
    cdSize = u64(rv, 40);
    cdOffset = u64(rv, 48);
    zip64 = true;
  }
  if (cdOffset + cdSize > total) throw new ZipReadError('truncated', 'Central directory is past the end of the file.');

  const entries = [];
  const skipped = { encrypted: 0, unsupported: 0 };
  const end = cdOffset + cdSize;
  let pos = cdOffset;
  let carry = new Uint8Array(0);

  while (pos < end || carry.length) {
    let buf = carry;
    if (pos < end) {
      const n = Math.min(Math.max(1, pieceBytes), end - pos);
      const piece = await readRange(blob, pos, pos + n);
      pos += n;
      if (carry.length) {
        buf = new Uint8Array(carry.length + piece.length);
        buf.set(carry, 0);
        buf.set(piece, carry.length);
      } else {
        buf = piece;
      }
    }
    const view = viewOf(buf);
    let p = 0;
    for (;;) {
      if (buf.length - p < 46) break;
      if (view.getUint32(p, true) !== SIG_CENTRAL) {
        throw new ZipReadError('truncated', 'Central directory is damaged.');
      }
      const len = 46 + view.getUint16(p + 28, true) + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
      if (p + len > buf.length) break;
      const entry = parseHeader(buf, view, p, skipped);
      p += len;
      if (entry) {
        entries.push(entry);
        if (entries.length % 1000 === 0) onProgress?.({ entries: entries.length });
      }
    }
    // slice(), not subarray(): the carry must not pin the whole 8 MB piece.
    carry = buf.slice(p);
    if (pos >= end) {
      // The directory ended mid-header.
      if (carry.length) throw new ZipReadError('truncated', 'Central directory ends mid-entry.');
      break;
    }
  }
  onProgress?.({ entries: entries.length });
  return { entries, skipped, zip64 };
}

// The bytes of one entry as a Blob. See the header for why STORE is a slice.
export async function openEntry(blob, entry) {
  if (blob.size < entry.offset + 30) throw new ZipReadError('truncated', 'Entry header is past the end of the file.');
  const head = await readRange(blob, entry.offset, entry.offset + 30);
  const hv = viewOf(head);
  if (hv.getUint32(0, true) !== SIG_LOCAL) throw new ZipReadError('truncated', 'Entry header is damaged.');
  const start = entry.offset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);

  if (entry.method === 0) {
    if (start + entry.size > blob.size) throw new ZipReadError('truncated', 'Entry data is past the end of the file.');
    return blob.slice(start, start + entry.size);
  }

  if (!canInflate()) throw new ZipReadError('no_inflate', 'This browser cannot decompress zip entries.');
  if (start + entry.compressedSize > blob.size) throw new ZipReadError('truncated', 'Entry data is past the end of the file.');

  const reader = blob
    .slice(start, start + entry.compressedSize)
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();

  const parts = [];
  let pending = [];
  let pendingBytes = 0;
  let count = 0;
  let crc;
  try {
    for (;;) {
      let r;
      try {
        r = await reader.read();
      } catch (e) {
        // The platform inflater rejects on a stream that ends early or is not
        // deflate at all.
        throw new ZipReadError('truncated', 'Entry data is damaged or incomplete.');
      }
      if (r.done) break;
      const chunk = r.value;
      count += chunk.length;
      if (count > entry.size) {
        // Never inflate past the declared size.
        await reader.cancel().catch(() => {});
        throw new ZipReadError('too_big', 'Entry inflates to more than its declared size.');
      }
      crc = crc32Update(crc, chunk);
      pending.push(chunk);
      pendingBytes += chunk.length;
      if (pendingBytes >= FOLD_BYTES) {
        parts.push(new Blob(pending));
        pending = [];
        pendingBytes = 0;
      }
    }
  } finally {
    reader.releaseLock?.();
  }
  if (count < entry.size) throw new ZipReadError('truncated', 'Entry is shorter than its declared size.');
  if (crc32Final(crc) !== entry.crc32) throw new ZipReadError('crc', 'Entry failed its checksum.');
  return new Blob([...parts, ...pending]);
}

const MEDIA_EXT = /\.(jpe?g|png|heic|gif|webp|mp4|mov)$/i;
const SIDECAR_SUFFIX = '.supplemental-metadata';

// Google Photos writes "IMG_1.jpg.supplemental-metadata.json" next to each
// photo, with the suffix truncated to fit a filename limit
// ("IMG_1.jpg.supplemen.json"). They are metadata, not the user's files.
function isSidecar(segs) {
  const base = segs[segs.length - 1];
  if (!/\.json$/i.test(base)) return false;
  if (segs.slice(0, -1).includes('Google Photos')) return true;
  let stem = base.slice(0, -5);
  const dot = stem.lastIndexOf('.');
  if (dot >= 0) {
    const tailPart = stem.slice(dot).toLowerCase();
    if (tailPart.length > 1 && SIDECAR_SUFFIX.startsWith(tailPart)) stem = stem.slice(0, dot);
  }
  return MEDIA_EXT.test(stem);
}

function isJunkName(base) {
  const lower = base.toLowerCase();
  return base.startsWith('._') || lower === '.ds_store' || lower === 'thumbs.db' || lower === 'desktop.ini';
}

// Pre-order: a parent always precedes its children and a subtree is contiguous.
function compareSegments(a, b) {
  const as = a.split('/');
  const bs = b.split('/');
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    if (as[i] !== bs[i]) return as[i] < bs[i] ? -1 : 1;
  }
  return as.length - bs.length;
}

// Merge the listings of several parts of one export into a single tree.
// listings: [{ name, entries }] (entries from readZipDirectory).
export function mergeArchives(listings) {
  const dropped = { macosx: 0, sidecars: 0, junk: 0, duplicates: 0 };
  let files = [];
  let dirPaths = [];
  const seen = new Set();

  listings.forEach((listing, zip) => {
    for (const entry of listing.entries || []) {
      const segs = entry.path.split('/');
      if (entry.dir) {
        // Empty-folder markers. Junk folders never become app folders, and
        // aren't counted: they are not files.
        if (!segs.includes('__MACOSX')) dirPaths.push(entry.path);
        continue;
      }
      if (seen.has(entry.path)) { dropped.duplicates++; continue; }
      seen.add(entry.path);
      if (segs.includes('__MACOSX')) { dropped.macosx++; continue; }
      if (isJunkName(segs[segs.length - 1])) { dropped.junk++; continue; }
      if (isSidecar(segs)) { dropped.sidecars++; continue; }
      files.push({ relPath: entry.path, size: entry.size, lastModified: entry.lastModified, zip, entry });
    }
  });

  // Strip a prefix from every file and every folder marker. A folder marker
  // outside the prefix, or the prefix itself, is not part of the tree.
  const strip = (prefix) => {
    files = files.map((f) => ({ ...f, relPath: f.relPath.slice(prefix.length + 1) }));
    dirPaths = dirPaths
      .filter((d) => d.startsWith(prefix + '/'))
      .map((d) => d.slice(prefix.length + 1));
  };
  const allUnder = (prefix) => files.length > 0 && files.every((f) => f.relPath.startsWith(prefix + '/'));

  let driveStripped = false;
  if (allUnder('Takeout')) {
    strip('Takeout');
    if (allUnder('Drive')) { strip('Drive'); driveStripped = true; }
  }

  let rootName;
  const first = files.length ? files[0].relPath.split('/')[0] : null;
  if (first && files.every((f) => f.relPath.includes('/') && f.relPath.split('/')[0] === first)) {
    rootName = first;
    strip(first);
  } else if (driveStripped) {
    rootName = 'Google Drive';
  } else {
    // A Takeout of several products ("takeout-20261019T091522Z-001.zip") gets
    // a name a person would give it, not Google's timestamp.
    const base = String(listings[0]?.name || '').replace(/\.zip$/i, '').replace(/-\d+$/, '');
    rootName = /^takeout-\d{8}T\d{6}Z$/i.test(base) ? 'Google Takeout' : base || 'Import';
  }

  // Every folder the files imply, parents included, plus the empty ones.
  const dirSet = new Set();
  const addWithParents = (path) => {
    const segs = path.split('/');
    for (let i = 1; i <= segs.length; i++) dirSet.add(segs.slice(0, i).join('/'));
  };
  for (const f of files) {
    const segs = f.relPath.split('/');
    if (segs.length > 1) addWithParents(segs.slice(0, -1).join('/'));
  }
  for (const d of dirPaths) if (d) addWithParents(d);
  const dirs = [...dirSet].sort(compareSegments);

  return { rootName, files, dirs, dropped };
}
