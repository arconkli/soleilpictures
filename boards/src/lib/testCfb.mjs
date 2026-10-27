// A compound file writer for tests only (version 3, 512-byte sectors): enough
// of MS-CFB to hand msgRead.js a .msg-shaped file, with no app code using it.
// `miniCutoff` 0 puts every stream in the regular FAT; 4096 puts the small
// ones in the mini stream, which is the shape real files have.
const END = 0xfffffffe;
const FREE = 0xffffffff;
const FATSECT = 0xfffffffd;
const SS = 512;

export const utf16le = (s) => {
  const out = new Uint8Array(s.length * 2);
  const v = new DataView(out.buffer);
  for (let i = 0; i < s.length; i++) v.setUint16(i * 2, s.charCodeAt(i), true);
  return out;
};

// A MAPI property stream: a header of zeros, then 16-byte records (tag, flags, 8 value bytes).
export function props(headerSize, records) {
  const out = new Uint8Array(headerSize + 16 * records.length);
  const v = new DataView(out.buffer);
  records.forEach(([tag, value], i) => {
    const at = headerSize + 16 * i;
    v.setUint32(at, tag, true);
    v.setUint32(at + 4, 6, true);
    v.setBigUint64(at + 8, BigInt(value), true);
  });
  return out;
}

const sectorsFor = (n, size) => Math.ceil(n / size);

export function writeCfb(tree, { miniCutoff = 4096 } = {}) {
  // Flatten to directory entries: each storage's children hang as a degenerate tree (right siblings).
  const entries = [];
  const add = (node, type) => {
    const e = { name: node.name, type, data: node.data || new Uint8Array(0), left: FREE, right: FREE, child: FREE, start: END, size: 0 };
    entries.push(e);
    const id = entries.length - 1;
    if (type !== 2) {
      let prev = -1;
      for (const c of node.children || []) {
        const cid = add(c, c.children ? 1 : 2);
        if (prev < 0) e.child = cid; else entries[prev].right = cid;
        prev = cid;
      }
    }
    return id;
  };
  add(tree, 5);

  const mini = [];
  const big = [];
  for (const e of entries) {
    if (e.type !== 2) continue;
    e.size = e.data.length;
    if (e.size === 0) continue;
    (miniCutoff > 0 && e.size < miniCutoff ? mini : big).push(e);
  }

  // The mini stream and its FAT.
  let miniCount = 0;
  for (const e of mini) { e.miniStart = miniCount; miniCount += sectorsFor(e.size, 64); }
  const miniStream = new Uint8Array(miniCount * 64);
  const miniFat = new Uint32Array(sectorsFor(miniCount, 128) * 128).fill(FREE);
  for (const e of mini) {
    miniStream.set(e.data, e.miniStart * 64);
    const n = sectorsFor(e.size, 64);
    for (let i = 0; i < n; i++) miniFat[e.miniStart + i] = i === n - 1 ? END : e.miniStart + i + 1;
    e.start = e.miniStart;
  }

  const dirSectors = sectorsFor(entries.length * 128, SS);
  const miniFatSectors = miniFat.length / 128;
  const miniStreamSectors = sectorsFor(miniStream.length, SS);
  const bigSectors = big.map((e) => sectorsFor(e.size, SS));
  const others = dirSectors + miniFatSectors + miniStreamSectors + bigSectors.reduce((a, b) => a + b, 0);
  let fatSectors = 1;
  while (fatSectors * 128 < fatSectors + others) fatSectors++;

  // Layout: FAT, directory, mini FAT, mini stream, then the big streams.
  const fat = new Uint32Array(fatSectors * 128).fill(FREE);
  let next = 0;
  const run = (n) => {
    const first = next;
    for (let i = 0; i < n; i++) fat[next + i] = i === n - 1 ? END : next + i + 1;
    next += n;
    return n ? first : END;
  };
  const fatFirst = next;
  for (let i = 0; i < fatSectors; i++) fat[next++] = FATSECT;
  const dirFirst = run(dirSectors);
  const miniFatFirst = miniFatSectors ? run(miniFatSectors) : END;
  const miniStreamFirst = miniStreamSectors ? run(miniStreamSectors) : END;
  big.forEach((e, i) => { e.start = run(bigSectors[i]); });

  const out = new Uint8Array(SS * (1 + next));
  const v = new DataView(out.buffer);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  v.setUint16(0x18, 0x3e, true);
  v.setUint16(0x1a, 3, true);
  v.setUint16(0x1c, 0xfffe, true);
  v.setUint16(0x1e, 9, true);
  v.setUint16(0x20, 6, true);
  v.setUint32(0x2c, fatSectors, true);
  v.setUint32(0x30, dirFirst, true);
  v.setUint32(0x38, miniCutoff, true);
  v.setUint32(0x3c, miniFatFirst, true);
  v.setUint32(0x40, miniFatSectors, true);
  v.setUint32(0x44, END, true);
  for (let i = 0; i < 109; i++) v.setUint32(0x4c + 4 * i, i < fatSectors ? fatFirst + i : FREE, true);

  const at = (sector) => (sector + 1) * SS;
  for (let i = 0; i < fat.length; i++) v.setUint32(at(fatFirst) + 4 * i, fat[i], true);
  for (let i = 0; i < miniFat.length; i++) v.setUint32(at(miniFatFirst) + 4 * i, miniFat[i], true);
  if (miniStreamSectors) out.set(miniStream, at(miniStreamFirst));
  for (const e of big) out.set(e.data, at(e.start));

  entries.forEach((e, i) => {
    const o = at(dirFirst) + i * 128;
    out.set(utf16le(e.name), o);
    v.setUint16(o + 0x40, (e.name.length + 1) * 2, true);
    out[o + 0x42] = e.type;
    out[o + 0x43] = 1;
    v.setUint32(o + 0x44, e.left, true);
    v.setUint32(o + 0x48, e.right, true);
    v.setUint32(o + 0x4c, e.child, true);
    if (e.type === 5) {
      v.setUint32(o + 0x74, miniStreamFirst, true);
      v.setUint32(o + 0x78, miniStream.length, true);
    } else {
      v.setUint32(o + 0x74, e.type === 2 ? e.start : END, true);
      v.setUint32(o + 0x78, e.type === 2 ? e.size : 0, true);
    }
  });
  return out;
}
