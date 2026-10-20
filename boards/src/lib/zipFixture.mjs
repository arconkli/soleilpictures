// zipFixture — a stored (uncompressed) zip with real folder paths, for tests.
// zipStore.createStoreZip keeps only each file's own name (it writes
// downloads), so a test that needs "Takeout/Drive/Night/a.jpg" builds it here.

import { crc32 } from './zipStore.js';

const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const DOS_DATE = ((2020 - 1980) << 9) | (3 << 5) | 4;

// entries: [{ path, bytes (string | Uint8Array) }]; a path ending in "/" is a
// folder marker. → a File named `name`.
export function storedZip(entries, name = 'test.zip') {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const path = enc.encode(e.path);
    const data = typeof e.bytes === 'string' ? enc.encode(e.bytes) : (e.bytes || new Uint8Array(0));
    const crc = crc32(data);
    const local = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(DOS_DATE),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(path.length), ...u16(0),
    ]);
    parts.push(local, path, data);
    central.push({ path, crc, size: data.length, offset });
    offset += local.length + path.length + data.length;
  }
  const start = offset;
  for (const c of central) {
    const head = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x800), ...u16(0), ...u16(0), ...u16(DOS_DATE),
      ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.path.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(c.offset),
    ]);
    parts.push(head, c.path);
    offset += head.length + c.path.length;
  }
  parts.push(new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length),
    ...u32(offset - start), ...u32(start), ...u16(0),
  ]));
  return new File(parts, name, { type: 'application/zip' });
}
