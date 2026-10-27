import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createStoreZip, crc32 } from './zipStore.js';
import {
  ZipReadError, canInflate, readZipDirectory, zipDirectoryBounds, openEntry, mergeArchives, groupArchives,
} from './zipRead.js';

// ---- fixture builder: local headers, central directory and EOCD by hand ----

function u16(v) { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }
function u32(v) { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; }
function u64(v) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; }

// spec: { name (string | bytes), raw, comp, method, flags, crc, size, compSize,
//         zip64, extra (extra bytes for the central header), dosDate, dosTime }
function buildZip(specs, { zip64Eocd = false } = {}) {
  const parts = [];
  const central = [];
  let off = 0;
  for (const s of specs) {
    const name = typeof s.name === 'string' ? Buffer.from(s.name, 'utf8') : Buffer.from(s.name);
    const raw = Buffer.from(s.raw ?? []);
    const method = s.method ?? 0;
    const comp = Buffer.from(s.comp ?? (method === 8 ? zlib.deflateRawSync(raw) : raw));
    const flags = s.flags ?? 0x800;
    const crc = s.crc ?? crc32(raw);
    const size = s.size ?? raw.length;
    const compSize = s.compSize ?? comp.length;
    const dosTime = s.dosTime ?? 0;
    const dosDate = s.dosDate ?? ((2020 - 1980) << 9 | 3 << 5 | 4);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u16(dosTime), u16(dosDate),
      u32(crc), u32(compSize), u32(size), u16(name.length), u16(0), name,
    ]);
    parts.push(local, comp);
    central.push({ s, name, flags, method, crc, size, compSize, dosTime, dosDate, off });
    off += local.length + comp.length;
  }
  const cdStart = off;
  const cdParts = [];
  for (const c of central) {
    let extra = Buffer.from(c.s.extra ?? []);
    let sz = c.size, cs = c.compSize, lo = c.off;
    if (c.s.zip64) {
      extra = Buffer.concat([u16(1), u16(24), u64(c.size), u64(c.compSize), u64(c.off), extra]);
      sz = cs = lo = 0xFFFFFFFF;
    }
    cdParts.push(Buffer.concat([
      u32(0x02014b50), u16(45), u16(45), u16(c.flags), u16(c.method), u16(c.dosTime), u16(c.dosDate),
      u32(c.crc), u32(cs), u32(sz), u16(c.name.length), u16(extra.length), u16(0),
      u16(0), u16(0), u32(0), u32(lo), c.name, extra,
    ]));
  }
  const cd = Buffer.concat(cdParts);
  parts.push(cd);
  let n = central.length, cdSizeField = cd.length, cdOffField = cdStart;
  if (zip64Eocd) {
    const rec64At = cdStart + cd.length;
    parts.push(Buffer.concat([
      u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0), u64(n), u64(n), u64(cd.length), u64(cdStart),
    ]));
    parts.push(Buffer.concat([u32(0x07064b50), u32(0), u64(rec64At), u32(1)]));
    n = 0xFFFF; cdSizeField = 0xFFFFFFFF; cdOffField = 0xFFFFFFFF;
  }
  parts.push(Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(n), u16(n), u32(cdSizeField), u32(cdOffField), u16(0),
  ]));
  return new Blob(parts);
}

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
const rejectsWith = (p, code) => assert.rejects(p, (e) => e instanceof ZipReadError && e.code === code);

// ---- readZipDirectory / openEntry ------------------------------------------

test('round trip through createStoreZip', async () => {
  const a = new Uint8Array([1, 2, 3, 4, 5]);
  const b = new Uint8Array(1000).map((_, i) => i % 251);
  const zip = await createStoreZip([
    { name: 'kick.wav', blob: new Blob([a]) },
    { name: 'dir/Café Pad.wav', blob: new Blob([b]) },
  ]);
  const { entries, skipped, zip64 } = await readZipDirectory(zip);
  assert.equal(zip64, false);
  assert.deepEqual(skipped, { encrypted: 0, unsupported: 0 });
  assert.deepEqual(entries.map((e) => e.path), ['kick.wav', 'Café Pad.wav']);
  assert.deepEqual(entries.map((e) => e.size), [5, 1000]);
  assert.equal(entries[0].crc32, crc32(a));
  assert.equal(entries[1].crc32, crc32(b));
  assert.deepEqual(await bytesOf(await openEntry(zip, entries[0])), a);
  assert.deepEqual(await bytesOf(await openEntry(zip, entries[1])), b);
});

