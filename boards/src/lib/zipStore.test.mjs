// The archive is hand-parsed back out here rather than run through an unzip
// dependency — the point is to assert the BYTES are a real zip, and a library
// that agreed with our bug would prove nothing. CRC-32 is pinned against the
// canonical check value from the spec.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStoreZip, crc32, crc32Update, crc32Final,
  sanitizeEntryName, dedupeName, ZipLimitError, ZIP_MAX_ENTRIES,
} from './zipStore.js';

const enc = (s) => new TextEncoder().encode(s);
const u32 = (dv, o) => dv.getUint32(o, true);
const u16 = (dv, o) => dv.getUint16(o, true);

async function parse(zipBlob) {
  const dv = new DataView(await zipBlob.arrayBuffer());
  // EOCD is the last 22 bytes when there is no archive comment.
  const eocd = dv.byteLength - 22;
  assert.equal(u32(dv, eocd), 0x06054b50, 'end-of-central-directory signature');
  const count = u16(dv, eocd + 10);
  const cdSize = u32(dv, eocd + 12);
  const cdStart = u32(dv, eocd + 16);
  assert.equal(cdStart + cdSize, eocd, 'central directory must end exactly where the EOCD begins');

  const entries = [];
  let o = cdStart;
  for (let i = 0; i < count; i++) {
    assert.equal(u32(dv, o), 0x02014b50, `central header ${i} signature`);
    const flags = u16(dv, o + 8);
    const method = u16(dv, o + 10);
    const crc = u32(dv, o + 16);
    const csize = u32(dv, o + 20);
    const usize = u32(dv, o + 24);
    const nameLen = u16(dv, o + 28);
    const lho = u32(dv, o + 42);
    const name = new TextDecoder().decode(new Uint8Array(dv.buffer, o + 46, nameLen));
    // The local header this points at must actually be one.
    assert.equal(u32(dv, lho), 0x04034b50, `local header for ${name}`);
    assert.equal(u32(dv, lho + 14), crc, `local/central crc agree for ${name}`);
    entries.push({ name, crc, csize, usize, method, flags, lho, nameLen });
    o += 46 + nameLen + u16(dv, o + 30) + u16(dv, o + 32);
  }
  return { dv, count, entries };
}

