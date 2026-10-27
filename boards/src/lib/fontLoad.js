// A font file, loaded so a page can draw in it (FamilyFace's specimen,
// FileStages' page to try it on). The whole file is read, up to
// FONT_FACE_MAX_BYTES (past that the card keeps its icon), and becomes a
// FontFace named soleil-font-<n>, never by the font's own name, so a dropped
// font can't stand in for one of the app's. Its names come from the file
// itself (lib/fontInfo.js). One load per file, however many cards show it; a
// file the browser won't take as a font is remembered as such, a read that
// failed is not, so the next card tries again.

import { resolveSrc } from './r2.js';
import { readHead } from './fileHead.js';
import { fontInfo } from './fontInfo.js';
import { FONT_FACE_MAX_BYTES } from './fileFaceLimits.js';

const loads = new Map();
let count = 0;

async function load(src, sizeBytes, fileName) {
  const url = await resolveSrc(src);
  if (!url) throw new Error('font: no link');
  const { bytes, complete } = await readHead(url, FONT_FACE_MAX_BYTES, { size: sizeBytes ?? undefined });
  if (!complete || !bytes.length) return null;
  const cssFamily = `soleil-font-${count += 1}`;
  try {
    const face = new FontFace(cssFamily, bytes);
    await face.load();
    document.fonts.add(face);
  } catch {
    return null;
  }
  return { cssFamily, info: await fontInfo(bytes, fileName) };
}

// { cssFamily, info: { family, style, weight, format, license } }, or null
// for a font too big, broken or refused.
export function loadFontFile(src, { sizeBytes = null, fileName = '' } = {}) {
  if (!src || (Number.isFinite(sizeBytes) && sizeBytes > FONT_FACE_MAX_BYTES)) return Promise.resolve(null);
  const known = loads.get(src);
  if (known) return known;
  const p = load(src, sizeBytes, fileName).catch(() => { loads.delete(src); return null; });
  loads.set(src, p);
  return p;
}
