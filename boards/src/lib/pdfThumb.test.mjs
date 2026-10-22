// A PDF card without its page-1 picture gets one from the next writer who
// opens its cluster (usePdfThumbBackfill). These pin which cards qualify, what
// a finished backfill writes, which failures are for good, and the wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { needsPdfThumb, pdfCardHeight, pdfThumbPatch, pdfUnreadable } from './pdfThumb.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', p), 'utf8');
const pdf = (over = {}) => ({ id: 'pdf-1', kind: 'pdf', pdfSrc: 'r2:ws/a.pdf', src: null, w: 300, h: 388, ...over });

test('a PDF card with its file and no picture needs one', () => {
  assert.equal(needsPdfThumb(pdf()), true);
  // A message attachment's PDF is a public https URL the viewer already reads.
  assert.equal(needsPdfThumb(pdf({ pdfSrc: 'https://x.supabase.co/storage/v1/object/public/message-attachments/a.pdf' })), true);
  assert.equal(needsPdfThumb(pdf({ src: undefined })), true);
});

test('cards that do not', () => {
  assert.equal(needsPdfThumb(pdf({ src: 'r2:ws/a.webp' })), false, 'it has one');
  assert.equal(needsPdfThumb(pdf({ pending: true })), false, 'still uploading: the upload draws it');
  assert.equal(needsPdfThumb(pdf({ thumbFailed: 1 })), false, 'found unreadable before');
  assert.equal(needsPdfThumb(pdf({ pdfSrc: null })), false, 'no file to draw');
  assert.equal(needsPdfThumb(pdf({ pdfSrc: 'blob:http://localhost/1' })), false, '?local=1 blob');
  assert.equal(needsPdfThumb(pdf({ kind: 'file' })), false);
  assert.equal(needsPdfThumb(null), false);
});

test('the height follows the page at the card width, as an upload sizes it', () => {
  assert.equal(pdfCardHeight(300, 612, 792), 388, 'US Letter');
  assert.equal(pdfCardHeight(300, 792, 612), 232, 'landscape');
  assert.equal(pdfCardHeight(300, 1000, 100), 80, 'never under 80');
  assert.equal(pdfCardHeight(300, null, 792), null);
  assert.equal(pdfCardHeight(0, 612, 792), null);
});

test('a backfill writes the picture, the page count and the page shape', () => {
  const page = { src: 'r2:ws/p1.webp', pageCount: 12, width: 792, height: 612 };
  assert.deepEqual(pdfThumbPatch(pdf(), page), { src: 'r2:ws/p1.webp', pageCount: 12, h: 232 });
  // A placeholder already the page's shape (within 2%) keeps its height.
  assert.deepEqual(pdfThumbPatch(pdf(), { ...page, width: 612, height: 792 }), { src: 'r2:ws/p1.webp', pageCount: 12 });
  assert.deepEqual(pdfThumbPatch(pdf({ h: 395 }), { ...page, width: 612, height: 792 }), { src: 'r2:ws/p1.webp', pageCount: 12 });
  // A card someone made wider keeps its width; its height follows.
  assert.equal(pdfThumbPatch(pdf({ w: 600, h: 776 }), page).h, 464);
  // The count it already shows isn't rewritten.
  assert.deepEqual(pdfThumbPatch(pdf({ pageCount: 12 }), { ...page, width: 612, height: 792 }), { src: 'r2:ws/p1.webp' });
});

test('a page that would not draw still brings its count, and moves nothing', () => {
  assert.deepEqual(pdfThumbPatch(pdf(), { src: null, pageCount: 3, width: 792, height: 612 }), { pageCount: 3 });
  assert.deepEqual(pdfThumbPatch(pdf(), {}), {});
});

test('only a locked or broken file is marked never to try again', () => {
  assert.equal(pdfUnreadable({ name: 'PasswordException' }), true);
  assert.equal(pdfUnreadable({ name: 'InvalidPDFException' }), true);
  // A 404, a dropped connection or a chunk that is gone may pass next time.
  for (const name of ['MissingPDFException', 'UnexpectedResponseException', 'TypeError', 'Error']) {
    assert.equal(pdfUnreadable({ name }), false, name);
  }
  assert.equal(pdfUnreadable(null), false);
});

test('App runs the backfill on the open cluster, off the undo stack', () => {
  const app = read('App.jsx');
  const call = app.slice(app.indexOf('usePdfThumbBackfill({'), app.indexOf('usePdfThumbBackfill({') + 400);
  assert.match(call, /cards: currentCards, canEdit: canEditCurrent/);
  assert.match(call, /updateCardSilent: mainMutators\.updateCardMeta/);
});

test('an upload and a backfill draw page 1 the same way', () => {
  const up = read('lib/uploads.js');
  const uploadPdf = up.slice(up.indexOf('export async function uploadPdf('), up.indexOf('export async function uploadPdfPageOne('));
  assert.match(uploadPdf, /await uploadPdfPageOne\(/);
  assert.doesNotMatch(uploadPdf, /renderPageToCanvas/, 'one drawing, not two');
  // pdf.js stays in its own lazy chunk: uploads.js is in the eager graph.
  assert.doesNotMatch(up, /^import[^\n]*pdfEngine/m);
  assert.match(read('hooks/usePdfThumbBackfill.js'), /uploadPdfPageOne\(\{ source: url/);
});
