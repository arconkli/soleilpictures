import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { createStoreZip, crc32 } from './zipStore.js';
import {
  ZipReadError, canInflate, readZipDirectory, zipDirectoryBounds, openEntry, mergeArchives, groupArchives,
  zipNameEncodings, hasWesternShape,
} from './zipRead.js';
import { shiftJisZip, SHIFT_JIS_NAME } from './i18nFileFixtures.mjs';

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
  const { entries } = await readZipDirectory(zip, { languages: ['en-US'] });
  assert.equal(entries[0].path, 'café');
  assert.equal(entries[1].path, 'café-utf8');
});

// ---- names in other encodings ----------------------------------------------

const names = async (specs, languages) => {
  const r = await readZipDirectory(buildZip(specs), { languages });
  return { paths: r.entries.map((e) => e.path), nameEncoding: r.nameEncoding, entries: r.entries };
};
const one = (bytes, languages, extra = {}) => names([{ name: bytes, flags: 0, ...extra }], languages);

test('names: Shift_JIS is read as Japanese, and its 0x5C trail bytes do not split folders', async () => {
  for (const lang of [['ja-JP'], ['en-US']]) {
    const r = await one(SHIFT_JIS_NAME, lang);
    assert.deepEqual(r.paths, ['報告書_ソフト表.txt']);
    assert.equal(r.nameEncoding, 'shift_jis');
  }
});

test('names: EUC-KR, GBK, Big5, CP866 and windows-1251 under their languages', async () => {
  const euckr = [200, 184, 192, 199, 183, 207, 32, 50, 48, 50, 52, 46, 116, 120, 116];
  assert.deepEqual((await one(euckr, ['ko-KR'])).paths, ['회의록 2024.txt']);
  assert.deepEqual((await one(euckr, ['en-US'])).paths, ['회의록 2024.txt']);
  const gbk = [207, 238, 196, 191, 188, 198, 187, 174, 202, 233, 46, 100, 111, 99, 120];
  assert.deepEqual((await one(gbk, ['zh-CN'])).paths, ['项目计划书.docx']);
  const big5 = [177, 77, 174, 215, 173, 112, 181, 101, 174, 209, 46, 100, 111, 99, 120];
  assert.deepEqual((await one(big5, ['zh-TW'])).paths, ['專案計畫書.docx']);
  const cp866 = [142, 226, 231, 241, 226, 32, 167, 160, 32, 172, 160, 169, 46, 112, 100, 102];
  assert.deepEqual((await one(cp866, ['ru-RU'])).paths, ['Отчёт за май.pdf']);
  const w1251 = [206, 242, 247, 184, 242, 32, 231, 224, 32, 236, 224, 233, 46, 112, 100, 102];
  assert.deepEqual((await one(w1251, ['ru-RU'])).paths, ['Отчёт за май.pdf']);
});

test('names: a Western CP437 zip in a Russian locale is not read as CP866', async () => {
  const resume = [82, 0x82, 115, 117, 109, 0x82, 46, 116, 120, 116];
  const r = await one(resume, ['ru-RU']);
  assert.deepEqual(r.paths, ['R\u{E9}sum\u{E9}.txt']);
  assert.equal(r.nameEncoding, 'cp437');
  const cp866 = [142, 226, 231, 241, 226, 32, 167, 160, 32, 172, 160, 169, 46, 112, 100, 102];
  const ru = await one(cp866, ['ru-RU']);
  assert.deepEqual(ru.paths, ['\u{41E}\u{442}\u{447}\u{451}\u{442} \u{437}\u{430} \u{43C}\u{430}\u{439}.pdf']);
  assert.equal(ru.nameEncoding, 'ibm866');
});

