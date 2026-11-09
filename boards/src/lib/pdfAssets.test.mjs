import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pdfAssetParams } from './pdfAssets.js';
import { japaneseCidPdf } from './i18nFileFixtures.mjs';

test('pdfAssetParams: absolute URLs under the pdfjs version', () => {
  assert.deepEqual(pdfAssetParams('https://clusters.soleilpictures.com/b/x', '4.10.38'), {
    cMapUrl: 'https://clusters.soleilpictures.com/pdfjs/4.10.38/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: 'https://clusters.soleilpictures.com/pdfjs/4.10.38/standard_fonts/',
  });
});

const pdfjsDir = fileURLToPath(new URL('../../node_modules/pdfjs-dist/', import.meta.url));

async function pageText(extra) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: japaneseCidPdf(), verbosity: 0, ...extra }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  const text = tc.items.map((i) => i.str).join('');
  await doc.destroy();
  return text;
}

test('a Japanese PDF with a non-embedded font reads as nothing without the character maps', async () => {
  assert.equal(await pageText({}), '');
});

test('and reads correctly with them (why /pdfjs/<version>/ exists)', async () => {
  const text = await pageText({
    cMapUrl: `${pdfjsDir}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${pdfjsDir}standard_fonts/`,
  });
  assert.equal(text, 'こんにちは世界');
});

test('the build copies them and the engine passes them', () => {
  const root = new URL('../../', import.meta.url);
  assert.match(readFileSync(new URL('vite.config.js', root), 'utf8'), /soleil-pdfjs-assets/);
  assert.match(readFileSync(new URL('src/lib/pdfEngine.js', root), 'utf8'), /pdfAssetParams\(/);
});