test('DEFLATE entry comes back byte for byte', async () => {
  assert.ok(canInflate());
  const raw = Buffer.from('hello hello hello hello '.repeat(500));
  const zip = buildZip([{ name: 'a.txt', raw, method: 8 }]);
  const { entries } = await readZipDirectory(zip);
  assert.equal(entries[0].method, 8);
  assert.ok(entries[0].compressedSize < entries[0].size);
  assert.deepEqual(Buffer.from(await bytesOf(await openEntry(zip, entries[0]))), raw);
});

test('zip bomb: inflating past the declared size rejects too_big', async () => {
  const raw = Buffer.alloc(100000, 7);
  const zip = buildZip([{ name: 'bomb.bin', raw, method: 8, size: 10 }]);
  const { entries } = await readZipDirectory(zip);
  await rejectsWith(openEntry(zip, entries[0]), 'too_big');
});

test('a short entry rejects truncated', async () => {
  const raw = Buffer.from('abcdef');
  const zip = buildZip([{ name: 'a.txt', raw, method: 8, size: 50 }]);
  const { entries } = await readZipDirectory(zip);
  await rejectsWith(openEntry(zip, entries[0]), 'truncated');
});

test('a wrong CRC rejects crc', async () => {
  const raw = Buffer.from('some data to check '.repeat(10));
  const zip = buildZip([{ name: 'a.txt', raw, method: 8, crc: crc32(raw) ^ 1 }]);
  const { entries } = await readZipDirectory(zip);
  await rejectsWith(openEntry(zip, entries[0]), 'crc');
});

test('ZIP64: sizes and offset from the 0x0001 extra, EOCD from the ZIP64 record', async () => {
  const r1 = Buffer.from('first file');
  const r2 = Buffer.from('second file, a little longer');
  const zip = buildZip([
    { name: 'one.txt', raw: r1, zip64: true },
    { name: 'two.txt', raw: r2, zip64: true, method: 8 },
  ], { zip64Eocd: true });
  const { entries, zip64 } = await readZipDirectory(zip);
  assert.equal(zip64, true);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].size, r1.length);
  assert.equal(entries[0].offset, 0);
  assert.ok(entries[1].offset > 0 && entries[1].offset < 0xFFFFFFFF);
  assert.equal(entries[1].size, r2.length);
  assert.deepEqual(Buffer.from(await bytesOf(await openEntry(zip, entries[0]))), r1);
  assert.deepEqual(Buffer.from(await bytesOf(await openEntry(zip, entries[1]))), r2);
});

test('ZIP64 value past 2^53 rejects too_big', async () => {
  // Hand-patch: a ZIP64 extra claiming an enormous size.
  const big = buildZip([{
    name: 'x', raw: Buffer.from('x'), zip64: true,
  }]);
  const buf = Buffer.from(await big.arrayBuffer());
  const at = buf.indexOf(Buffer.from([0x01, 0x00, 0x18, 0x00]));
  buf.writeUInt32LE(0xFFFFFFFF, at + 8); // size high word
  await rejectsWith(readZipDirectory(new Blob([buf])), 'too_big');
});

test('names: CP437 when the UTF-8 flag is clear, UTF-8 when set', async () => {
  const zip = buildZip([
    { name: [0x63, 0x61, 0x66, 0x82], flags: 0 },                  // "caf" + 0x82
    { name: Buffer.from('café-utf8', 'utf8'), flags: 0x800 },
  ]);
  const { entries } = await readZipDirectory(zip);
  assert.equal(entries[0].path, 'café');
  assert.equal(entries[1].path, 'café-utf8');
});

test('encrypted and unsupported-method entries are counted, not listed', async () => {
  const zip = buildZip([
    { name: 'secret.txt', raw: Buffer.from('x'), flags: 0x801 },
    { name: 'weird.bin', raw: Buffer.from('x'), method: 12 },
    { name: 'ok.txt', raw: Buffer.from('x') },
  ]);
  const { entries, skipped } = await readZipDirectory(zip);
  assert.deepEqual(entries.map((e) => e.path), ['ok.txt']);
  assert.deepEqual(skipped, { encrypted: 1, unsupported: 1 });
  // A list of what a zip holds keeps them, still counted, for showing.
  const all = await readZipDirectory(zip, { locked: true });
  assert.deepEqual(all.entries.map((e) => [e.path, e.flags & 1, e.method]), [['secret.txt', 1, 0], ['weird.bin', 0, 12], ['ok.txt', 0, 0]]);
  assert.deepEqual(all.skipped, { encrypted: 1, unsupported: 1 });
});

