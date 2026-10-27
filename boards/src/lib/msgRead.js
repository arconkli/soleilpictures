// An Outlook .msg read as a letter: its subject, people, date, bodies and
// attachments out of the compound file (MS-CFB) and its MAPI properties
// (MS-OXMSG). Pure, no imports. A file is untrusted, so every read is bounds-
// checked, every chain is cut at a loop, and the directory walk stops at
// 4096 entries; a file with no compound signature throws Error('not_msg').
const SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDMARK = 0xfffffffa; // every sector number from here up is a marker
const MAX_ENTRIES = 4096;
const NONE = 0xffffffff;
const u8 = new Uint8Array(0);

function openCfb(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 512 || SIG.some((b, i) => bytes[i] !== b)) throw new Error('not_msg');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const shift = v.getUint16(0x1e, true);
  if (shift !== 9 && shift !== 12) throw new Error('not_msg');
  const secSize = 1 << shift;
  const miniSize = 1 << Math.min(v.getUint16(0x20, true), 12);
  const cutoff = v.getUint32(0x38, true);
  const sectorAt = (n) => (n + 1) * secSize; // n < 2^32, so no overflow in a double
  const sectorOk = (n) => n < ENDMARK && sectorAt(n) + secSize <= bytes.length;

  // The FAT is every sector the DIFAT lists: 109 in the header, then a chain of DIFAT sectors.
  const fatSectors = [];
  const nFat = Math.min(v.getUint32(0x2c, true), 1 << 16);
  for (let i = 0; i < 109 && fatSectors.length < nFat; i++) {
    const n = v.getUint32(0x4c + 4 * i, true);
    if (sectorOk(n)) fatSectors.push(n);
  }
  const seenDifat = new Set();
  let d = v.getUint32(0x44, true);
  for (let i = 0, nd = Math.min(v.getUint32(0x48, true), 1 << 16); i < nd && sectorOk(d) && !seenDifat.has(d) && fatSectors.length < nFat; i++) {
    seenDifat.add(d);
    const per = secSize / 4 - 1;
    for (let k = 0; k < per && fatSectors.length < nFat; k++) {
      const n = v.getUint32(sectorAt(d) + 4 * k, true);
      if (sectorOk(n)) fatSectors.push(n);
    }
    d = v.getUint32(sectorAt(d) + 4 * per, true);
  }
  const per = secSize / 4;
  const fatAt = (n) => {
    const s = fatSectors[Math.floor(n / per)];
    return s === undefined ? NONE : v.getUint32(sectorAt(s) + 4 * (n % per), true);
  };

  // A chain of sector numbers, cut at a marker, a bad sector, or a sector seen twice.
  const chain = (start, next, ok) => {
    const out = [];
    const seen = new Set();
    let n = start;
    while (ok(n) && !seen.has(n)) {
      seen.add(n);
      out.push(n);
      n = next(n);
    }
    return out;
  };
  const bigStream = (start, size) => {
    const secs = chain(start, fatAt, sectorOk);
    const out = new Uint8Array(Math.min(size, secs.length * secSize));
    secs.forEach((s, i) => {
      if (i * secSize < out.length) out.set(bytes.subarray(sectorAt(s), sectorAt(s) + secSize).subarray(0, out.length - i * secSize), i * secSize);
    });
    return out;
  };

  // Directory entries (128 bytes each, at most MAX_ENTRIES of them).
  const dir = bigStream(v.getUint32(0x30, true), MAX_ENTRIES * 128 * 4).subarray(0, MAX_ENTRIES * 128);
  const dv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const count = Math.floor(dir.length / 128);
  const entry = (i) => {
    if (!(i >= 0 && i < count)) return null;
    const o = i * 128;
    const len = Math.min(Math.max(dv.getUint16(o + 0x40, true) - 2, 0), 62);
    let name = '';
    for (let k = 0; k < len; k += 2) name += String.fromCharCode(dv.getUint16(o + k, true));
    return { name, type: dir[o + 0x42], left: dv.getUint32(o + 0x44, true), right: dv.getUint32(o + 0x48, true), child: dv.getUint32(o + 0x4c, true), start: dv.getUint32(o + 0x74, true), size: dv.getUint32(o + 0x78, true) };
  };
  const root = entry(0);
  if (!root || root.type !== 5) return { entry, children: () => [], read: () => u8 };

  const mini = bigStream(root.start, root.size);
  const miniFat = bigStream(v.getUint32(0x3c, true), Math.min(v.getUint32(0x40, true), 1 << 16) * secSize);
  const mfv = new DataView(miniFat.buffer, miniFat.byteOffset, miniFat.byteLength);
  const miniNext = (n) => (n * 4 + 4 <= miniFat.length ? mfv.getUint32(n * 4, true) : NONE);
  const miniOk = (n) => n < ENDMARK && (n + 1) * miniSize <= mini.length;
  const read = (e) => {
    if (e.size >= cutoff) return bigStream(e.start, e.size);
    const secs = chain(e.start, miniNext, miniOk);
    const out = new Uint8Array(Math.min(e.size, secs.length * miniSize));
    secs.forEach((s, i) => {
      if (i * miniSize < out.length) out.set(mini.subarray(s * miniSize, (s + 1) * miniSize).subarray(0, out.length - i * miniSize), i * miniSize);
    });
    return out;
  };

  // A storage's children: the tree under `child`, walked through left and right.
  const children = (e) => {
    const out = [];
    const seen = new Set();
    const stack = [e.child];
    while (stack.length && seen.size < MAX_ENTRIES) {
      const i = stack.pop();
      if (i === NONE || seen.has(i)) continue;
      seen.add(i);
      const c = entry(i);
      if (!c) continue;
      out.push(c);
      stack.push(c.right, c.left);
    }
    return out;
  };
  return { root, entry, children, read };
}

