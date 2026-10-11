// downloadPlan + the download plumbing around it: a big file goes to the
// browser's download manager (MEDIA-09), a zip over the cap is refused before
// its bytes are fetched (MEDIA-08), and the signed attachment header cannot
// be broken out of by a filename.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wantsDirectDownload, knownBytes, DIRECT_DOWNLOAD_MIN_BYTES } from './downloadPlan.js';
import { assertZipFits, ZipLimitError, ZIP_MAX_BYTES } from './zipStore.js';
import { attachmentDisposition } from './attachmentDisposition.js';

const here = dirname(fileURLToPath(import.meta.url));
const MB = 1024 * 1024;

test('big or unknown-size files go to the browser; small ones, images and native do not', () => {
  assert.equal(wantsDirectDownload({ sizeBytes: 1.5 * 1024 * MB }, 'file'), true);
  assert.equal(wantsDirectDownload({ sizeBytes: DIRECT_DOWNLOAD_MIN_BYTES }, 'video'), true);
  assert.equal(wantsDirectDownload({}, 'video'), true, 'unknown size is treated as big');
  assert.equal(wantsDirectDownload({ pdfSrc: 'r2:x.pdf' }, 'pdf'), true);
  assert.equal(wantsDirectDownload({ sizeBytes: 3 * MB }, 'audio'), false);
  assert.equal(wantsDirectDownload({ sizeBytes: 900 * MB }, 'image'), false, 'images may need a bake');
  assert.equal(wantsDirectDownload({ sizeBytes: 900 * MB }, 'file', { native: true }), false);
});

test('a selection over the cap is refused from the sizes cards carry', () => {
  const items = Array.from({ length: 40 }, () => ({ kind: 'video', card: { sizeBytes: 30 * MB } }));
  assert.equal(knownBytes(items), 1200 * MB);
  assert.throws(() => assertZipFits(knownBytes(items), { entries: 40, atLeast: true }), (err) => {
    assert.ok(err instanceof ZipLimitError);
    assert.match(err.message, /^That is over 1200 MB — zip downloads are capped at 500 MB\.$/);
    return true;
  });
  assert.equal(knownBytes([{ card: {} }, { card: { sizeBytes: 'x' } }, null]), 0);
  assert.doesNotThrow(() => assertZipFits(ZIP_MAX_BYTES));
});

test('the zip path checks before fetching and aborts mid-fetch past the cap', () => {
  const src = readFileSync(join(here, 'cardDownload.js'), 'utf8');
  const bulk = src.slice(src.indexOf('export async function downloadCardAssets'));
  assert.ok(bulk.indexOf('assertZipFits(knownBytes(items)') < bulk.indexOf('fetchCardBlob('), 'refused before any fetch');
  assert.match(bulk, /fetchedBytes > ZIP_MAX_BYTES/);
  assert.match(bulk, /abort\?\.abort\(\)/);
});

test('a second click joins the download already being prepared', () => {
  const src = readFileSync(join(here, 'cardDownload.js'), 'utf8');
  assert.match(src, /const running = inFlight\.get\(key\);\s+if \(running\) return running;/);
});

test('the attachment header survives any filename', () => {
  assert.equal(attachmentDisposition('Kick 1.wav'), `attachment; filename="Kick 1.wav"; filename*=UTF-8''Kick%201.wav`);
  const evil = attachmentDisposition('a"; filename="x.exe\r\nSet-Cookie: y\\..\\/b.mov');
  assert.doesNotMatch(evil, /[\r\n]/);
  assert.equal((evil.match(/"/g) || []).length, 2, 'only the two quotes it adds');
  assert.match(attachmentDisposition('Café (draft)*.mov'), /filename="Caf_ \(draft\)\*\.mov"; filename\*=UTF-8''Caf%C3%A9%20%28draft%29%2A\.mov$/);
  assert.equal(attachmentDisposition('   '), null);
  assert.equal(attachmentDisposition('x'.repeat(400)).length < 400, true);
});

test('the party signs attachment URLs only when asked, from the shared helper', () => {
  const party = readFileSync(join(here, '..', '..', 'party', 'upload.ts'), 'utf8');
  assert.match(party, /import \{ attachmentDisposition \} from "\.\.\/src\/lib\/attachmentDisposition\.js";/);
  assert.match(party, /wanted \? \{ urls: out, downloads, ttl: READ_URL_TTL_SECONDS \} : \{ urls: out, ttl: READ_URL_TTL_SECONDS \}/);
});
