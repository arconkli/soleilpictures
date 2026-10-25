// uploadRetry — a single-PUT upload survives a brief network drop (MEDIA-10),
// a dead multipart session is not resumed for a day (MEDIA-11), and a paid
// owner's unreadable-length video is accepted (MEDIA-12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  uploadErrorStatus, isRetryableUploadError, presignAndPut, keepResumeSession, PUT_URL_FRESH_MS,
} from './uploadRetry.js';

const here = dirname(fileURLToPath(import.meta.url));
const netErr = () => new Error('Upload network error');

test('what counts as worth retrying', () => {
  assert.equal(isRetryableUploadError(netErr()), true);
  assert.equal(isRetryableUploadError(new Error('Upload failed: 503 Service Unavailable')), true);
  assert.equal(isRetryableUploadError(new Error('Upload failed: 403 Forbidden')), false);
  assert.equal(isRetryableUploadError(new Error('Upload aborted')), false);
  assert.equal(isRetryableUploadError(Object.assign(new Error('Storage is full'), { code: 402, noRetry: true })), false);
  assert.equal(uploadErrorStatus(Object.assign(new Error('x'), { code: 413 })), 413);
});

test('a PUT that drops twice lands on the third try with the same key', async () => {
  let presigns = 0; const puts = [];
  const signed = await presignAndPut({
    presign: async () => ({ uploadUrl: `u${++presigns}`, key: `k${presigns}` }),
    put: async (url) => { puts.push(url); if (puts.length < 3) throw netErr(); },
    wait: async () => {},
    now: () => 0,
  });
  assert.deepEqual(puts, ['u1', 'u1', 'u1']);
  assert.equal(presigns, 1);
  assert.equal(signed.key, 'k1');
});

test('an expired URL is re-presigned and the NEW key is returned', async () => {
  let t = 0; let presigns = 0; const puts = [];
  const signed = await presignAndPut({
    presign: async () => ({ uploadUrl: `u${++presigns}`, key: `k${presigns}` }),
    put: async (url) => { puts.push(url); if (url === 'u1') throw netErr(); },
    wait: async () => { t += PUT_URL_FRESH_MS + 1; },
    now: () => t,
  });
  assert.deepEqual(puts, ['u1', 'u2']);
  assert.equal(signed.key, 'k2');
});

test('a 4xx fails at once; a lasting outage fails after the tries run out', async () => {
  let puts = 0;
  await assert.rejects(presignAndPut({
    presign: async () => ({ uploadUrl: 'u', key: 'k' }),
    put: async () => { puts++; throw new Error('Upload failed: 400 Bad Request'); },
    wait: async () => {}, now: () => 0,
  }), /400/);
  assert.equal(puts, 1);
  puts = 0;
  await assert.rejects(presignAndPut({
    presign: async () => ({ uploadUrl: 'u', key: 'k' }),
    put: async () => { puts++; throw netErr(); },
    wait: async () => {}, now: () => 0, tries: 4,
  }), /network/);
  assert.equal(puts, 4);
});

test('only a response-less failure keeps a multipart resume session', () => {
  assert.equal(keepResumeSession(new Error('Part upload network error')), true);
  assert.equal(keepResumeSession(new TypeError('Failed to fetch')), true);
  for (const code of [402, 403, 413, 502, 503]) {
    assert.equal(keepResumeSession(Object.assign(new Error(`mpu/complete failed: ${code}`), { code })), false, String(code));
  }
  assert.equal(keepResumeSession(new Error('Part upload failed: 404 Not Found')), false);
  assert.equal(keepResumeSession(new Error('aborted')), false);
});

test('uploads.js routes every single-PUT path and the multipart catch through it', () => {
  const src = readFileSync(join(here, 'uploads.js'), 'utf8');
  assert.equal((src.match(/await presignAndPutFile\(/g) || []).length, 4, 'image, audio, pdf, video');
  assert.doesNotMatch(src, /const \{ uploadUrl, key \} = await presign\(\{ workspaceId, boardId, file \}\);/);
  assert.match(src, /if \(!keepResumeSession\(err\)\)/);
  assert.match(src, /const ownsResume = !activeFingerprints\.has\(fp\);/);
  // MEDIA-12: unreadable length fails closed only under a finite limit.
  assert.match(src, /if \(unreadable && Number\.isFinite\(maxDurationSec\)\)/);
});

test('a PUT that goes quiet is cut off and retried, and a clip it cannot measure never holds the upload', () => {
  // A dead connection that never errors read as "Uploading" until the
  // abandoned-upload sweep removed the card a day later.
  assert.equal(isRetryableUploadError(new Error('Upload stalled')), true);
  assert.equal(isRetryableUploadError(new Error('Part upload stalled')), true);
  const src = readFileSync(join(here, 'uploads.js'), 'utf8');
  const single = src.slice(src.indexOf('function putWithProgress('), src.indexOf('function presignAndPutFile('));
  assert.match(single, /stop = watchStall\(xhr, \(\) => fail\(new Error\('Upload stalled'\), \{ stalled: true \}\)\)/);
  const part = src.slice(src.indexOf('function putPartWithProgress('), src.indexOf('async function putPartWithRetry('));
  assert.match(part, /stop = watchStall\(xhr, \(\) => fail\(new Error\('Part upload stalled'\), \{ stalled: true \}\)\)/);
  // fail() records the try (errorReporting's noteRequest, as a fetch's
  // failure is) and settles with the same error, so the retry still sees it.
  for (const put of [single, part]) {
    assert.match(put, /const fail = \(err, extra\) => \{ if \(!settled\) putFailed\(xhr, url, t0, extra\); settle\(reject, err\); \};/);
  }
  // A PUT called off (the person stopped it, or the stall's own abort) is
  // nobody's failure: it settles without fail().
  assert.match(single, /xhr\.onabort = \(\) => settle\(reject, new Error\('Upload aborted'\)\);/);
  assert.match(part, /xhr\.onabort = \(\) => settle\(reject, new Error\('aborted'\)\);/);
  assert.match(src, /noteRequest\(\{ url, method: 'PUT', status: xhr\.status, ms: performance\.now\(\) - t0, retried: true, \.\.\.extra \}\);/);
  // The stall settles first, so its own abort doesn't read as a cancel.
  assert.match(src, /t = setTimeout\(\(\) => \{ onStall\(\); try \{ xhr\.abort\(\); \} catch \(_\) \{\} \}, ms\);/);
  // uploadVideo waits on readVideoMeta before it sends a byte.
  const meta = src.slice(src.indexOf('export function readVideoMeta('), src.indexOf('export function captureVideoPoster('));
  assert.match(meta, /setTimeout\(\(\) => done\(unread\), timeoutMs\)/);
});
