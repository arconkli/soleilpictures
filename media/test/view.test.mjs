import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXT_LOADERS, sniffLoader, thumbnailArgs, uprightDims, vipsEnv, jp2kLevel, stripWebpMetadata,
} from '../src/viewArgs.js';
import { viewKindOfKey } from '../../boards/src/lib/fileView.js';

const bytes = (...xs) => new Uint8Array(xs);
const ascii = (s) => new TextEncoder().encode(s);
const ftyp = (brand) => new Uint8Array([0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii(brand), 0, 0, 0, 0]);

test('every format the app asks views of has a decoder here, and no other', () => {
  const candidates = [...Object.keys(EXT_LOADERS), 'jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg', 'psd', 'pdf', 'mov'];
  for (const ext of candidates) {
    assert.equal(viewKindOfKey(`0b6e2f0a-6c55-4b8e-9d0a-2a3f1c9e7b11/a.${ext}`) === 'image', ext in EXT_LOADERS, ext);
  }
});

test('a file\'s first bytes pick its decoder', () => {
  assert.equal(sniffLoader(bytes(0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0)), 'tiffload');
  assert.equal(sniffLoader(bytes(0x4d, 0x4d, 0x00, 0x2a)), 'tiffload');
  assert.equal(sniffLoader(bytes(0x49, 0x49, 0x2b, 0x00)), 'tiffload', 'BigTIFF');
  assert.equal(sniffLoader(bytes(0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0)), 'openexrload');
  assert.equal(sniffLoader(bytes(0xff, 0x0a, 0xfa)), 'jxlload', 'a bare JPEG XL codestream');
  assert.equal(sniffLoader(bytes(0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a)), 'jxlload');
  assert.equal(sniffLoader(bytes(0, 0, 0, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a)), 'jp2kload');
  assert.equal(sniffLoader(bytes(0xff, 0x4f, 0xff, 0x51)), 'jp2kload', 'a J2K codestream');
  for (const b of ['heic', 'heix', 'mif1', 'msf1', 'hevc']) assert.equal(sniffLoader(ftyp(b)), 'heifload', b);
});

test('anything else never reaches vips', () => {
  assert.equal(sniffLoader(ftyp('avif')), null, 'every browser draws AVIF');
  assert.equal(sniffLoader(ftyp('qt  ')), null, 'a QuickTime movie');
  assert.equal(sniffLoader(bytes(0xff, 0xd8, 0xff, 0xe0)), null, 'a JPEG');
  assert.equal(sniffLoader(bytes(0x89, 0x50, 0x4e, 0x47)), null, 'a PNG');
  assert.equal(sniffLoader(ascii('%PDF-1.7')), null);
  assert.equal(sniffLoader(ascii('<svg xmlns')), null);
  assert.equal(sniffLoader(ascii('push graphic-context')), null, 'an ImageMagick MVG script');
  assert.equal(sniffLoader(ascii('8BPS')), null, 'a Photoshop document');
  assert.equal(sniffLoader(bytes(0x49, 0x49)), null, 'too short to be anything');
  assert.equal(sniffLoader(null), null);
});

test('the view is made upright, in sRGB, never enlarged, with every tag stripped', () => {
  assert.deepEqual(thumbnailArgs('/t/source', '/t/view.webp', 2048, 80),
    ['thumbnail', '/t/source', '/t/view.webp[Q=80,strip]', '2048', '--height', '2048', '--size', 'down', '--export-profile', 'srgb']);
});

test('vips blocks untrusted decoders except for the three formats that only come through one', () => {
  for (const l of ['heifload', 'tiffload', 'webpload']) assert.equal(vipsEnv(l).VIPS_BLOCK_UNTRUSTED, '1', l);
  for (const l of ['jxlload', 'openexrload', 'jp2kload']) assert.equal(vipsEnv(l).VIPS_BLOCK_UNTRUSTED, undefined, l);
  assert.equal(vipsEnv(null).VIPS_BLOCK_UNTRUSTED, '1', 'anything unknown keeps the block');
  for (const l of new Set(Object.values(EXT_LOADERS))) assert.equal(vipsEnv(l).VIPS_CONCURRENCY, '2');
});