test('names: Western CP437 accents are not read as punctuation in ru, uk, el and he locales', async () => {
  const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));
  // CP437: e-acute 0x82, i-diaeresis 0x8B, o-diaeresis 0x94, e-circumflex 0x88.
  const cases = [
    [[82, 0x82, ...ascii('sum'), 0x82, ...ascii('.txt')], 'R\u{E9}sum\u{E9}.txt'],
    [[...ascii('caf'), 0x82, ...ascii('.txt')], 'caf\u{E9}.txt'],
    [[...ascii('na'), 0x8B, ...ascii('ve.doc')], 'na\u{EF}ve.doc'],
    [[75, 0x94, ...ascii('ln.txt')], 'K\u{F6}ln.txt'],
    [[...ascii('f'), 0x88, ...ascii('te.doc')], 'f\u{EA}te.doc'],
  ];
  for (const lang of ['ru-RU', 'uk-UA', 'el-GR', 'he-IL', 'ja-JP', 'en-US']) {
    for (const [bytes, want] of cases) {
      const r = await one(bytes, [lang]);
      assert.deepEqual(r.paths, [want], `${lang} ${want}`);
      assert.equal(r.nameEncoding, 'cp437', `${lang} ${want}`);
    }
  }
  const cp866 = [142, 226, 231, 241, 226, 32, 167, 160, 32, 172, 160, 169, 46, 112, 100, 102];
  assert.deepEqual((await one(cp866, ['ru-RU'])).paths, ['\u{41E}\u{442}\u{447}\u{451}\u{442} \u{437}\u{430} \u{43C}\u{430}\u{439}.pdf']);
});

// The bytes of `text` in a legacy encoding, from the platform's own decoder run
// backwards (single-byte pages, and Shift_JIS pairs); throws on a character the
// encoding lacks. 'cp437' covers just the accented letters these tests use.
const CP437_BYTES = { '\u{C7}': 0x80, '\u{E9}': 0x82, '\u{E0}': 0x85, '\u{E7}': 0x87, '\u{EA}': 0x88, '\u{EB}': 0x89, '\u{EF}': 0x8B, '\u{D6}': 0x99, '\u{F6}': 0x94, '\u{E2}': 0x83, '\u{C4}': 0x8E, '\u{FC}': 0x81, '\u{E8}': 0x8A, '\u{C9}': 0x90, '\u{FB}': 0x96, '\u{F9}': 0x97, '\u{E1}': 0xA0, '\u{ED}': 0xA1, '\u{F3}': 0xA2, '\u{FA}': 0xA3, '\u{192}': 0x9F };
const reverseTables = new Map();
function encodeLegacy(label, text) {
  if (label === 'cp437') {
    return Array.from(text, (c) => (c.charCodeAt(0) < 0x80 ? c.charCodeAt(0) : CP437_BYTES[c] ?? assert.fail(`cp437 lacks ${c}`)));
  }
  if (!reverseTables.has(label)) {
    const dec = new TextDecoder(label);
    const map = new Map();
    for (let b = 0; b < 256; b++) map.set(dec.decode(Uint8Array.of(b)), [b]);
    if (['shift_jis', 'gbk', 'euc-kr'].includes(label)) {
      for (let lead = 0x81; lead <= 0xFE; lead++) {
        for (let trail = 0x40; trail <= 0xFE; trail++) {
          const s = dec.decode(Uint8Array.of(lead, trail));
          if (s.length === 1 && !map.has(s)) map.set(s, [lead, trail]);
        }
      }
    }
    reverseTables.set(label, map);
  }
  const map = reverseTables.get(label);
  return Array.from(text).flatMap((c) => map.get(c) ?? assert.fail(`${label} lacks U+${c.codePointAt(0).toString(16)}`));
}

test('names: Western CP437 names stay CP437 under every locale, accents and all', async () => {
  const west = [
    'Voil\u{E0}.doc', 'Fa\u{E7}ade.txt', 'No\u{EB}l.doc', '\u{D6}sterreich.pdf', '\u{C7}a va.doc',
    'R\u{E9}sum\u{E9}.txt', 'caf\u{E9}.txt', 'na\u{EF}ve.doc', 'K\u{F6}ln.txt', 'f\u{EA}te.doc',
  ];
  for (const lang of ['ru-RU', 'uk-UA', 'el-GR', 'he-IL', 'ja-JP', 'en-US']) {
    for (const want of west) {
      const r = await one(encodeLegacy('cp437', want), [lang]);
      assert.deepEqual(r.paths, [want], `${lang} ${want}`);
      assert.equal(r.nameEncoding, 'cp437', `${lang} ${want}`);
    }
  }
  // CP437's French "a grave" as a word is U+2026 between spaces in windows-125x.
  const paris = 'Rendez-vous \u{E0} Paris.doc';
  for (const lang of ['el-GR', 'he-IL']) {
    const r = await one(encodeLegacy('cp437', paris), [lang]);
    assert.deepEqual(r.paths, [paris], lang);
    assert.equal(r.nameEncoding, 'cp437', lang);
  }
  // Under ru the 0x85 byte is CP866's capital Ie, but a lone capital between
  // Latin words is stray, so the name stays as written.
  const ru = await one(encodeLegacy('cp437', paris), ['ru-RU']);
  assert.deepEqual(ru.paths, [paris]);
  assert.equal(ru.nameEncoding, 'cp437');
});

