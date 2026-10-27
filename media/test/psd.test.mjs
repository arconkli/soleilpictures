import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLayout, composite, encodeTiff, unpackBits, parseResources, labToRgb, PsdRefused } from '../src/psd.js';

// ── A tiny Photoshop document writer, for the tests ───────────────────────

const be16 = (n) => [(n >> 8) & 255, n & 255];
const be32 = (n) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const be64 = (n) => [...be32(Math.floor(n / 2 ** 32)), ...be32(n >>> 0)];
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

// PackBits, the plain way: runs of 3+ as repeats, the rest as literals.
function packBits(row) {
  const out = [];
  let i = 0;
  while (i < row.length) {
    let run = 1;
    while (i + run < row.length && row[i + run] === row[i] && run < 128) run++;
    if (run >= 3) {
      out.push(257 - run, row[i]);
      i += run;
      continue;
    }
    const start = i;
    while (i < row.length && i - start < 128) {
      if (i + 2 < row.length && row[i] === row[i + 1] && row[i] === row[i + 2]) break;
      i++;
    }
    out.push(i - start - 1, ...row.slice(start, i));
  }
  return out;
}

function resource(id, data) {
  const pad = data.length & 1 ? [0] : [];
  return [...ascii('8BIM'), ...be16(id), 0, 0, ...be32(data.length), ...data, ...pad];
}

// planes: an array of channels, each an array of rows (byte arrays).
function psd({ version = 1, mode = 3, depth = 8, width, height, planes, compression = 1,
  palette = null, resources = [], layers = [0, 0, 0, 0, 1, 2, 3] }) {
  const head = [...ascii('8BPS'), ...be16(version), 0, 0, 0, 0, 0, 0,
    ...be16(planes.length), ...be32(height), ...be32(width), ...be16(depth), ...be16(mode)];
  const modeData = palette ? [...be32(768), ...palette] : be32(0);
  const res = resources.flat();
  const layerSection = version === 2 ? [...be64(layers.length), ...layers] : [...be32(layers.length), ...layers];
  let image;
  if (compression === 0) {
    image = [...be16(0), ...planes.flat(2)];
  } else {
    const packed = planes.map((rows) => rows.map(packBits));
    const counts = packed.flat().map((r) => (version === 2 ? be32(r.length) : be16(r.length))).flat();
    image = [...be16(1), ...counts, ...packed.flat(2)];
  }
  return new Uint8Array([...head, ...modeData, ...be32(res.length), ...res, ...layerSection, ...image]);
}

const reader = (bytes) => async (offset, length) => bytes.subarray(offset, offset + length);
const rowsOf = (w, h, f) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => f(x, y)));

async function decode(bytes, opts = {}) {
  const layout = await readLayout(reader(bytes), bytes.length);
  const made = await composite(reader(bytes), layout,
    { maxEdge: opts.maxEdge ?? 2048, maxPixels: opts.maxPixels ?? 300_000_000 });
  assert.equal(made.pixels.length, made.outW * made.outH * made.bands);
  return { ...made, layout };
}

const px = (d, x, y) => [...d.pixels.subarray((y * d.outW + x) * d.bands, (y * d.outW + x + 1) * d.bands)];

// ── The tests ─────────────────────────────────────────────────────────────

test('PackBits: literals, repeats and the no-op, exactly a row long', () => {
  const out = new Uint8Array(8);
  unpackBits(new Uint8Array([2, 1, 2, 3, 0xfd, 9, 0x80, 0, 7]), out);
  assert.deepEqual([...out], [1, 2, 3, 9, 9, 9, 9, 7]);
  const short = new Uint8Array(4);
  unpackBits(new Uint8Array([0, 5]), short);
  assert.deepEqual([...short], [5, 0, 0, 0], 'a short row is zero-filled');
  const long = new Uint8Array(2);
  unpackBits(new Uint8Array([0x81, 4]), long);
  assert.deepEqual([...long], [4, 4], 'a long one is cut');
  for (const row of [[1, 1, 1, 1, 2, 3], [0, 1, 2, 3], Array(300).fill(7)]) {
    const back = new Uint8Array(row.length);
    unpackBits(new Uint8Array(packBits(row)), back);
    assert.deepEqual([...back], row);
  }
});

