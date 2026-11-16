// Generates the image fixtures for the big-board-open bench into
// tests/bench/.fixtures/. Idempotent: skips when manifest.json exists unless
// --force. Run: node tests/bench/make-bench-images.mjs [--force]
//
// Per source i (the largest .webp of the i-th folder of public/landing/v2):
//   orig-i.jpg  fits 3000x2000 (enlarged if needed), JPEG q90  (a camera file)
//   lg-i.webp   long edge 1280, q72     sm-i.webp  long edge 640, q72
//   xs-i.webp   long edge 256,  q60
// plus the ThumbHash blur string in the format uploads.js stores in
// images.blur_hash (rgbaToThumbHash on a <=100px RGBA buffer, base64).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.join(HERE, '.fixtures');
const SRC_DIR = path.resolve(HERE, '../../public/landing/v2');
export const SOURCE_COUNT = 12;
// The landing sources carry transparent margins; a photo has no alpha, and an
// alpha ThumbHash is (rightly) not painted as a blur by R2Image. Flatten first.
const FLAT = { background: '#ffffff' };

function largestWebp(dir) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.webp'))
    .map((f) => ({ f: path.join(dir, f), size: fs.statSync(path.join(dir, f)).size }))
    .sort((a, b) => b.size - a.size)[0]?.f;
}

async function thumbHashB64(file) {
  const { data, info } = await sharp(file).flatten(FLAT)
    .resize(100, 100, { fit: 'inside' })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString('base64');
}

export async function makeBenchImages({ force = false } = {}) {
  const manifestPath = path.join(FIXTURE_DIR, 'manifest.json');
  if (!force && fs.existsSync(manifestPath)) return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const folders = fs.readdirSync(SRC_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name).sort().slice(0, SOURCE_COUNT);
  const manifest = { sources: [] };
  for (let i = 0; i < folders.length; i++) {
    const src = largestWebp(path.join(SRC_DIR, folders[i]));
    const entry = { folder: folders[i], source: path.relative(SRC_DIR, src), files: {}, blur: null };
    const write = async (name, pipeline) => {
      const info = await pipeline.toFile(path.join(FIXTURE_DIR, name));
      entry.files[name] = { w: info.width, h: info.height, bytes: info.size };
    };
    await write(`orig-${i}.jpg`, sharp(src).flatten(FLAT).resize(3000, 2000, { fit: 'inside', withoutEnlargement: false }).jpeg({ quality: 90 }));
    await write(`lg-${i}.webp`, sharp(src).flatten(FLAT).resize(1280, 1280, { fit: 'inside' }).webp({ quality: 72 }));
    await write(`sm-${i}.webp`, sharp(src).flatten(FLAT).resize(640, 640, { fit: 'inside' }).webp({ quality: 72 }));
    await write(`xs-${i}.webp`, sharp(src).flatten(FLAT).resize(256, 256, { fit: 'inside' }).webp({ quality: 60 }));
    entry.blur = await thumbHashB64(src);
    manifest.sources.push(entry);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const m = await makeBenchImages({ force: process.argv.includes('--force') });
  console.log(`bench fixtures: ${m.sources.length} sources in ${FIXTURE_DIR}`);
}