test('names: real names with a curly quote, an ellipsis or a euro sign read right', async () => {
  const cases = [
    ['he-IL', 'windows-1255', ['\u{5D3}\u{5D5}\u{201D}\u{5D7} \u{5E9}\u{5E0}\u{5EA}\u{5D9}.docx', '\u{5E6}\u{5D4}\u{201D}\u{5DC}.pdf',
      '\u{5E2}\u{5D5}\u{201D}\u{5D3} \u{5DB}\u{5D4}\u{5DF}.doc', '\u{5EA}\u{201C}\u{5D0}.doc']],
    ['bg-BG', 'windows-1251', ['\u{424}\u{438}\u{440}\u{43C}\u{430}\u{201E}\u{414}\u{43E}\u{433}\u{43E}\u{432}\u{43E}\u{440}\u{201C}.doc']],
    ['el-GR', 'windows-1253', ['\u{391}\u{3C1}\u{3C7}\u{3B5}\u{3AF}\u{3BF} \u{3B5}\u{3BB}\u{3BB}\u{3B7}\u{3BD}\u{3B9}\u{3BA}\u{3AC}\u{201C}\u{3A4}\u{3B5}\u{3C3}\u{3C4}.txt']],
    ['ru-RU', 'windows-1251', ['\u{41E}\u{442}\u{447}\u{451}\u{442} \u{2014} \u{438}\u{442}\u{43E}\u{433}\u{438} 2024\u{2026}.xlsx', '\u{41F}\u{440}\u{430}\u{439}\u{441} 100\u{20AC}.xls']],
  ];
  for (const [lang, enc, list] of cases) {
    for (const want of list) {
      const r = await one(encodeLegacy(enc, want), [lang]);
      assert.deepEqual(r.paths, [want], `${lang} ${want}`);
      assert.equal(r.nameEncoding, enc, `${lang} ${want}`);
    }
  }
});

test('names: Shift_JIS names with a lone kanji between letters are real when they have more kanji', async () => {
  for (const want of ['PDF\u{8CC7}\u{6599}.pdf', 'A\u{793E}B\u{793E}\u{6BD4}\u{8F03}.xlsx']) {
    for (const lang of ['ja-JP', 'en-US']) {
      const r = await one(encodeLegacy('shift_jis', want), [lang]);
      assert.deepEqual(r.paths, [want], `${lang} ${want}`);
      assert.equal(r.nameEncoding, 'shift_jis', `${lang} ${want}`);
    }
  }
});

test('names: more Western CP437 names stay CP437 under ja-JP and zh-CN', async () => {
  for (const lang of ['ja-JP', 'zh-CN']) {
    for (const want of ['na\u{EF}ve.doc', 'K\u{F6}ln.txt', 'ch\u{E2}teau.txt', '\u{C4}rger_\u{D6}l.doc']) {
      const r = await one(encodeLegacy('cp437', want), [lang]);
      assert.deepEqual(r.paths, [want], `${lang} ${want}`);
      assert.equal(r.nameEncoding, 'cp437', `${lang} ${want}`);
    }
  }
});

test('names: under ja-JP a lone kanji is Japanese unless every such name reads as Latin in CP437', async () => {
  const sj = async (list) => names(list.map((t) => ({ name: encodeLegacy('shift_jis', t), flags: 0 })), ['ja-JP']);
  const a = await sj(['PDF\u{8CC7}\u{6599}.pdf', 'A\u{793E}B\u{793E}\u{6BD4}\u{8F03}.xlsx']);
  assert.deepEqual(a.paths, ['PDF\u{8CC7}\u{6599}.pdf', 'A\u{793E}B\u{793E}\u{6BD4}\u{8F03}.xlsx']);
  assert.equal(a.nameEncoding, 'shift_jis');
  const b = await sj(['A\u{793E}.xlsx']);
  assert.deepEqual(b.paths, ['A\u{793E}.xlsx']);
  assert.equal(b.nameEncoding, 'shift_jis');
  const c = await sj(['A\u{672C}.pdf', '\u{8CC7}\u{6599}.pdf']);
  assert.deepEqual(c.paths, ['A\u{672C}.pdf', '\u{8CC7}\u{6599}.pdf']);
  assert.equal(c.nameEncoding, 'shift_jis');
});

