import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { fontInfo, licenseLabel } from './fontInfo.js';

const u16 = (n) => [n >> 8, n & 255];
const u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const utf16be = (s) => [...s].flatMap((c) => u16(c.charCodeAt(0)));
function nameTable(names) {
  const strings = names.map(([, s]) => utf16be(s));
  const head = [...u16(0), ...u16(names.length), ...u16(6 + 12 * names.length)];
  let off = 0;
  const recs = names.flatMap(([id], i) => { const r = [...u16(3), ...u16(1), ...u16(0x409), ...u16(id), ...u16(strings[i].length), ...u16(off)]; off += strings[i].length; return r; });
  return Uint8Array.from([...head, ...recs, ...strings.flat()]);
}
const os2 = (weight) => Uint8Array.from([...u16(4), ...u16(500), ...u16(weight), ...new Array(90).fill(0)]);
function sfnt(tables, version = 0x00010000, base = 0) {
  const tags = Object.keys(tables);
  let off = 12 + 16 * tags.length;
  const dir = []; const body = [];
  for (const t of tags) { const b = tables[t]; dir.push(...[...t].map((c) => c.charCodeAt(0)), ...u32(0), ...u32(base + off), ...u32(b.length)); body.push(...b); off += b.length; }
  return Uint8Array.from([...u32(version), ...u16(tags.length), ...u16(0), ...u16(0), ...u16(0), ...dir, ...body]);
}
function woff(tables) {
  const tags = Object.keys(tables);
  let off = 44 + 20 * tags.length;
  const dir = []; const body = [];
  for (const t of tags) { const raw = tables[t]; const z = deflateSync(raw); dir.push(...[...t].map((c) => c.charCodeAt(0)), ...u32(off), ...u32(z.length), ...u32(raw.length), ...u32(0)); body.push(...z); off += z.length; }
  return Uint8Array.from([...[...'wOFF'].map((c) => c.charCodeAt(0)), ...u32(0x00010000), ...u32(off), ...u16(tags.length), ...u16(0), ...new Array(28).fill(0), ...dir, ...body]);
}
const NAMES = [[1, 'Fraunces'], [2, 'Regular'], [16, 'Fraunces'], [17, 'Black'], [13, 'This Font Software is licensed under the SIL Open Font License, Version 1.1.']];

test('a TrueType font names its family, style, weight and licence', async () => {
  const info = await fontInfo(sfnt({ name: nameTable(NAMES), 'OS/2': os2(900) }), 'x.ttf');
  assert.deepEqual(info, { family: 'Fraunces', style: 'Black', weight: 900, format: 'TrueType', license: 'SIL Open Font License 1.1' });
});

test('OpenType (CFF), a collection\'s first font and a WOFF read the same names', async () => {
  const otf = sfnt({ name: nameTable(NAMES) }, 0x4f54544f);
  assert.equal((await fontInfo(otf, 'x.otf')).format, 'OpenType');
  // the inner sfnt's table offsets are relative to the file start, so shift them by 16
  const one = sfnt({ name: nameTable(NAMES) }, 0x00010000, 16);
  const ttc = Uint8Array.from([...[...'ttcf'].map((c) => c.charCodeAt(0)), ...u32(0x00010000), ...u32(1), ...u32(16), ...one]);
  const t = await fontInfo(ttc, 'x.ttc');
  assert.equal(t.format, 'TrueType Collection');
  assert.deepEqual([t.family, t.style], ['Fraunces', 'Black']);
  const w = await fontInfo(woff({ name: nameTable(NAMES), 'OS/2': os2(900) }), 'x.woff');
  assert.deepEqual([w.family, w.style, w.weight, w.format], ['Fraunces', 'Black', 900, 'WOFF']);
});

test('a WOFF2 or a broken file is named from its file name', async () => {
  assert.deepEqual(await fontInfo(Uint8Array.from([...[...'wOF2'].map((c) => c.charCodeAt(0)), 0, 0]), 'Fraunces-Black.woff2'),
    { family: 'Fraunces', style: 'Black', weight: null, format: 'WOFF2', license: null });
  const junk = await fontInfo(Uint8Array.from([1, 2, 3]), 'Mystery.ttf');
  assert.deepEqual([junk.family, junk.style], ['Mystery', 'Regular']);
});

test('licences get their short names', () => {
  assert.equal(licenseLabel(null, 'https://scripts.sil.org/OFL'), 'SIL Open Font License 1.1');
  assert.equal(licenseLabel('Licensed under the Apache License, Version 2.0', null), 'Apache License 2.0');
  assert.equal(licenseLabel(null, null), null);
  assert.equal(licenseLabel('Copyright Foundry. All rights reserved. Not for resale.', null), 'Copyright Foundry.');
});
