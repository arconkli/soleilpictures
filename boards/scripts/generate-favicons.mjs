#!/usr/bin/env node
// Generate the PWA icon set + a real /favicon.ico into public/.
//
// Why: the manifest used to point at ../icons/icon-*.webp — files that (a) were
// never in public/ so /icons/* served the SPA HTML fallback, and (b) were PNG
// bytes mislabeled .webp. And /favicon.ico didn't exist (crawlers/browsers that
// hard-request it got an HTML page). This script regenerates truthful PNGs from
// the 2048² capacitor source and builds an ICO with embedded PNGs (sharp can't
// write ICO; the format is trivial: ICONDIR + one ICONDIRENTRY per image).
//
//   node scripts/generate-favicons.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const ICON_SRC = resolve(ROOT, 'assets/icon-only.png');       // 2048×2048
const FAVICON_SRC = resolve(ROOT, 'public/favicon.png');      // 512×512
const OUT_ICONS = resolve(ROOT, 'public/icons');

const SIZES = [48, 72, 96, 128, 192, 256, 512];

// ICO container with embedded PNG images (valid since Vista; universally read).
function buildIco(pngs /* [{size, bytes}] */) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type: icon
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + 16 * count;
  for (const { size, bytes } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);  // width (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1);  // height
    e.writeUInt8(0, 2);                        // palette
    e.writeUInt8(0, 3);                        // reserved
    e.writeUInt16LE(1, 4);                     // planes
    e.writeUInt16LE(32, 6);                    // bpp
    e.writeUInt32LE(bytes.length, 8);          // data size
    e.writeUInt32LE(offset, 12);               // data offset
    entries.push(e);
    offset += bytes.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.bytes)]);
}

mkdirSync(OUT_ICONS, { recursive: true });

// 1) PWA icons from the 2048² source.
for (const size of SIZES) {
  const bytes = await sharp(readFileSync(ICON_SRC))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(resolve(OUT_ICONS, `icon-${size}.png`), bytes);
  console.log(`✓ public/icons/icon-${size}.png (${bytes.length} bytes)`);
}

// 2) favicon.ico (16 + 32 + 48 embedded PNGs) from the 512² favicon source.
const favPngs = [];
for (const size of [16, 32, 48]) {
  const bytes = await sharp(readFileSync(FAVICON_SRC))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
  favPngs.push({ size, bytes });
}
const ico = buildIco(favPngs);
writeFileSync(resolve(ROOT, 'public/favicon.ico'), ico);
console.log(`✓ public/favicon.ico (${ico.length} bytes)`);