test('names: Western CP437 names with a lone accent stay CP437 under en-US, fr-FR and ja-JP', async () => {
  for (const want of ['\u{E9}l\u{E8}ve.txt', 'ch\u{E2}teau.pdf', 'M\u{FC}ller.docx']) {
    for (const lang of ['en-US', 'fr-FR', 'ja-JP']) {
      const r = await one(encodeLegacy('cp437', want), [lang]);
      assert.deepEqual(r.paths, [want], `${lang} ${want}`);
      assert.equal(r.nameEncoding, 'cp437', `${lang} ${want}`);
    }
  }
});

test('names: names with a middle dot, cross, arrow or star read right in their code page', async () => {
  const cases = [
    ['shift_jis', ['ja-JP', 'en-US'], '\u{30D7}\u{30ED}\u{30B8}\u{30A7}\u{30AF}\u{30C8}\u{30FB}\u{8CC7}\u{6599}.pdf'],
    ['shift_jis', ['ja-JP', 'en-US'], '\u{203B}\u{91CD}\u{8981}.txt'],
    ['shift_jis', ['ja-JP', 'en-US'], '\u{2605}\u{304A}\u{6C17}\u{306B}\u{5165}\u{308A}.jpg'],
    ['shift_jis', ['ja-JP', 'en-US'], '\u{30C7}\u{30FC}\u{30BF}\u{2192}\u{7D50}\u{679C}.xlsx'],
    ['gbk', ['zh-CN'], '\u{6570}\u{636E}\u{B7}2024.xlsx'],
    ['gbk', ['zh-CN'], '\u{7167}\u{7247}\u{D7}3.jpg'],
    ['euc-kr', ['ko-KR'], '\u{BCF4}\u{ACE0}\u{C11C}\u{B7}\u{CD5C}\u{C885}.docx'],
  ];
  for (const [enc, langs, want] of cases) {
    for (const lang of langs) {
      let bytes;
      try { bytes = encodeLegacy(enc, want); } catch (e) { assert.fail(`${enc} ${want}: ${e.message}`); }
      const r = await one(bytes, [lang]);
      assert.deepEqual(r.paths, [want], `${lang} ${want}`);
      assert.equal(r.nameEncoding, enc, `${lang} ${want}`);
    }
  }
});

test('names: Cyrillic and Greek names with a middle dot read right', async () => {
  const cases = [
    ['ru-RU', 'windows-1251', '\u{41E}\u{442}\u{447}\u{451}\u{442} \u{B7} \u{438}\u{442}\u{43E}\u{433}.docx'],
    ['el-GR', 'windows-1253', '\u{391}\u{3BD}\u{3B1}\u{3C6}\u{3BF}\u{3C1}\u{3AC} \u{B7} \u{3C4}\u{3B5}\u{3BB}\u{3B9}\u{3BA}\u{3AE}.docx'],
  ];
  for (const [lang, enc, want] of cases) {
    const r = await one(encodeLegacy(enc, want), [lang]);
    assert.deepEqual(r.paths, [want], `${lang} ${want}`);
    assert.equal(r.nameEncoding, enc, `${lang} ${want}`);
  }
});

test('names: a katakana-only Shift_JIS archive stays shift_jis under en-US and ja-JP', async () => {
  const list = ['\u{30C7}\u{30FC}\u{30BF}.xlsx', '\u{30E1}\u{30E2}.txt'];
  for (const lang of ['en-US', 'ja-JP']) {
    const r = await names(list.map((t) => ({ name: encodeLegacy('shift_jis', t), flags: 0 })), [lang]);
    assert.deepEqual(r.paths, list, lang);
    assert.equal(r.nameEncoding, 'shift_jis', lang);
  }
});

test('names: accepted miss, a lone "A<kanji>.pdf" alone under ja-JP is read as CP437', async () => {
  const r = await one(encodeLegacy('shift_jis', 'A\u{672C}.pdf'), ['ja-JP']);
  assert.equal(r.nameEncoding, 'cp437');
});