test('the original\'s size is told upright, from the way its view lies', () => {
  assert.deepEqual(uprightDims(4032, 3024, { w: 1536, h: 2048 }), { w: 3024, h: 4032 }, 'stored landscape, shown portrait');
  assert.deepEqual(uprightDims(3024, 4032, { w: 1536, h: 2048 }), { w: 3024, h: 4032 });
  assert.deepEqual(uprightDims(3024, 4032, { w: 2048, h: 1536 }), { w: 4032, h: 3024 });
  assert.deepEqual(uprightDims(1000, 999, { w: 640, h: 640 }), { w: 1000, h: 999 }, 'a square view says nothing');
  assert.deepEqual(uprightDims(10, 20, null), { w: 10, h: 20 });
});

// A WebP in chunks, as vips writes one: RIFF, then fourcc + little-endian size
// + payload (+ a pad byte when the size is odd).
function riff(chunks) {
  const parts = chunks.map(([id, payload]) => {
    const p = new Uint8Array(payload);
    const c = new Uint8Array(8 + p.length + (p.length & 1));
    c.set(new TextEncoder().encode(id));
    new DataView(c.buffer).setUint32(4, p.length, true);
    c.set(p, 8);
    return c;
  });
  const body = parts.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(12 + body);
  out.set(new TextEncoder().encode('RIFF'));
  new DataView(out.buffer).setUint32(4, 4 + body, true);
  out.set(new TextEncoder().encode('WEBP'), 8);
  let o = 12;
  for (const c of parts) { out.set(c, o); o += c.length; }
  return out;
}
const chunksOf = (b) => {
  const ids = [];
  for (let i = 12; i < b.length;) {
    const n = new DataView(b.buffer, b.byteOffset).getUint32(i + 4, true);
    ids.push(String.fromCharCode(...b.subarray(i, i + 4)));
    i += 8 + n + (n & 1);
  }
  return ids;
};

test('no camera, software or place leaves with a view', () => {
  const exif = new TextEncoder().encode('Exif\0\0TestCam GPS');
  const input = riff([
    ['VP8X', [0x2c | 0x10, 0, 0, 0, 0xff, 0x07, 0, 0xff, 0x05, 0]],
    ['ICCP', [1, 2, 3, 4, 5]],
    ['ALPH', [9, 9, 9]],
    ['VP8 ', [7, 7, 7, 7]],
    ['EXIF', [...exif]],
    ['XMP ', [1]],
  ]);
  const out = stripWebpMetadata(input);
  assert.deepEqual(chunksOf(out), ['VP8X', 'ALPH', 'VP8 ']);
  assert.equal(out[20], 0x10, 'only the alpha flag is left');
  assert.equal(new DataView(out.buffer).getUint32(4, true), out.length - 8, 'the RIFF size is the new one');
  assert.ok(!Buffer.from(out).includes('TestCam'));
  assert.deepEqual([...out.subarray(out.length - 12)], [0x56, 0x50, 0x38, 0x20, 4, 0, 0, 0, 7, 7, 7, 7], 'the picture is untouched');
  const plain = riff([['VP8 ', [1, 2]]]);
  assert.deepEqual([...stripWebpMetadata(plain)], [...plain], 'a WebP with nothing to drop comes back the same');
  assert.throws(() => stripWebpMetadata(new TextEncoder().encode('GIF89a and more bytes')), /not a WebP/);
  const cut = input.slice(0, 40);
  new DataView(cut.buffer).setUint32(4, input.length - 8, true);
  assert.throws(() => stripWebpMetadata(cut), /truncated/);
});

test('a JPEG 2000 is decoded at the smallest level that still covers the view', () => {
  assert.equal(jp2kLevel(4032, 3024, 6, 2048), 0, '2016 would be short of 2048');
  assert.equal(jp2kLevel(16000, 9000, 6, 2048), 2, '4000 covers it, 2000 does not');
  assert.equal(jp2kLevel(100000, 50000, 3, 2048), 2, 'never past the file\'s own levels');
  assert.equal(jp2kLevel(800, 600, 6, 2048), 0, 'a small one is read whole');
});