test('path sanitizing', async () => {
  const zip = buildZip([
    { name: '../../etc/passwd' },
    { name: 'a\\b\\c.txt' },
    { name: '/abs/x' },
    { name: './././' },
    { name: 'dir/' },
  ]);
  const { entries } = await readZipDirectory(zip);
  assert.deepEqual(entries.map((e) => e.path), ['etc/passwd', 'a/b/c.txt', 'abs/x', 'dir']);
  assert.deepEqual(entries.map((e) => e.dir), [false, false, false, true]);
});

test('extended timestamp wins over the DOS date; DOS is local time', async () => {
  const mtime = 1700000000;
  const extra = Buffer.concat([u16(0x5455), u16(5), Buffer.from([1]), u32(mtime)]);
  const zip = buildZip([
    { name: 'a.txt', extra },
    { name: 'b.txt', dosDate: (2020 - 1980) << 9 | 3 << 5 | 4, dosTime: 10 << 11 | 20 << 5 | 15 },
  ]);
  const { entries } = await readZipDirectory(zip);
  assert.equal(entries[0].lastModified, mtime * 1000);
  assert.equal(entries[1].lastModified, new Date(2020, 2, 4, 10, 20, 30).getTime());
});

test('a non-zip Blob rejects not_zip', async () => {
  await rejectsWith(readZipDirectory(new Blob(['this is plainly not a zip file at all, no sir'])), 'not_zip');
  await rejectsWith(readZipDirectory(new Blob(['tiny'])), 'not_zip');
});

test('a directory that ends mid-header rejects truncated', async () => {
  const zip = buildZip([{ name: 'a.txt', raw: Buffer.from('x') }]);
  const buf = Buffer.from(await zip.arrayBuffer());
  const eocd = buf.length - 22;
  buf.writeUInt32LE(buf.readUInt32LE(eocd + 12) - 4, eocd + 12); // CD size 4 short
  await rejectsWith(readZipDirectory(new Blob([buf])), 'truncated');
});

test('central directory larger than one read piece', async () => {
  const specs = [];
  for (let i = 0; i < 40; i++) specs.push({ name: `folder/file-number-${i}-${'x'.repeat(i % 7)}.txt`, raw: Buffer.from(`n${i}`) });
  const zip = buildZip(specs);
  const want = specs.map((s) => s.name);
  for (const pieceBytes of [1, 7, 64, 100]) {
    const seen = [];
    const { entries } = await readZipDirectory(zip, { pieceBytes, onProgress: (p) => seen.push(p.entries) });
    assert.deepEqual(entries.map((e) => e.path), want, `pieceBytes=${pieceBytes}`);
    assert.equal(seen[seen.length - 1], 40);
  }
});

test('progress fires every 1000 entries and once at the end', async () => {
  const specs = Array.from({ length: 2001 }, (_, i) => ({ name: `f${i}` }));
  const seen = [];
  await readZipDirectory(buildZip(specs), { onProgress: (p) => seen.push(p.entries) });
  assert.deepEqual(seen, [1000, 2000, 2001]);
});

// ---- mergeArchives ----------------------------------------------------------

const ent = (path, size = 1) => ({ path, dir: path.endsWith('/'), size, lastModified: 1000, method: 0 });
const norm = (e) => (e.dir ? { ...e, path: e.path.replace(/\/$/, '') } : e);