test('names: windows-1251 quotes and the Ukrainian apostrophe are still names', async () => {
  const cyr = (s) => Array.from(s, (c) => c.charCodeAt(0) - 0x410 + 0xC0);
  // U+201E = 0x84, U+201C = 0x93, U+2019 = 0x92 in windows-1251.
  const quoted = [0x84, ...cyr('\u{422}\u{435}\u{441}\u{442}'), 0x93, 46, 100, 111, 99];
  const apos = [...cyr('\u{43C}'), 0x92, ...cyr('\u{44F}\u{441}\u{43E}'), 46, 116, 120, 116];
  for (const lang of ['bg-BG', 'ru-RU', 'uk-UA']) {
    const q = await one(quoted, [lang]);
    assert.deepEqual(q.paths, ['\u{201E}\u{422}\u{435}\u{441}\u{442}\u{201C}.doc'], lang);
    assert.equal(q.nameEncoding, 'windows-1251');
    // Alone, "\u{43C}\u{2019}\u{44F}\u{441}\u{43E}.txt" bytes also read as plausible CP866 (ibm866 is
    // tried first); next to a name CP866 cannot read, the archive is 1251.
    const w1251 = [206, 242, 247, 184, 242, 32, 231, 224, 32, 236, 224, 233, 46, 112, 100, 102];
    const a = await names([{ name: apos, flags: 0 }, { name: w1251, flags: 0 }], [lang]);
    assert.deepEqual(a.paths, ['\u{43C}\u{2019}\u{44F}\u{441}\u{43E}.txt', '\u{41E}\u{442}\u{447}\u{451}\u{442} \u{437}\u{430} \u{43C}\u{430}\u{439}.pdf'], lang);
    assert.equal(a.nameEncoding, 'windows-1251');
  }
});

test('names: GBK under en-US has no way to know, so it is CP437 as before', async () => {
  const gbk = [207, 238, 196, 191, 188, 198, 187, 174, 202, 233, 46, 100, 111, 99, 120];
  const r = await one(gbk, ['en-US']);
  assert.deepEqual(r.paths, ['╧ε─┐╝╞╗«╩Θ.docx']);
  assert.equal(r.nameEncoding, 'cp437');
});

test('names: CP437 stays CP437, whatever the language says', async () => {
  const cp437 = [82, 130, 115, 117, 109, 130, 32, 99, 97, 102, 130, 46, 116, 120, 116];
  assert.deepEqual((await one(cp437, ['en-US'])).paths, ['Résumé café.txt']);
  assert.deepEqual((await one(cp437, ['ja-JP'])).paths, ['Résumé café.txt']);
});

test('names: a 0x7075 Unicode Path field wins when its CRC matches, and is ignored when it does not', async () => {
  const uni = (crc, text) => {
    const t = Buffer.from(text, 'utf8');
    return Buffer.concat([u16(0x7075), u16(5 + t.length), Buffer.from([1]), u32(crc), t]);
  };
  const crc = crc32(Buffer.from(SHIFT_JIS_NAME));
  const good = await one(SHIFT_JIS_NAME, ['ru-RU'], { extra: uni(crc, '報告書_ソフト表.txt') });
  assert.deepEqual(good.paths, ['報告書_ソフト表.txt']);
  assert.equal(good.nameEncoding, null);
  const bad = await one(SHIFT_JIS_NAME, ['ja-JP'], { extra: uni(crc + 1, 'unicode-wins.txt') });
  assert.deepEqual(bad.paths, ['報告書_ソフト表.txt']);
});

test('names: UTF-8 without the flag is recognised, and every name is NFC', async () => {
  const nfd = 'Résumé ガイド.txt'.normalize('NFD');
  const a = await one(Buffer.from(nfd), ['en-US']);
  assert.equal(a.paths[0], 'Résumé ガイド.txt'.normalize('NFC'));
  const b = await one(Buffer.from('ガイド.txt'.normalize('NFD')), ['en-US'], { flags: 0x800 });
  assert.equal(b.paths[0], 'ガイド.txt'.normalize('NFC'));
  assert.equal(b.paths[0].length, 7);
});

test('names: a mixed archive shares one encoding for its undecided names', async () => {
  const r = await names([
    { name: SHIFT_JIS_NAME, flags: 0 },
    { name: [0x82, 0xa0, 0x2e, 0x74, 0x78, 0x74], flags: 0 },       // あ.txt in Shift_JIS
    { name: Buffer.from('café-utf8', 'utf8'), flags: 0x800 },
  ], ['ja']);
  assert.deepEqual(r.paths, ['報告書_ソフト表.txt', 'あ.txt', 'café-utf8']);
  assert.equal(r.nameEncoding, 'shift_jis');
});

test('names: ASCII only leaves nameEncoding null', async () => {
  const r = await names([{ name: 'a/b.txt', flags: 0 }], ['ja']);
  assert.equal(r.nameEncoding, null);
  assert.deepEqual(r.paths, ['a/b.txt']);
});