test('an RGB document, RLE and raw, comes out pixel for pixel', async () => {
  const w = 5;
  const h = 3;
  const planes = [rowsOf(w, h, (x) => x * 50), rowsOf(w, h, (_, y) => y * 100), rowsOf(w, h, () => 7)];
  for (const compression of [0, 1]) {
    const d = await decode(psd({ width: w, height: h, planes, compression }));
    assert.equal(d.outW, 5);
    assert.equal(d.outH, 3);
    assert.deepEqual(px(d, 0, 0), [0, 0, 7]);
    assert.deepEqual(px(d, 4, 2), [200, 200, 7]);
    assert.deepEqual(px(d, 2, 1), [100, 100, 7]);
  }
});

test('an alpha channel is left out: Photoshop mattes the flattened picture with white', async () => {
  const planes = [rowsOf(2, 1, () => 255), rowsOf(2, 1, () => 128), rowsOf(2, 1, () => 0), rowsOf(2, 1, () => 0)];
  const d = await decode(psd({ width: 2, height: 1, planes }));
  assert.deepEqual(px(d, 1, 0), [255, 128, 0]);
});

test('a big document is shrunk by whole steps while it is read, with a box average', async () => {
  const w = 9;
  const h = 4;
  const planes = [0, 1, 2].map(() => rowsOf(w, h, (x, y) => (x + y) % 2 ? 200 : 100));
  const d = await decode(psd({ width: w, height: h, planes }), { maxEdge: 4 });
  // 9 / 4 → steps of 2: 5 × 2, the last column a block of one.
  assert.deepEqual([d.w, d.h, d.outW, d.outH], [9, 4, 5, 2]);
  assert.deepEqual(px(d, 0, 0), [150, 150, 150], 'a checkerboard averages to its middle');
  assert.deepEqual(px(d, 4, 1), [150, 150, 150], 'the last column: one pixel wide, two high');
});

test('greyscale stays grey, 16-bit keeps its high byte, bitmap and indexed read, CMYK becomes ink, Lab becomes sRGB', async () => {
  const gray = await decode(psd({ mode: 1, width: 2, height: 1, planes: [[[10, 240]]] }));
  assert.equal(gray.photometric, 'gray');
  assert.deepEqual(px(gray, 1, 0), [240]);

  const deep = await decode(psd({ mode: 1, depth: 16, width: 2, height: 1, planes: [[[0x12, 0x34, 0xab, 0xcd]]] }));
  assert.deepEqual([px(deep, 0, 0), px(deep, 1, 0)], [[0x12], [0xab]], 'the high byte');

  const bitmap = await decode(psd({ mode: 0, depth: 1, width: 10, height: 1, planes: [[[0b10100000, 0b01000000]]] }));
  assert.deepEqual([0, 1, 2, 8, 9].map((x) => px(bitmap, x, 0)[0]), [0, 255, 0, 255, 0], 'a set bit is black');

  const palette = new Array(768).fill(0);
  palette[3] = 200; palette[256 + 3] = 100; palette[512 + 3] = 50;
  const indexed = await decode(psd({ mode: 2, width: 1, height: 1, planes: [[[3]]], palette }));
  assert.equal(indexed.photometric, 'rgb');
  assert.deepEqual(px(indexed, 0, 0), [200, 100, 50]);

  // Stored inverted, 255 no ink; out as ink, for vips to turn into sRGB with
  // the document's profile. Full cyan and nothing at all:
  const cmyk = await decode(psd({ mode: 4, width: 2, height: 1,
    planes: [[[0, 255]], [[255, 255]], [[255, 255]], [[255, 64]]] }));
  assert.equal(cmyk.photometric, 'cmyk');
  assert.deepEqual([px(cmyk, 0, 0), px(cmyk, 1, 0)], [[255, 0, 0, 0], [0, 0, 0, 191]]);

  // L 100, a 0, b 0 is white; L 0 is black; a strong +a is red.
  const lab = await decode(psd({ mode: 9, width: 3, height: 1, planes: [[[255, 0, 138]], [[128, 128, 208]], [[128, 128, 195]]] }));
  assert.equal(lab.photometric, 'rgb');
  assert.deepEqual(px(lab, 0, 0), [255, 255, 255]);
  assert.deepEqual(px(lab, 1, 0), [0, 0, 0]);
  const red = px(lab, 2, 0);
  assert.ok(red[0] > 200 && red[1] < 60 && red[2] < 60, `red: ${red}`);
});