test('mergeArchives: two Takeout parts, junk, sidecars and a duplicate', () => {
  const p1 = [
    'Takeout/Drive/Night Shift/Scenes/a.txt',
    'Takeout/Drive/Night Shift/b.txt',
    'Takeout/Drive/Night Shift/Empty/',
    '__MACOSX/Takeout/Drive/._b.txt',
    'Takeout/Drive/Night Shift/._x',
    'Takeout/Drive/Night Shift/.DS_Store',
    'Takeout/Drive/Night Shift/Photos/IMG_1.jpg',
    'Takeout/Drive/Night Shift/Photos/IMG_1.jpg.supplemental-metadata.json',
    'Takeout/Google Photos/Trip/metadata.json',
  ].map((p) => norm(ent(p)));
  const p2 = [
    'Takeout/Drive/Night Shift/c.txt',
    'Takeout/Drive/Night Shift/b.txt',
    'Takeout/Drive/Night Shift/Scenes/Act1/e.txt',
    'Takeout/Drive/Night Shift/Photos/IMG_2.jpg.supp.json',
    'Takeout/Drive/Night Shift/notes.json',
  ].map((p) => norm(ent(p)));
  const m = mergeArchives([
    { name: 'takeout-20261019T091522Z-001.zip', entries: p1 },
    { name: 'takeout-20261019T091522Z-002.zip', entries: p2 },
  ]);
  assert.equal(m.rootName, 'Night Shift');
  assert.deepEqual(m.files.map((f) => f.relPath), [
    'Scenes/a.txt', 'b.txt', 'Photos/IMG_1.jpg', 'c.txt', 'Scenes/Act1/e.txt', 'notes.json',
  ]);
  assert.deepEqual(m.files.map((f) => f.zip), [0, 0, 0, 1, 1, 1]);
  assert.deepEqual(m.dropped, { macosx: 1, sidecars: 3, junk: 2, duplicates: 1 });
  assert.deepEqual(m.dirs, ['Empty', 'Photos', 'Scenes', 'Scenes/Act1']);
});

test('mergeArchives: pre-order even when a sibling sorts between parent and child', () => {
  const m = mergeArchives([{ name: 'x.zip', entries: [
    ent('r/a b/f.txt'), ent('r/a/g/h.txt'), ent('r/z.txt'),
  ] }]);
  assert.equal(m.rootName, 'r');
  assert.deepEqual(m.dirs, ['a', 'a/g', 'a b']);
});

test('mergeArchives: Dropbox single root; Drive fallback; zip-name fallback', () => {
  const dbx = mergeArchives([{ name: 'Photos.zip', entries: [ent('Trip/a.jpg'), ent('Trip/sub/b.jpg')] }]);
  assert.equal(dbx.rootName, 'Trip');
  assert.deepEqual(dbx.files.map((f) => f.relPath), ['a.jpg', 'sub/b.jpg']);
  assert.deepEqual(dbx.dirs, ['sub']);

  const drive = mergeArchives([{ name: 'drive-download-1.zip', entries: [
    ent('Takeout/Drive/A/x.txt'), ent('Takeout/Drive/B/y.txt'),
  ] }]);
  assert.equal(drive.rootName, 'Google Drive');
  assert.deepEqual(drive.dirs, ['A', 'B']);

  const loose = mergeArchives([{ name: 'takeout-20261019T091522Z-001.zip', entries: [
    ent('x.txt'), ent('A/y.txt'),
  ] }]);
  assert.equal(loose.rootName, 'Google Takeout');
  assert.deepEqual(loose.files.map((f) => f.relPath), ['x.txt', 'A/y.txt']);

  const named = mergeArchives([{ name: 'Archive-002.zip', entries: [ent('x.txt'), ent('A/y.txt')] }]);
  assert.equal(named.rootName, 'Archive');
});

test('groupArchives: Takeout and Drive parts group in part order; any other zip stands alone', () => {
  assert.deepEqual(groupArchives([
    'takeout-20261019T091522Z-002.zip', 'Casting.zip', 'takeout-20261019T091522Z-001.zip',
    'Night Shift-20261019T101010Z-001.zip', 'Roll-001.zip', 'Roll-002.zip', 'Night Shift-20261019T101010Z-002.ZIP',
  ]), [[2, 0], [1], [3, 6], [4], [5]]);
  assert.deepEqual(groupArchives([]), []);
});

test('zipDirectoryBounds says where the central directory sits from the end of the file alone', async () => {
  const zip = buildZip([{ name: 'a.txt', raw: Buffer.from('aaa') }, { name: 'b.txt', raw: Buffer.from('bbbb') }]);
  const { cdStart, cdEnd, entries, zip64 } = await zipDirectoryBounds(zip);
  assert.equal(entries, 2);
  assert.equal(zip64, false);
  assert.equal(new DataView(await zip.slice(cdStart, cdStart + 4).arrayBuffer()).getUint32(0, true), 0x02014b50);
  assert.ok(cdEnd > cdStart && cdEnd <= zip.size);
});