test('zipNameEncodings: languages in order, deduped', () => {
  assert.deepEqual(zipNameEncodings(['zh-Hant-TW', 'ja', 'ru']), ['big5', 'shift_jis', 'ibm866', 'windows-1251']);
  assert.deepEqual(zipNameEncodings(['en-US', 'de']), []);
});

test('the Shift_JIS fixture zip lists two entries', async () => {
  const { entries } = await readZipDirectory(shiftJisZip(), { languages: ['ja'] });
  assert.equal(entries.length, 2);
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

// ---- the Western shape, the CJK veto's scope, and Cyrillic/Greek misreads ----

const cp437Of = (t) => encodeLegacy('cp437', t);
const sjOf = (t) => encodeLegacy('shift_jis', t);

test('hasWesternShape: Western CP437 names yes, Shift_JIS read as CP437 no', () => {
  for (const t of ['No\u{EB}l', 'M\u{FC}ller', '\u{D6}sterreich', '\u{C9}l\u{E8}ve', 'H\u{E9}l\u{E8}ne', '\u{C9}COLE']) {
    assert.ok(hasWesternShape(cp437Of(t)), t);
  }
  for (const t of ['1\u{6708}', '\u{672C}', '\u{8868}', '\u{65B0}\u{898F}\u{30D5}\u{30A9}\u{30EB}\u{30C0}']) {
    assert.ok(!hasWesternShape(sjOf(t)), t);
  }
});

test('names: en-US, Western names with two accents stay CP437; Shift_JIS katakana is Japanese', async () => {
  for (const want of ['H\u{E9}l\u{E8}ne.jpg']) {
    const r = await one(cp437Of(want), ['en-US']);
    assert.equal(r.nameEncoding, 'cp437', want);
    assert.deepEqual(r.paths, [want]);
  }
  // Accepted miss: with no Western language to say so, CP437 "Élève.pdf" reads
  // as Shift_JIS; the veto that keeps real two-kanji names Japanese costs it.
  const eleve = await one(cp437Of('\u{C9}l\u{E8}ve.pdf'), ['en-US']);
  assert.equal(eleve.nameEncoding, 'shift_jis');
  assert.deepEqual(eleve.paths, ['\u{4EBA}\u{9769}e.pdf']);
  assert.equal((await one(cp437Of('\u{C9}l\u{E8}ve.pdf'), ['fr-FR'])).nameEncoding, 'cp437');
  const jp = '\u{65B0}\u{898F}\u{30D5}\u{30A9}\u{30EB}\u{30C0}.txt';
  const r = await one(sjOf(jp), ['en-US']);
  assert.equal(r.nameEncoding, 'shift_jis');
  assert.deepEqual(r.paths, [jp]);
});

test('names: zh-CN, "Helene.jpg" with accents is CP437 and GBK "huiyi jilu" is GBK', async () => {
  assert.equal((await one(cp437Of('H\u{E9}l\u{E8}ne.jpg'), ['zh-CN'])).nameEncoding, 'cp437');
  const gbk = '\u{4F1A}\u{8BAE}\u{8BB0}\u{5F55}.docx';
  const r = await one(encodeLegacy('gbk', gbk), ['zh-CN']);
  assert.equal(r.nameEncoding, 'gbk');
  assert.deepEqual(r.paths, [gbk]);
});

test('names: ja-JP, short Shift_JIS names are Japanese, Western ones CP437', async () => {
  const months = Array.from({ length: 12 }, (_, i) => `${i + 1}\u{6708}.xlsx`);
  for (const list of [months, ['2024\u{5E74}1\u{6708}.xlsx'], ['\u{672C}.pdf', '\u{7D75}.png', '\u{8868}.xlsx']]) {
    const r = await names(list.map((t) => ({ name: sjOf(t), flags: 0 })), ['ja-JP']);
    assert.equal(r.nameEncoding, 'shift_jis', list[0]);
    assert.deepEqual(r.paths, list);
  }
  for (const want of ['No\u{EB}l.doc', 'M\u{FC}ller.docx']) {
    assert.equal((await one(cp437Of(want), ['ja-JP'])).nameEncoding, 'cp437', want);
  }
});

test('names: ru-RU, Western names with Cyrillic-look misreads stay CP437, real Russian names stay Russian', async () => {
  for (const want of ['Go\u{FB}t.jpg', 'Voyage \u{E0} Paris.jpg', 'pi\u{F9}.txt', 'Malm\u{F6}.jpg', 'Roma \u{E8} bella.jpg']) {
    assert.equal((await one(cp437Of(want), ['ru-RU'])).nameEncoding, 'cp437', want);
  }
  const ru = async (label, want) => {
    const r = await one(encodeLegacy(label, want), ['ru-RU']);
    assert.equal(r.nameEncoding, label, want);
    assert.deepEqual(r.paths, [want]);
  };
  await ru('ibm866', 'iPhone \u{438} iPad.docx');
  await ru('windows-1251', '\u{41E}\u{442}\u{447}\u{435}\u{442} Q1\u{2013}Q2.xlsx');
  await ru('windows-1251', '\u{41F}\u{440}\u{43E}\u{435}\u{43A}\u{442} \u{201C}Alpha\u{201D}.docx');
  await ru('windows-1251', '\u{41C}\u{43E}\u{441}\u{43A}\u{432}\u{430}\u{2013}Paris.jpg');
});

// ---- tier-2 Shift_JIS veto, and the stray-character rules ----

test('names: en-US, two-kanji Shift_JIS names stay Japanese (tier-2 veto)', async () => {
  for (const list of [['\u{64AE}\u{5F71}.jpg'], ['\u{64AE}\u{5F71}/IMG_0001.jpg', '\u{64AE}\u{5F71}/IMG_0002.jpg'], ['\u{6C38}\u{9060}.txt'], ['\u{203B}\u{91CD}\u{8981}.txt']]) {
    const r = await names(list.map((t) => ({ name: sjOf(t), flags: 0 })), ['en-US']);
    assert.equal(r.nameEncoding, 'shift_jis', list[0]);
    assert.deepEqual(r.paths, list);
  }
});

test('names: fr-FR, a Western reader: CP437 French stays CP437, rule (b) alone decides for Shift_JIS', async () => {
  assert.equal((await one(cp437Of('\u{C9}l\u{E8}ve.pdf'), ['fr-FR'])).nameEncoding, 'cp437');
  const doc = '\u{8CC7}\u{6599}.pdf';
  const r = await one(sjOf(doc), ['fr-FR']);
  assert.equal(r.nameEncoding, 'shift_jis');
  assert.deepEqual(r.paths, [doc]);
  // Accepted miss: its CP437 reading ("\u{C4}Bëe") looks Western.
  assert.equal((await one(sjOf('\u{64AE}\u{5F71}.jpg'), ['fr-FR'])).nameEncoding, 'cp437');
});

test('names: ru-RU, a dash between a capital and a Cyrillic word is real; CP437 "a grave" at the start is not Cyrillic', async () => {
  for (const want of ['A\u{2013}B \u{442}\u{435}\u{441}\u{442}.xlsx', 'Jan\u{2013}Mar \u{43E}\u{442}\u{447}\u{435}\u{442}.xlsx']) {
    const r = await one(encodeLegacy('windows-1251', want), ['ru-RU']);
    assert.equal(r.nameEncoding, 'windows-1251', want);
    assert.deepEqual(r.paths, [want]);
  }
  const faire = '\u{E0} faire.txt';
  const r = await one(cp437Of(faire), ['ru-RU']);
  assert.equal(r.nameEncoding, 'cp437');
  assert.deepEqual(r.paths, [faire]);
});

test('names: el-GR and he-IL, CP437 accents read as hook-f, no-break space or circumflex stay CP437', async () => {
  const west = ['Ch\u{E2}teau de Versailles.jpg', 'M\u{E1}laga.jpg', '\u{E0} faire.txt', 'est\u{E1}.txt'];
  for (const lang of ['el-GR', 'he-IL']) {
    for (const want of west) {
      const r = await one(cp437Of(want), [lang]);
      assert.equal(r.nameEncoding, 'cp437', `${lang} ${want}`);
      assert.deepEqual(r.paths, [want], `${lang} ${want}`);
    }
  }
  const r = await one(cp437Of('voc\u{EA}.txt'), ['he-IL']);
  assert.equal(r.nameEncoding, 'cp437');
  assert.deepEqual(r.paths, ['voc\u{EA}.txt']);
  for (const want of ['\u{391}\u{3C1}\u{3C7}\u{3B5}\u{3AF}\u{3BF} \u{192}/2.8 test.jpg', '\u{3A6}\u{3C9}\u{3C4}\u{3BF} 50mm \u{192}1.4.jpg', '\u{192}/2.8 test.jpg']) {
    const g = await one(encodeLegacy('windows-1253', want), ['el-GR']);
    assert.equal(g.nameEncoding, 'windows-1253', want);
    assert.deepEqual(g.paths, [want]);
  }
});

// ---- round 5: folder starts, narrowed start rule, dash, no-break space, Latin-script readers ----

test('STRAY_START characters are what CP437 one-letter words become (TextDecoder)', () => {
  const dec = (label, b) => new TextDecoder(label).decode(Uint8Array.of(b));
  assert.equal(dec('ibm866', 0x85), '\u{415}');
  assert.equal(dec('ibm866', 0x90), '\u{420}');
  assert.equal(dec('windows-1251', 0x90), '\u{452}');
  assert.equal(dec('windows-1256', 0x90), '\u{6AF}');
  for (const l of ['windows-1251', 'windows-1253', 'windows-1255', 'windows-1256', 'windows-874']) assert.equal(dec(l, 0x85), '\u{2026}', l);
  for (const l of ['windows-1251', 'windows-1253', 'windows-1255', 'windows-1256']) assert.equal(dec(l, 0x82), '\u{201A}', l);
});

test('names: ru-RU, CP437 names with a folder start, a capital E-acute, an O-grave stay CP437; real Russian names stay', async () => {
  for (const want of ['Projet/\u{E0} faire.txt', 'Docs/\u{E0} lire.pdf', 'Voyage/\u{E0} Paris.jpg', '\u{C9} bom.txt',
    'O\u{F9}.txt', 'O\u{F9} est Charlie.jpg', 'M\u{E1}laga.jpg', 'est\u{E1}.txt']) {
    const r = await one(cp437Of(want), ['ru-RU']);
    assert.equal(r.nameEncoding, 'cp437', want);
    assert.deepEqual(r.paths, [want], want);
  }
  for (const [label, want] of [
    ['ibm866', '\u{412} Paris.jpg'], ['ibm866', '\u{421} Apple.docx'], ['ibm866', '\u{42F} iPhone.jpg'],
    ['windows-1251', '\u{421} Apple.docx'],
    ['windows-1251', 'A\u{2013}B \u{442}\u{435}\u{441}\u{442}.xlsx'],
    ['windows-1251', 'Jan\u{2013}Mar \u{43E}\u{442}\u{447}\u{435}\u{442}.xlsx'],
    ['windows-1251', 'Microsoft\u{A0}Word \u{43E}\u{442}\u{447}\u{435}\u{442}.docx'],
  ]) {
    const r = await one(encodeLegacy(label, want), ['ru-RU']);
    assert.equal(r.nameEncoding, label, want);
    assert.deepEqual(r.paths, [want], want);
  }
});

test('names: el-GR, he-IL, ar-SA, th-TH, a CP437 folder start stays CP437; el-GR keeps a Greek "O" word', async () => {
  for (const lang of ['el-GR', 'he-IL', 'ar-SA', 'th-TH']) {
    const want = 'Projet/\u{E0} faire.txt';
    const r = await one(cp437Of(want), [lang]);
    assert.equal(r.nameEncoding, 'cp437', `${lang} ${want}`);
    assert.deepEqual(r.paths, [want], lang);
  }
  for (const lang of ['el-GR', 'he-IL']) {
    const r = await one(cp437Of('O\u{F9}.txt'), [lang]);
    assert.equal(r.nameEncoding, 'cp437', lang);
  }
  assert.equal((await one(cp437Of('\u{C9} bom.txt'), ['ar-SA'])).nameEncoding, 'cp437');
  const g = '\u{39F} Paris.jpg';
  const r = await one(encodeLegacy('windows-1253', g), ['el-GR']);
  assert.equal(r.nameEncoding, 'windows-1253');
  assert.deepEqual(r.paths, [g]);
});

test('names: hi-IN is not a Western reader (veto stays); pl-PL and tr-TR are', async () => {
  for (const t of ['\u{64AE}\u{5F71}.jpg', '\u{6C38}\u{9060}.txt', '\u{203B}\u{91CD}\u{8981}.txt']) {
    const r = await one(sjOf(t), ['hi-IN']);
    assert.equal(r.nameEncoding, 'shift_jis', t);
    assert.deepEqual(r.paths, [t]);
  }
  for (const lang of ['pl-PL', 'tr-TR']) {
    assert.equal((await one(cp437Of('\u{C9}l\u{E8}ve.pdf'), [lang])).nameEncoding, 'cp437', lang);
  }
});