test('a large-document (.psb) file reads too: 8-byte layer length, 4-byte row counts', async () => {
  const planes = [0, 1, 2].map((c) => rowsOf(3, 2, (x) => x * 10 + c));
  const d = await decode(psd({ version: 2, width: 3, height: 2, planes }));
  assert.equal(d.layout.version, 2);
  assert.deepEqual(px(d, 2, 1), [20, 21, 22]);
});

test('the thumbnail and "real merged data" resources are found; others are stepped over', async () => {
  const jpeg = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9];
  const thumbData = [...be32(1), ...be32(160), ...be32(120), ...be32(480), ...be32(57600), ...be32(jpeg.length),
    ...be16(24), ...be16(1), ...jpeg];
  const version = [...be32(1), 0, ...be32(0), ...be32(0), ...be32(1)];
  const named = [...ascii('8BIM'), ...be16(1005), 3, ...ascii('abc'), ...be32(3), 1, 2, 3, 0];
  const bytes = psd({ width: 1, height: 1, planes: [[[1]], [[2]], [[3]]],
    resources: [named, resource(1036, thumbData), resource(1057, version)] });
  const layout = await readLayout(reader(bytes), bytes.length);
  assert.deepEqual([...bytes.subarray(layout.thumbnail.offset, layout.thumbnail.offset + layout.thumbnail.length)], jpeg);
  assert.equal(layout.realMerged, false);
  await assert.rejects(composite(reader(bytes), layout, { maxEdge: 2048, maxPixels: 1e9 }),
    (e) => e instanceof PsdRefused && e.reason === 'unsupported', 'no real flattened picture: the thumbnail stands in');
  assert.deepEqual(parseResources(new Uint8Array(ascii('nope1234nope')), 0), { thumbnail: null, icc: null, realMerged: null });
});

test('what it refuses: not a PSD, a bad header, too many pixels, ZIP, multichannel, a truncated picture', async () => {
  const refuses = async (bytes, reason, opts) => assert.rejects(decode(bytes, opts),
    (e) => e instanceof PsdRefused && e.reason === reason);
  await refuses(new Uint8Array(ascii('GIF89a').concat(new Array(30).fill(0))), 'unsupported');
  const ok = { width: 2, height: 2, planes: [0, 1, 2].map(() => rowsOf(2, 2, () => 1)) };
  await refuses(psd({ ...ok, version: 3 }), 'unsupported');
  await refuses(psd({ ...ok, depth: 12 }), 'unsupported');
  await refuses(psd(ok), 'too_large', { maxPixels: 3 });
  // Raw, 2 × 2 × 3 bytes: the compression field is the 2 bytes before them.
  const zipped = psd({ ...ok, compression: 0 });
  zipped[zipped.length - 12 - 1] = 2;
  await refuses(zipped, 'unsupported');
  await refuses(psd({ ...ok, mode: 7 }), 'unsupported');
  await refuses(psd({ ...ok, planes: ok.planes.slice(0, 2) }), 'unsupported', {});
  const cut = psd({ ...ok, compression: 0 });
  await refuses(cut.subarray(0, cut.length - 3), 'unsupported');
});