const PAGE = { 65001: 'utf-8' };
function decode(data, label) {
  try { return new TextDecoder(label).decode(data); } catch { return new TextDecoder('windows-1252').decode(data); }
}

// A storage's properties stream: tag -> the record's value, at its header size.
function readProps(cfb, kids, headerSize) {
  const out = new Map();
  const e = kids.find((c) => c.type === 2 && c.name === '__properties_version1.0');
  if (!e) return out;
  const data = cfb.read(e);
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let at = headerSize; at + 16 <= data.length; at += 16) out.set(v.getUint32(at, true), { lo: v.getUint32(at + 8, true), big: v.getBigUint64(at + 8, true) });
  return out;
}

export function readMsg(bytes) {
  const cfb = openCfb(bytes);
  const none = { subject: '', from: null, to: [], cc: [], date: null, text: '', html: '', attachments: [] };
  if (!cfb.root) return none;
  const top = cfb.children(cfb.root);
  const rootProps = readProps(cfb, top, 32);
  const cp = rootProps.get(0x3ffd0003)?.lo;
  const label = PAGE[cp] || (cp >= 1250 && cp <= 1258 ? `windows-${cp}` : 'windows-1252');

  // A string property in either width, else undefined.
  const str = (kids, id) => {
    const w = kids.find((c) => c.type === 2 && c.name === `__substg1.0_${id}001F`);
    if (w) return decode(cfb.read(w), 'utf-16le').replace(/\0+$/, '');
    const n = kids.find((c) => c.type === 2 && c.name === `__substg1.0_${id}001E`);
    return n ? decode(cfb.read(n), label).replace(/\0+$/, '') : undefined;
  };
  const bin = (kids, id) => {
    const e = kids.find((c) => c.type === 2 && c.name === `__substg1.0_${id}0102`);
    return e ? cfb.read(e) : null;
  };

  const html = () => {
    const b = bin(top, '1013');
    if (!b) return str(top, '1013') || '';
    const m = /charset=["']?([\w-]+)/i.exec(decode(b.subarray(0, 1024), 'windows-1252'));
    return decode(b, m ? m[1] : 'utf-8');
  };
  const time = (tag) => {
    const p = rootProps.get(tag);
    if (!p) return null;
    const d = new Date(Number((p.big - 116444736000000000n) / 10000n));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  const person = (name, address) => ({ name: name || '', address: address || '' });

  const sender = person(str(top, '0C1A'), str(top, '5D01') || str(top, '0C1F'));
  const named = (prefix) => top.filter((c) => c.type === 1 && c.name.startsWith(prefix)).sort((a, b) => (a.name < b.name ? -1 : 1));

  const to = [];
  const cc = [];
  const recips = named('__recip_version1.0_#');
  for (const r of recips) {
    const kids = cfb.children(r);
    const kind = readProps(cfb, kids, 8).get(0x0c150003)?.lo ?? 1;
    const p = person(str(kids, '3001'), str(kids, '39FE') || str(kids, '3003'));
    if (kind === 1) to.push(p); else if (kind === 2) cc.push(p);
  }
  if (!recips.length) {
    const split = (s) => (s || '').split(';').map((x) => x.trim()).filter(Boolean).map((x) => (/^[^\s@]+@[^\s@]+$/.test(x) ? person('', x) : person(x, '')));
    to.push(...split(str(top, '0E04')));
    cc.push(...split(str(top, '0E03')));
  }

  const attachments = [];
  for (const a of named('__attach_version1.0_#')) {
    const kids = cfb.children(a);
    const content = bin(kids, '3701'); // a storage here is an embedded message, which has no bytes
    if (!content) continue;
    attachments.push({ filename: str(kids, '3707') || str(kids, '3704') || '', mimeType: str(kids, '370E') || '', contentId: str(kids, '3712') || '', content });
  }

  return {
    subject: str(top, '0037') || '',
    from: sender.name || sender.address ? sender : null,
    to, cc,
    date: time(0x00390040) || time(0x0e060040),
    text: str(top, '1000') || '',
    html: html(),
    attachments,
  };
}
