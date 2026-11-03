// transferWords.test.mjs — what a failed upload or download toast says.
//
//   node --test src/lib/transferWords.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { uploadFailedWords, downloadFailedWords } from './transferWords.js';
import { ZipReadError } from './zipRead.js';

test('machine talk becomes one plain sentence', () => {
  for (const msg of [
    'Failed to fetch',
    'Load failed',
    'NetworkError when attempting to fetch resource.',
    'Upload network error',
    'Upload stalled',
    'Presign failed: 403 forbidden',
    'Part upload failed: 500 Internal Server Error',
    'Missing ETag on part response (R2 CORS ExposeHeaders)',
    'workspaceId required',
    '',
  ]) {
    assert.equal(uploadFailedWords(new Error(msg)), "Couldn't upload that file. Try again.", msg);
    assert.equal(downloadFailedWords(new Error(msg)), "Couldn't download that file. Try again.", msg);
  }
  assert.equal(uploadFailedWords(null), "Couldn't upload that file. Try again.");
  assert.equal(downloadFailedWords('Load failed'), "Couldn't download that file. Try again.");
});

test("a reason written for the person reaches them as it is", () => {
  for (const msg of [
    "Storage is full for this cluster's owner — free up space or upgrade to add more.",
    'Video too large (900 MB; max 500 MB)',
    'Video too long (700s; max 600s)',
    'PDF too large (120 MB; max 100 MB)',
    'Could not finish saving the PDF — please try again.',
    'Could not read the video length — re-export and try again.',
    'Not signed in',
  ]) assert.equal(uploadFailedWords(new Error(msg)), `Upload failed: ${msg}`, msg);
});

test('a caller can say what failed', () => {
  assert.equal(uploadFailedWords(new Error('Load failed'), "Couldn't upload the cover. Try again."), "Couldn't upload the cover. Try again.");
  assert.equal(downloadFailedWords(new Error('Failed to fetch'), "Couldn't download the zip. Try again."), "Couldn't download the zip. Try again.");
});

test('a zip that cannot be read gets a sentence by its code', () => {
  const want = {
    not_zip: "Couldn't open that zip: it isn't a zip file.",
    truncated: "Couldn't open that zip: it's damaged or incomplete.",
    crc: "Couldn't open that file: it's damaged inside the zip.",
    no_inflate: "This browser can't open zip files. Try updating it.",
    too_big: 'That zip is too big for this browser to open.',
  };
  for (const [code, words] of Object.entries(want)) {
    const err = new ZipReadError(code, 'Entry failed its checksum.');
    assert.equal(uploadFailedWords(err), words, code);
    assert.equal(downloadFailedWords(err), words, code);
  }
  const weird = new ZipReadError('weird', 'x');
  assert.equal(uploadFailedWords(weird), "Couldn't upload that file. Try again.");
  assert.equal(downloadFailedWords(weird), "Couldn't download that file. Try again.");
});

test('a file storage no longer has says so', () => {
  assert.equal(downloadFailedWords(new Error('Storage returned 404')), "Couldn't find that file. It may have been deleted.");
  assert.equal(downloadFailedWords(new Error('Storage returned 403')), "Couldn't download that file. Try again.");
});

test('an upload refused to a view-only person says so', () => {
  const words = "You can't add files to this cluster.";
  assert.equal(uploadFailedWords(new Error('Presign failed: 403 {"error":"Not allowed to upload to this board","reason":"not_writer"}')), words);
  assert.equal(uploadFailedWords(new Error('Presign failed: 403 Not allowed to upload to this board')), words);
});
