import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { largestPng, xmpThumbnail, dosEpsTiff, designPictureOf } from '../src/design.js';

const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};
// A PNG with real chunks and CRCs and w x h bytes of noise for its pixels:
// nothing here decodes it.
const png = (w, h) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', randomBytes(w * h + 10)), chunk('IEND', Buffer.alloc(0))]);
};
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
// A 2x2 TIFF is more than the finder needs: its magic and a header do.
const tiff = () => Buffer.concat([Buffer.from('II*\0', 'latin1'), Buffer.alloc(4, 8), randomBytes(40)]);

test('an Affinity file\'s picture is its largest complete PNG, and a truncated one is ignored', () => {
  const small = png(3, 3);
  const big = png(6, 6);
  const cut = png(40, 40).subarray(0, 90);
  const buf = Buffer.concat([randomBytes(500), small, randomBytes(300), big, randomBytes(200), cut, randomBytes(50)]);
  const found = largestPng(buf);
  assert.deepEqual(buf.subarray(found.start, found.end), big);
  assert.equal(largestPng(Buffer.concat([randomBytes(100), cut])), null);
  assert.equal(designPictureOf(buf, 'afphoto').kind, 'png');
});

test('an InDesign file\'s picture is the JPEG in its XMP, as an element or an attribute, across its line breaks', () => {
  const b64 = JPEG.toString('base64');
  const broken = b64.match(/.{1,10}/g).join('&#xA;');
  const el = Buffer.concat([randomBytes(300), Buffer.from(`<xmpGImg:format>JPEG</xmpGImg:format><xmpGImg:image>${broken}</xmpGImg:image>`), randomBytes(300)]);
  assert.deepEqual(xmpThumbnail(el), JPEG);
  assert.deepEqual(designPictureOf(el, 'indd').bytes, JPEG);
  const attr = Buffer.from(`<rdf:li xmpGImg:format="JPEG" xmpGImg:image="${b64}"/>`);
  assert.deepEqual(xmpThumbnail(attr), JPEG);
  assert.equal(xmpThumbnail(Buffer.from('<xmpGImg:image>bm90IGEganBlZw==</xmpGImg:image>')), null);
  assert.equal(xmpThumbnail(randomBytes(200)), null);
});

test('a DOS EPS points at its TIFF preview, and bad bounds are refused', () => {
  const t = tiff();
  const ps = Buffer.from('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 2 2\n');
  const head = Buffer.alloc(30);
  head.writeUInt32BE(0xc5d0d3c6, 0);
  head.writeUInt32LE(30, 4); head.writeUInt32LE(ps.length, 8);
  head.writeUInt32LE(30 + ps.length, 20); head.writeUInt32LE(t.length, 24);
  const buf = Buffer.concat([head, ps, t]);
  const found = dosEpsTiff(buf);
  assert.deepEqual(buf.subarray(found.start, found.end), t);
  assert.equal(designPictureOf(buf, 'eps').kind, 'tiff');
  head.writeUInt32LE(buf.length, 20);
  assert.equal(dosEpsTiff(Buffer.concat([head, ps, t])), null);
  assert.equal(designPictureOf(ps, 'eps'), null);
});

test('an Illustrator file that is a PDF is drawn from its first page; plain PostScript has no picture', () => {
  assert.deepEqual(designPictureOf(Buffer.from('%PDF-1.7\n1 0 obj'), 'ai'), { kind: 'pdf' });
  assert.equal(designPictureOf(Buffer.from('%!PS-Adobe-3.0\n%%Creator: Adobe Illustrator'), 'ai'), null);
  assert.equal(designPictureOf(Buffer.from('%PDF-1.7'), 'sketch'), null);
});

test('the child writes the picture it finds into the folder it is given', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'design-'));
  const src = join(dir, 'file.afdesign');
  const big = png(6, 6);
  await writeFile(src, Buffer.concat([randomBytes(100), big, randomBytes(100)]));
  const main = fileURLToPath(new URL('../src/designMain.js', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, [main, 'afdesign', src, dir]);
  assert.deepEqual(JSON.parse(stdout), { made: { file: 'picture.png' } });
  assert.deepEqual(await readFile(join(dir, 'picture.png')), big);
});
