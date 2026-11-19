// uploadRetry — a single-PUT upload survives a brief network drop (MEDIA-10),
// a dead multipart session is not resumed for a day (MEDIA-11), and a paid
// owner's unreadable-length video is accepted (MEDIA-12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  uploadErrorStatus, isRetryableUploadError, presignAndPut, putPartRetrying, keepResumeSession, PUT_URL_FRESH_MS,
  PART_URL_FRESH_MS, PUT_TRIES, retryDelayMs, retryWait, retryingCall,
} from './uploadRetry.js';

const here = dirname(fileURLToPath(import.meta.url));
const netErr = () => new Error('Upload network error');

test('what counts as worth retrying', () => {
  assert.equal(isRetryableUploadError(netErr()), true);
  assert.equal(isRetryableUploadError(new Error('Upload failed: 503 Service Unavailable')), true);
  assert.equal(isRetryableUploadError(new Error('Upload failed: 403 Forbidden')), false);
  assert.equal(isRetryableUploadError(new Error('Upload failed: 429 Too Many Requests')), true);
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

test('which failures keep a multipart resume session', () => {
  const at = (code, mpuStep) => Object.assign(new Error(`mpu failed: ${code}`), { code, mpuStep });
  assert.equal(keepResumeSession(new Error('Part upload network error')), true);
  assert.equal(keepResumeSession(new TypeError('Failed to fetch')), true);
  assert.equal(keepResumeSession(at(429, 'sign-parts')), true);
  assert.equal(keepResumeSession(at(500, 'sign-parts')), false);
  assert.equal(keepResumeSession(at(503, 'create')), false);
  for (const code of [429, 500, 503]) assert.equal(keepResumeSession(at(code)), true, String(code));
  for (const code of [402, 403, 404, 413]) assert.equal(keepResumeSession(at(code)), false, String(code));
  assert.equal(keepResumeSession(new Error('Part upload failed: 404 Not Found')), false);
  assert.equal(keepResumeSession(at(502, 'complete')), false);
  assert.equal(keepResumeSession(at(0, 'complete')), true);
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

test('a part that got no response is retried on a freshly signed URL; a 5xx keeps its URL', async () => {
  const used = []; let resigns = 0;
  const etag = await putPartRetrying({
    url: 'u0',
    put: async (u) => { used.push(u); if (used.length < 3) throw netErr(); return '"e"'; },
    resign: async () => `u${++resigns}`,
    wait: async () => {},
  });
  assert.equal(etag, '"e"');
  assert.deepEqual(used, ['u0', 'u1', 'u2']);

  const used5 = []; let resigns5 = 0;
  await putPartRetrying({
    url: 'a',
    put: async (u) => { used5.push(u); if (used5.length < 2) throw new Error('Part upload failed: 503 x'); return 'ok'; },
    resign: async () => { resigns5++; return 'b'; },
    wait: async () => {},
  });
  assert.deepEqual(used5, ['a', 'a']);
  assert.equal(resigns5, 0);
});

test('a part whose re-sign fails retries the old URL; a 4xx or abort does not retry', async () => {
  const used = [];
  await putPartRetrying({
    url: 'old',
    put: async (u) => { used.push(u); if (used.length < 2) throw netErr(); return 'ok'; },
    resign: async () => { throw new Error('sign down'); },
    wait: async () => {},
  });
  assert.deepEqual(used, ['old', 'old']);
  let n = 0;
  await assert.rejects(putPartRetrying({
    url: 'x', put: async () => { n++; throw new Error('Part upload failed: 400 Bad Request'); },
    resign: async () => 'y', wait: async () => {},
  }), /400/);
  assert.equal(n, 1);
  await assert.rejects(putPartRetrying({
    url: 'x', put: async () => 'no', aborted: () => true, wait: async () => {},
  }), /aborted/);
});

test('the tries and URL lifetimes', () => {
  assert.equal(PUT_TRIES, 10);
  assert.equal(PART_URL_FRESH_MS, 45 * 60_000);
});

test('retryDelayMs grows, stays within +-20 % and caps', () => {
  assert.equal(retryDelayMs(0, { random: () => 0.5 }), 1000);
  assert.equal(retryDelayMs(2, { random: () => 0.5 }), 4000);
  assert.equal(retryDelayMs(0, { random: () => 0 }), 800);
  assert.equal(retryDelayMs(0, { random: () => 1 }), 1200);
  assert.equal(retryDelayMs(20, { random: () => 0.5 }), 30_000);
  assert.equal(retryDelayMs(20, { random: () => 1 }), 36_000);
  assert.equal(retryDelayMs(3, { baseMs: 10, maxMs: 50, random: () => 0.5 }), 50);
});

test('retryWait: backs off, waits for online, honours the cap, and aborts cleanly', async () => {
  const quick = { baseMs: 5, random: () => 0.5, isOffline: () => false };
  await retryWait(0, quick);

  // Offline: waits for the online callback, then backs off.
  let fire = null; let unsubbed = 0; const t0 = Date.now();
  const p = retryWait(0, { ...quick, isOffline: () => true, offlineCapMs: 5000,
    onOnline: (cb) => { fire = cb; return () => { unsubbed++; }; } });
  await new Promise(r => setTimeout(r, 30));
  let done = false; p.then(() => { done = true; });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(done, false, 'still waiting while offline');
  fire();
  await p;
  assert.ok(Date.now() - t0 >= 30);
  assert.equal(unsubbed, 1);

  // Offline and never back: the cap ends the wait.
  await retryWait(0, { ...quick, isOffline: () => true, offlineCapMs: 10, onOnline: () => () => {} });

  // Already aborted.
  const ac0 = new AbortController(); ac0.abort();
  await assert.rejects(retryWait(0, { ...quick, signal: ac0.signal }), /aborted/);

  // Aborted during the wait (backing off, and offline), listeners released.
  for (const isOffline of [() => false, () => true]) {
    const ac = new AbortController(); let un = 0;
    const w = retryWait(3, { baseMs: 5000, random: () => 0.5, isOffline, offlineCapMs: 5000,
      signal: ac.signal, onOnline: () => () => { un++; } });
    setTimeout(() => ac.abort(), 10);
    await assert.rejects(w, /aborted/);
    assert.equal(un, isOffline() ? 1 : 0);
  }
});

test('presignAndPut re-presigns inside the slot when the URL went stale waiting for it', async () => {
  let t = 0; let presigns = 0; const puts = [];
  const signed = await presignAndPut({
    presign: async () => ({ uploadUrl: `u${++presigns}`, key: `k${presigns}` }),
    put: async (url) => { puts.push(url); },
    wait: async () => {},
    now: () => t,
    slot: async (fn) => { t += PUT_URL_FRESH_MS + 1; return fn(); },
  });
  assert.deepEqual(puts, ['u2']);
  assert.equal(signed.key, 'k2');
});

test('presignAndPut: a 403 re-presigns once at once; a second 403 is thrown', async () => {
  let presigns = 0; const puts = []; let waits = 0;
  const signed = await presignAndPut({
    presign: async () => ({ uploadUrl: `u${++presigns}`, key: `k${presigns}` }),
    put: async (url) => { puts.push(url); if (url === 'u1') throw new Error('Upload failed: 403 Forbidden'); },
    wait: async () => { waits++; }, now: () => 0,
  });
  assert.deepEqual(puts, ['u1', 'u2']);
  assert.equal(signed.key, 'k2');
  assert.equal(waits, 0);
  puts.length = 0;
  await assert.rejects(presignAndPut({
    presign: async () => ({ uploadUrl: `v${++presigns}`, key: 'k' }),
    put: async (url) => { puts.push(url); throw new Error('Upload failed: 403 Forbidden'); },
    wait: async () => {}, now: () => 0,
  }), /403/);
  assert.equal(puts.length, 2);
});

test('presignAndPut runs every attempt through the slot', async () => {
  let slots = 0; let n = 0;
  await presignAndPut({
    presign: async () => ({ uploadUrl: 'u', key: 'k' }),
    put: async () => { if (++n < 3) throw netErr(); },
    wait: async () => {}, now: () => 0,
    slot: (fn) => { slots++; return fn(); },
  });
  assert.equal(slots, 3);
});

test('putPartRetrying resigns a URL older than freshMs when it gets its slot', async () => {
  let t = 0; const used = [];
  await putPartRetrying({
    url: 'old', signedAt: 0, now: () => t,
    put: async (u) => { used.push(u); return 'e'; },
    resign: async () => 'new', wait: async () => {},
    slot: async (fn) => { t = PART_URL_FRESH_MS + 1; return fn(); },
  });
  assert.deepEqual(used, ['new']);
});

test('putPartRetrying: a 403 resigns once and retries at once; a second 403 throws; a 429 is retried', async () => {
  const used = []; let waits = 0;
  await putPartRetrying({
    url: 'a',
    put: async (u) => { used.push(u); if (u === 'a') throw new Error('Part upload failed: 403 Forbidden'); return 'e'; },
    resign: async () => 'b', wait: async () => { waits++; },
  });
  assert.deepEqual(used, ['a', 'b']);
  assert.equal(waits, 0);
  let n = 0;
  await assert.rejects(putPartRetrying({
    url: 'a', put: async () => { n++; throw new Error('Part upload failed: 403 Forbidden'); },
    resign: async () => 'b', wait: async () => {},
  }), /403/);
  assert.equal(n, 2);
  let m = 0;
  await putPartRetrying({
    url: 'a', put: async () => { if (++m < 3) throw new Error('Part upload failed: 429 Too Many'); return 'e'; },
    resign: async () => 'b', wait: async () => {},
  });
  assert.equal(m, 3);
});

test('a part cancelled while waiting for a slot rejects without sending', async () => {
  let cancelled = false; let puts = 0;
  await assert.rejects(putPartRetrying({
    url: 'a', put: async () => { puts++; return 'e'; }, wait: async () => {},
    aborted: () => cancelled,
    slot: async (fn) => { cancelled = true; return fn(); },
  }), /aborted/);
  assert.equal(puts, 0);
});

test('retryingCall retries only retryable errors and stops when aborted', async () => {
  let n = 0;
  assert.equal(await retryingCall(async () => { if (++n < 3) throw netErr(); return 'ok'; }, { wait: async () => {} }), 'ok');
  assert.equal(n, 3);
  n = 0;
  await assert.rejects(retryingCall(async () => { n++; throw new Error('x failed: 400'); }, { wait: async () => {} }), /400/);
  assert.equal(n, 1);
  n = 0;
  await assert.rejects(retryingCall(async () => { n++; throw netErr(); }, { tries: 3, wait: async () => {} }), /network/);
  assert.equal(n, 3);
  n = 0; let stop = false;
  await assert.rejects(retryingCall(async () => { n++; stop = true; throw netErr(); }, { aborted: () => stop, wait: async () => {} }));
  assert.equal(n, 1);
});
