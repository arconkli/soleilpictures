// imageFilename — a downloaded image is named for what its bytes are
// (MEDIA-18), and a kept camera filename is left alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { originalFilename, imageExtFor, filenameFor } from './imageFilename.js';

const here = dirname(fileURLToPath(import.meta.url));
const URL_PNG = 'https://r2.example/ws/b/1a2b.png?X-Amz-Signature=abc';

test('a pasted PNG titled "Hero frame" downloads as Hero frame.png', () => {
  assert.equal(originalFilename(URL_PNG, 'Hero frame', 'image/png'), 'Hero frame.png');
  assert.equal(originalFilename(URL_PNG, 'Hero frame', 'image/webp'), 'Hero frame.webp');
  assert.equal(originalFilename(URL_PNG, 'Loop', 'image/gif'), 'Loop.gif');
  assert.equal(originalFilename(URL_PNG, 'Still', 'image/jpeg'), 'Still.jpg');
});

test('the key suffix decides when the type does not', () => {
  assert.equal(originalFilename(URL_PNG, 'Hero frame', ''), 'Hero frame.png');
  assert.equal(originalFilename(URL_PNG, 'Hero frame', 'application/octet-stream'), 'Hero frame.png');
  assert.equal(imageExtFor('', 'https://x/a/b.JPEG?sig=1'), 'jpg');
  assert.equal(imageExtFor('', 'https://x/a/b.bin'), null);
});

test('a kept filename keeps its own extension; no title falls back to the key', () => {
  assert.equal(originalFilename(URL_PNG, 'diner_ext_dusk_04.jpg', 'image/jpeg'), 'diner_ext_dusk_04.jpg');
  assert.equal(originalFilename(URL_PNG, 'scan.tif', 'image/tiff'), 'scan.tif');
  assert.equal(originalFilename(URL_PNG, '', 'image/png'), '1a2b.png');
  assert.equal(originalFilename('https://x/k', 'Mystery', ''), 'Mystery.jpg', 'nothing known: the old default');
  assert.equal(filenameFor(URL_PNG, 'Edited', 'png'), 'Edited.png');
});

test('downloadImage checks the response, re-signs once and never opens a tab', () => {
  const src = readFileSync(join(here, 'imageExport.js'), 'utf8');
  const entry = src.slice(src.indexOf('async function fetchImageBlob'));
  assert.match(entry, /res\.ok \?/);
  assert.match(entry, /getSignedUrl\(src\.slice\(3\), \{ force: true \}\)/);
  assert.doesNotMatch(entry, /window\.open\(/);
  assert.match(entry, /originalFilename\(url, title, blob\.type\)/);
  const cd = readFileSync(join(here, 'cardDownload.js'), 'utf8');
  assert.match(cd, /if \(!ok\) throw new AssetFetchError/, 'the canvas/list/detail toast hears about it');
});