test('CRC-32 matches the spec check value', () => {
  assert.equal(crc32(enc('123456789')), 0xCBF43926);
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('incremental CRC equals the one-shot CRC', () => {
  const data = enc('the quick brown fox jumps over the lazy dog, twice over');
  let state;
  for (let i = 0; i < data.length; i += 7) state = crc32Update(state, data.slice(i, i + 7));
  assert.equal(crc32Final(state), crc32(data));
});

test('a two-entry archive parses as a real zip', async () => {
  const a = new Blob([enc('kick bytes')]);
  const b = new Blob([enc('snare bytes, longer')]);
  const zip = await createStoreZip([{ name: 'Kick.wav', blob: a }, { name: 'Snare.wav', blob: b }]);
  const { count, entries, dv } = await parse(zip);

  assert.equal(count, 2);
  assert.deepEqual(entries.map(e => e.name), ['Kick.wav', 'Snare.wav']);
  for (const e of entries) {
    assert.equal(e.method, 0, 'STORE method');
    assert.equal(e.csize, e.usize, 'stored entries are not compressed');
    assert.equal(e.flags & 0x0800, 0x0800, 'UTF-8 name flag must be set');
  }
  assert.equal(entries[0].usize, a.size);
  assert.equal(entries[1].usize, b.size);
  assert.equal(entries[0].crc, crc32(enc('kick bytes')));
  assert.equal(entries[1].crc, crc32(enc('snare bytes, longer')));

  // The stored bytes really sit right after their local header.
  const e0 = entries[0];
  const dataAt = e0.lho + 30 + e0.nameLen;
  assert.equal(new TextDecoder().decode(new Uint8Array(dv.buffer, dataAt, e0.usize)), 'kick bytes');
});

test('entry order is preserved', async () => {
  const names = ['c.wav', 'a.wav', 'b.wav'];
  const zip = await createStoreZip(names.map(n => ({ name: n, blob: new Blob([enc(n)]) })));
  const { entries } = await parse(zip);
  assert.deepEqual(entries.map(e => e.name), names);
});

test('non-ASCII names survive', async () => {
  const zip = await createStoreZip([{ name: 'Café Pad ø.wav', blob: new Blob([enc('x')]) }]);
  const { entries } = await parse(zip);
  assert.equal(entries[0].name, 'Café Pad ø.wav');
});

test('duplicate names are made unique, extension intact', () => {
  const seen = new Set();
  assert.equal(dedupeName('kick.wav', seen), 'kick.wav');
  assert.equal(dedupeName('kick.wav', seen), 'kick (2).wav');
  assert.equal(dedupeName('KICK.WAV', seen), 'KICK (3).WAV', 'collision is case-insensitive');
  assert.equal(dedupeName('noext', seen), 'noext');
  assert.equal(dedupeName('noext', seen), 'noext (2)');
});

test('two identically named loops both extract', async () => {
  const zip = await createStoreZip([
    { name: 'Loop.wav', blob: new Blob([enc('one')]) },
    { name: 'Loop.wav', blob: new Blob([enc('two')]) },
  ]);
  const { entries } = await parse(zip);
  assert.deepEqual(entries.map(e => e.name), ['Loop.wav', 'Loop (2).wav']);
});

test('entry names cannot escape the archive', () => {
  assert.equal(sanitizeEntryName('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeEntryName('/abs/path/x.wav'), 'x.wav');
  assert.equal(sanitizeEntryName('C:\\Users\\me\\x.wav'), 'x.wav');
  assert.equal(sanitizeEntryName('a/b/c.wav'), 'c.wav');
  assert.equal(sanitizeEntryName('...'), 'file');
  assert.equal(sanitizeEntryName(''), 'file');
  assert.equal(sanitizeEntryName('has:illegal*chars?.wav'), 'hasillegalchars.wav');
});

test('an empty selection is refused', async () => {
  await assert.rejects(() => createStoreZip([]), /Nothing to zip/);
  await assert.rejects(() => createStoreZip(null), /Nothing to zip/);
});

test('too many entries is refused with a message naming the number', async () => {
  const many = Array.from({ length: ZIP_MAX_ENTRIES + 1 },
    (_, i) => ({ name: `l${i}.wav`, blob: new Blob([enc('x')]) }));
  await assert.rejects(() => createStoreZip(many), (err) => {
    assert.ok(err instanceof ZipLimitError);
    assert.equal(err.code, 'zip_too_large');
    assert.match(err.message, new RegExp(String(ZIP_MAX_ENTRIES)));
    assert.match(err.message, new RegExp(String(ZIP_MAX_ENTRIES + 1)));
    return true;
  });
});

test('a zero-byte file still produces a valid entry', async () => {
  const zip = await createStoreZip([{ name: 'empty.wav', blob: new Blob([]) }]);
  const { entries, count } = await parse(zip);
  assert.equal(count, 1);
  assert.equal(entries[0].usize, 0);
  assert.equal(entries[0].crc, 0);
});

test('a pre-1980 timestamp does not corrupt the DOS date field', async () => {
  // MS-DOS cannot represent it; clamping is the only correct answer and a
  // negative year would otherwise wrap into a garbage date.
  const zip = await createStoreZip([{ name: 'a.wav', blob: new Blob([enc('x')]) }],
    { date: new Date('1970-01-01T00:00:00Z') });
  const dv = new DataView(await zip.arrayBuffer());
  const dosDate = u16(dv, 12); // local header mod-date
  assert.equal(dosDate >> 9, 0, 'year field clamps to 1980');
  assert.ok((dosDate >> 5 & 0x0F) >= 1 && (dosDate >> 5 & 0x0F) <= 12, 'month in range');
});