test('Lab: mid grey is mid grey', () => {
  const out = new Uint8Array(3);
  labToRgb([Math.round(53.39 * 255 / 100), 128, 128], out, 0);
  for (const v of out) assert.ok(Math.abs(v - 128) <= 1, `${[...out]}`);
});

// The TIFF's IFD, read back: { tag: [type, count, value or offset] }.
function ifdOf(t) {
  assert.equal(t.toString('latin1', 0, 2), 'II');
  assert.equal(t.readUInt16LE(2), 42);
  const at = t.readUInt32LE(4);
  const n = t.readUInt16LE(at);
  const tags = {};
  for (let i = 0; i < n; i++) {
    const e = at + 2 + i * 12;
    const type = t.readUInt16LE(e + 2);
    tags[t.readUInt16LE(e)] = [type, t.readUInt32LE(e + 4), type === 3 ? t.readUInt16LE(e + 8) : t.readUInt32LE(e + 8)];
  }
  const order = Object.keys(tags).map(Number);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'tags in order');
  assert.equal(t.readUInt32LE(at + 2 + n * 12), 0, 'one IFD');
  return tags;
}

test('the TIFF vips reads: one uncompressed strip, 8 bits a sample, the profile attached', () => {
  const pixels = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const icc = new Uint8Array(301).fill(7);
  const t = encodeTiff({ outW: 2, outH: 2, bands: 3, photometric: 'rgb', pixels, icc });
  const tags = ifdOf(t);
  assert.deepEqual([tags[256][2], tags[257][2], tags[259][2], tags[262][2], tags[277][2], tags[278][2], tags[284][2]],
    [2, 2, 1, 2, 3, 2, 1]);
  assert.deepEqual([...t.subarray(tags[258][2], tags[258][2] + 6)], [8, 0, 8, 0, 8, 0], 'BitsPerSample 8,8,8');
  assert.deepEqual([...t.subarray(tags[273][2], tags[273][2] + tags[279][2])], [...pixels]);
  assert.equal(tags[34675][1], 301);
  assert.deepEqual([...t.subarray(tags[34675][2], tags[34675][2] + 301)], [...icc]);
  assert.equal(tags[34675][2] % 2, 0, 'word-aligned');

  const cmyk = ifdOf(encodeTiff({ outW: 1, outH: 1, bands: 4, photometric: 'cmyk', pixels: new Uint8Array(4) }));
  assert.deepEqual([cmyk[262][2], cmyk[277][2], cmyk[332][2], cmyk[34675]], [5, 4, 1, undefined], 'separated, InkSet CMYK, no profile');
  const gray = encodeTiff({ outW: 1, outH: 1, bands: 1, photometric: 'gray', pixels: new Uint8Array([9]) });
  const g = ifdOf(gray);
  assert.deepEqual([g[262][2], g[258][1], g[258][2] & 0xffff], [1, 1, 8], 'BlackIsZero, its one BitsPerSample inline');
});

test('the colour profile rides along unless the picture was turned into sRGB here', async () => {
  const icc = new Array(200).fill(0).map((_, i) => i & 255);
  const make = (o) => psd({ width: 1, height: 1, resources: [resource(1039, icc)], ...o });
  const rgb = await decode(make({ planes: [[[1]], [[2]], [[3]]] }));
  assert.deepEqual([...rgb.icc], icc);
  const lab = await decode(make({ mode: 9, planes: [[[1]], [[2]], [[3]]] }));
  assert.equal(lab.icc, null, 'Lab is sRGB once it is out');
  const deep = await decode(make({ depth: 32, planes: [0, 1, 2].map(() => [[0x3f, 0, 0, 0]]) }));
  assert.equal(deep.icc, null, '32-bit floats too');
  assert.deepEqual(px(deep, 0, 0), [188, 188, 188], 'linear 0.5 on sRGB\'s curve');
});
