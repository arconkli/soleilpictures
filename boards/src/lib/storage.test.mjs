// storage.test.mjs — the B2 / R2 storage layer and its switch. See storage.js.
//
//   node --import ./scripts/linguiNode.mjs --test src/lib/storage.test.mjs
//
// A fake fetch records every request and answers from a script; fake R2
// objects stand in for the binding. Nothing here touches the network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  B2, B2_UPLOAD_TAG, parseStorageConfig, backendForKey, readsFallBack, makeConfigReader, s3Bucket, routedBucket,
} from './storage.js';

const md5 = (bytes) => createHash('md5').update(bytes).digest('base64');

function fakeFetch(handler) {
  const calls = [];
  const fn = async (req) => {
    const body = req.body ? new Uint8Array(await req.clone().arrayBuffer()) : null;
    const call = { method: req.method, url: req.url, headers: req.headers, body, text: body ? new TextDecoder().decode(body) : '' };
    calls.push(call);
    return handler(call, calls.length);
  };
  fn.calls = calls;
  return fn;
}

const bucketWith = (handler, extra = {}) => {
  const fetch = fakeFetch(handler);
  const bucket = s3Bucket({
    endpoint: B2.endpoint, region: B2.region, bucket: 'bkt', accessKeyId: 'kid', secretAccessKey: 'secret', fetch, md5, ...extra,
  });
  return { bucket, fetch };
};
const xml = (status, body) => new Response(body, { status, headers: { 'content-type': 'application/xml' } });
const errXml = (status, code) => xml(status, `<?xml version="1.0"?><Error><Code>${code}</Code></Error>`);

// ── config ─────────────────────────────────────────────────────────────────

test('parseStorageConfig: defaults and cleaning', () => {
  const d = { mode: 'r2', workspaces: [], fallback: false };
  for (const bad of [null, undefined, '', 'nope', '{', 5, [], {}, { mode: 'x' }, '{"mode":"s3"}']) {
    assert.deepEqual(parseStorageConfig(bad), d);
  }
  assert.deepEqual(parseStorageConfig({ mode: 'b2' }), { mode: 'b2', workspaces: [], fallback: false });
  assert.deepEqual(parseStorageConfig('{"mode":"r2","fallback":true}'), { mode: 'r2', workspaces: [], fallback: true });
  assert.equal(parseStorageConfig({ mode: 'r2', fallback: 'yes' }).fallback, false);
  assert.deepEqual(
    parseStorageConfig({ mode: 'canary', workspaces: [' ABC ', 'abc', 7, null, 'def', ''] }).workspaces, ['abc', 'def']);
  const many = Array.from({ length: 300 }, (_, i) => `w${i}`);
  assert.equal(parseStorageConfig({ mode: 'canary', workspaces: many }).workspaces.length, 200);
});

test('backendForKey and readsFallBack per mode', () => {
  const r2 = parseStorageConfig({ mode: 'r2' });
  const rb = parseStorageConfig({ mode: 'r2', fallback: true });
  const canary = parseStorageConfig({ mode: 'canary', workspaces: ['abc'] });
  const b2 = parseStorageConfig({ mode: 'b2' });
  assert.equal(backendForKey('abc/x.png', r2), 'r2');
  assert.equal(backendForKey('abc/x.png', rb), 'r2');
  assert.equal(backendForKey('ABC/x.png', canary), 'b2');
  assert.equal(backendForKey('other/x.png', canary), 'r2');
  assert.equal(backendForKey('boards/1/ops/a', canary), 'r2');
  assert.equal(backendForKey('other/x.png', b2), 'b2');
  assert.equal(readsFallBack(r2), false);
  assert.equal(readsFallBack(rb), true);
  assert.equal(readsFallBack(canary), true);
  assert.equal(readsFallBack(b2), true);
});

test('config reader: cold, fresh, stale, failure, override, sharing', async () => {
  let t = 0;
  let loads = 0;
  let value = { mode: 'b2' };
  let fail = false;
  const reader = makeConfigReader({
    load: async () => { loads++; if (fail) throw new Error('down'); return value; }, ttlMs: 1000, failTtlMs: 200, now: () => t,
  });
  assert.equal(reader.peek(), null);
  const [a, b] = await Promise.all([reader.get(), reader.get()]);
  assert.equal(loads, 1);
  assert.equal(a.mode, 'b2');
  assert.equal(b, a);
  assert.equal(reader.peek().mode, 'b2');
  t = 500;
  await reader.get();
  assert.equal(loads, 1);
  // Stale: the old value at once, the refresh handed to waitUntil.
  t = 1500;
  value = { mode: 'canary', workspaces: ['x'] };
  const waited = [];
  assert.equal((await reader.get((p) => waited.push(p))).mode, 'b2');
  assert.equal(waited.length, 1);
  await waited[0];
  assert.equal(loads, 2);
  assert.equal((await reader.get()).mode, 'canary');
  // Failing refresh keeps the last good value and waits failTtlMs.
  t = 3000;
  fail = true;
  const w2 = [];
  assert.equal((await reader.get((p) => w2.push(p))).mode, 'canary');
  await w2[0];
  assert.equal(loads, 3);
  t = 3100;
  await reader.get();
  assert.equal(loads, 3);
  t = 3300;
  await (await reader.get((p) => w2.push(p)), w2[1]);
  assert.equal(loads, 4);

  // Cold failure: the r2 default, no retry before failTtlMs.
  let n = 0;
  let t2 = 0;
  const cold = makeConfigReader({ load: async () => { n++; throw new Error('x'); }, failTtlMs: 200, now: () => t2 });
  assert.deepEqual(await cold.get(), { mode: 'r2', workspaces: [], fallback: false });
  t2 = 100;
  assert.equal((await cold.get()).mode, 'r2');
  assert.equal(n, 1);
  t2 = 300;
  await cold.get();
  assert.equal(n, 2);
  // A missing row is a good answer: the default, cached.
  let m = 0;
  const empty = makeConfigReader({ load: async () => { m++; return null; } });
  assert.equal((await empty.get()).mode, 'r2');
  await empty.get();
  assert.equal(m, 1);

  let called = 0;
  const o = makeConfigReader({ load: async () => { called++; return null; }, override: { mode: 'b2' } });
  assert.equal((await o.get()).mode, 'b2');
  assert.equal(o.peek().mode, 'b2');
  assert.equal(called, 0);
});

test('config reader: a load that never settles does not hang a cold caller', async () => {
  const timers = [];
  const timer = { set: (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length - 1; }, clear: (id) => { timers[id].cleared = true; } };
  const reader = makeConfigReader({ load: () => new Promise(() => {}), timer, waitMs: 2000 });
  const first = reader.get();
  const second = reader.get();
  assert.equal(timers.length, 2);
  assert.equal(timers[1].ms, 2000);
  timers[1].fn();
  assert.deepEqual(await second, { mode: 'r2', workspaces: [], fallback: false });
  timers[0].fn();
  assert.deepEqual(await first, { mode: 'r2', workspaces: [], fallback: false });
});

test('config reader: a dead refresh is replaced and the old one cannot overwrite', async () => {
  let t = 0;
  const timers = [];
  const timer = { set: (fn) => { timers.push(fn); return timers.length - 1; }, clear: () => {} };
  const resolvers = [];
  let loads = 0;
  const reader = makeConfigReader({
    load: () => { loads++; return new Promise((r) => resolvers.push(r)); }, timer, deadMs: 5000, now: () => t,
  });
  const a = reader.get();
  await null; await null;
  assert.equal(loads, 1);
  t = 6000;
  const b = reader.get();
  await null; await null;
  assert.equal(loads, 2);
  // The newer load settles, then the abandoned one settles with something else.
  resolvers[1]({ mode: 'b2' });
  assert.equal((await b).mode, 'b2');
  resolvers[0]({ mode: 'canary', workspaces: ['x'] });
  await a;
  assert.equal(reader.peek().mode, 'b2');
  // A late abandoned settle must not clear a newer inflight either.
  t = 50000;
  const c = reader.get(() => {});
  assert.equal((await c).mode, 'b2');
  await null; await null;
  const loadsBefore = loads;
  t = 60000;
  reader.get(() => {});
  await null; await null;
  assert.equal(loads, loadsBefore + 1);
  const d = reader.get(() => {});
  await null; await null;
  assert.equal(loads, loadsBefore + 1, 'newer inflight is still shared');
  resolvers.at(-1)({ mode: 'r2' });
  await d;
});

test('config reader: the cold-path refresh is handed to waitUntil', async () => {
  const reader = makeConfigReader({ load: async () => ({ mode: 'b2' }) });
  const waited = [];
  assert.equal((await reader.get((p) => waited.push(p))).mode, 'b2');
  assert.equal(waited.length, 1);
  assert.equal((await waited[0]).mode, 'b2');
});

test('config reader: a load that resolves before waitMs clears its timer', async () => {
  const timers = [];
  const timer = { set: () => { timers.push({ cleared: false }); return timers.length - 1; }, clear: (id) => { timers[id].cleared = true; } };
  const reader = makeConfigReader({ load: async () => ({ mode: 'b2' }), timer });
  assert.equal((await reader.get()).mode, 'b2');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].cleared, true);
});

// ── s3Bucket: reads ────────────────────────────────────────────────────────

const objHeaders = (extra = {}) => ({
  etag: '"abc123"', 'last-modified': 'Wed, 18 Nov 2026 10:00:00 GMT', 'content-type': 'image/png',
  'cache-control': 'public, max-age=60', 'content-disposition': 'inline', 'content-language': 'en',
  'x-amz-meta-board-id': 'b1', 'x-amz-version-id': 'v9', ...extra,
});

test('get: full object, metadata, URL encoding, signing', async () => {
  const { bucket, fetch } = bucketWith(() => new Response('hello', { status: 200, headers: { ...objHeaders(), 'content-length': '5' } }));
  const o = await bucket.get('ws/a b/ü.png');
  assert.equal(fetch.calls[0].method, 'GET');
  assert.equal(fetch.calls[0].url, 'https://s3.us-east-005.backblazeb2.com/bkt/ws/a%20b/%C3%BC.png');
  assert.match(fetch.calls[0].headers.get('authorization'), /^AWS4-HMAC-SHA256 Credential=kid\/\d{8}\/us-east-005\/s3\/aws4_request/);
  assert.equal(o.key, 'ws/a b/ü.png');
  assert.equal(o.size, 5);
  assert.equal(o.etag, 'abc123');
  assert.equal(o.httpEtag, '"abc123"');
  assert.ok(o.uploaded instanceof Date);
  assert.equal(o.uploaded.toISOString(), '2026-11-18T10:00:00.000Z');
  assert.equal(o.version, 'v9');
  assert.deepEqual(o.httpMetadata, {
    contentType: 'image/png', contentLanguage: 'en', contentDisposition: 'inline', cacheControl: 'public, max-age=60',
  });
  assert.deepEqual(o.customMetadata, { 'board-id': 'b1' });
  assert.deepEqual(o.checksums, {});
  assert.equal(o.storageClass, 'Standard');
  assert.equal(o.range, undefined);
  const h = new Headers();
  o.writeHttpMetadata(h);
  assert.equal(h.get('content-type'), 'image/png');
  assert.equal(h.get('cache-control'), 'public, max-age=60');
  assert.equal(o.bodyUsed, false);
  assert.equal(await o.text(), 'hello');
  assert.equal(o.bodyUsed, true);
  assert.ok(o.body);
});

test('get: body readers', async () => {
  const mk = () => bucketWith(() => new Response('{"a":1}', { status: 200, headers: objHeaders() })).bucket;
  assert.deepEqual(await (await mk().get('k')).json(), { a: 1 });
  assert.equal((await (await mk().get('k')).arrayBuffer()).byteLength, 7);
  assert.equal((await (await mk().get('k')).blob()).size, 7);
});

test('get: every range form and Headers', async () => {
  const seen = [];
  const { bucket } = bucketWith((c) => {
    seen.push(c.headers.get('range'));
    return new Response('xy', { status: 206, headers: { ...objHeaders(), 'content-range': 'bytes 2-3/11', 'content-length': '2' } });
  });
  const o = await bucket.get('k', { range: { offset: 2, length: 2 } });
  await bucket.get('k', { range: { offset: 5 } });
  await bucket.get('k', { range: { suffix: 4 } });
  await bucket.get('k', { range: new Headers({ range: 'bytes=7-9' }) });
  assert.deepEqual(seen, ['bytes=2-3', 'bytes=5-', 'bytes=-4', 'bytes=7-9']);
  assert.equal(o.size, 11, 'size is the whole object, from Content-Range');
  assert.deepEqual(o.range, { offset: 2, length: 2 });
});

test('get: onlyIf object and Headers; 304 and 412 come back without a body', async () => {
  const seen = [];
  let status = 304;
  const { bucket } = bucketWith((c) => {
    seen.push(Object.fromEntries(['if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since']
      .map((h) => [h, c.headers.get(h)]).filter(([, v]) => v)));
    return new Response(null, { status, headers: { etag: '"abc123"' } });
  });
  const a = await bucket.get('k', { onlyIf: { etagDoesNotMatch: 'abc123' } });
  assert.deepEqual(seen[0], { 'if-none-match': '"abc123"' });
  assert.ok(a && !('body' in a) && a.etag === 'abc123' && a.httpEtag === '"abc123"');
  status = 412;
  const b = await bucket.get('k', { onlyIf: { etagMatches: '"zzz"', uploadedBefore: new Date('2026-01-01T00:00:00Z'), uploadedAfter: new Date('2025-01-01T00:00:00Z') } });
  assert.deepEqual(seen[1], {
    'if-match': '"zzz"', 'if-modified-since': 'Wed, 01 Jan 2025 00:00:00 GMT', 'if-unmodified-since': 'Thu, 01 Jan 2026 00:00:00 GMT',
  });
  assert.ok(b && !('body' in b));
  await bucket.get('k', { onlyIf: new Headers({ 'if-none-match': '"q"', 'if-modified-since': 'x', accept: 'ignored' }) });
  assert.deepEqual(seen[2], { 'if-none-match': '"q"', 'if-modified-since': 'x' });
});

test('get: 404 is null, 416 and other failures throw', async () => {
  let res = errXml(404, 'NoSuchKey');
  const { bucket } = bucketWith(() => res, { retries: 0 });
  assert.equal(await bucket.get('k'), null);
  res = errXml(416, 'InvalidRange');
  await assert.rejects(bucket.get('k', { range: { offset: 99 } }), /B2 GET 416 InvalidRange/);
  res = errXml(403, 'AccessDenied');
  await assert.rejects(bucket.get('k'), (e) => e.status === 403 && /B2 GET 403 AccessDenied/.test(e.message));
});

test('head: object-like, null on 404, size from Content-Length', async () => {
  let status = 200;
  const { bucket, fetch } = bucketWith(() => new Response(null, { status, headers: { ...objHeaders(), 'content-length': '42' } }));
  const o = await bucket.head('a/b.bin');
  assert.equal(fetch.calls[0].method, 'HEAD');
  assert.equal(o.size, 42);
  assert.equal(o.etag, 'abc123');
  assert.ok(!('body' in o));
  status = 404;
  assert.equal(await bucket.head('a/b.bin'), null);
  status = 403;
  await assert.rejects(bucket.head('a/b.bin'), /B2 HEAD 403/);
});

test('get: retries 503 and succeeds; gives up after the retries', async () => {
  let n = 0;
  const { bucket, fetch } = bucketWith(() => (++n < 3 ? errXml(503, 'ServiceUnavailable') : new Response('ok', { status: 200, headers: objHeaders() })));
  assert.equal(await (await bucket.get('k')).text(), 'ok');
  assert.equal(fetch.calls.length, 3);
  const always = bucketWith(() => errXml(503, 'ServiceUnavailable'), { retries: 1 });
  await assert.rejects(always.bucket.get('k'), /503 ServiceUnavailable/);
  assert.equal(always.fetch.calls.length, 2);
  let boom = 0;
  const net = bucketWith(() => { if (++boom < 2) throw new TypeError('network'); return new Response('ok', { status: 200, headers: objHeaders() }); });
  assert.equal(await (await net.bucket.get('k')).text(), 'ok');
});

// ── s3Bucket: writes ───────────────────────────────────────────────────────

test('put: bytes, headers, metadata, result', async () => {
  const { bucket, fetch } = bucketWith(() => new Response('', { status: 200, headers: { etag: '"e1"' } }));
  const o = await bucket.put('ws/a.txt', 'héllo', {
    httpMetadata: { contentType: 'text/plain', cacheControl: 'no-store', contentDisposition: 'attachment', cacheExpiry: new Date('2030-01-01T00:00:00Z') },
    customMetadata: { 'History-Batch': 'hourly', n: 3 },
  });
  const c = fetch.calls[0];
  assert.equal(c.method, 'PUT');
  assert.equal(c.text, 'héllo');
  assert.equal(c.headers.get('content-type'), 'text/plain');
  assert.equal(c.headers.get('cache-control'), 'no-store');
  assert.equal(c.headers.get('content-disposition'), 'attachment');
  assert.equal(c.headers.get('expires'), 'Tue, 01 Jan 2030 00:00:00 GMT');
  assert.equal(c.headers.get('x-amz-meta-history-batch'), 'hourly');
  assert.equal(c.headers.get('x-amz-meta-n'), '3');
  assert.equal(c.headers.get('x-amz-content-sha256'), 'UNSIGNED-PAYLOAD');
  assert.equal(o.key, 'ws/a.txt');
  assert.equal(o.size, 6);
  assert.equal(o.etag, 'e1');
  assert.equal(o.httpEtag, '"e1"');
  assert.ok(o.uploaded instanceof Date);
  assert.deepEqual(o.customMetadata, { 'history-batch': 'hourly', n: '3' });
  assert.equal(o.httpMetadata.contentType, 'text/plain');
});

test('put: value types, Headers httpMetadata, onlyIf 412 is null, failure throws', async () => {
  let status = 200;
  const { bucket, fetch } = bucketWith(() => new Response('', { status, headers: { etag: '"e"' } }), { retries: 0 });
  assert.equal((await bucket.put('a', new Uint8Array([1, 2, 3]))).size, 3);
  assert.equal((await bucket.put('a', new ArrayBuffer(4))).size, 4);
  assert.equal((await bucket.put('a', new Blob(['12345']))).size, 5);
  assert.equal((await bucket.put('a', null)).size, 0);
  await bucket.put('a', 'x', { httpMetadata: new Headers({ 'content-type': 'image/png', 'cache-control': 'x', 'x-other': 'no' }) });
  const last = fetch.calls.at(-1);
  assert.equal(last.headers.get('content-type'), 'image/png');
  assert.equal(last.headers.get('x-other'), null);
  status = 412;
  assert.equal(await bucket.put('a', 'x', { onlyIf: { etagDoesNotMatch: '*' } }), null);
  assert.equal(fetch.calls.at(-1).headers.get('if-none-match'), '"*"');
  status = 403;
  await assert.rejects(bucket.put('a', 'x'), /B2 PUT 403/);
});

test('put: a ReadableStream goes straight through and is never retried', async () => {
  const sent = [];
  const { bucket, fetch } = bucketWith(async (c) => { sent.push(c.text); return errXml(503, 'ServiceUnavailable'); });
  const stream = () => new Response('streamed-bytes').body;
  await assert.rejects(bucket.put('big', stream()), /503/);
  assert.equal(fetch.calls.length, 1);
  assert.equal(sent[0], 'streamed-bytes');
  assert.equal(fetch.calls[0].headers.get('x-amz-content-sha256'), 'UNSIGNED-PAYLOAD');
  const ok = bucketWith(() => new Response('', { status: 200, headers: { etag: '"s"' } }));
  const o = await ok.bucket.put('big', stream());
  assert.equal(o.size, undefined, 'size unknown for a stream');
  assert.equal(ok.fetch.calls[0].text, 'streamed-bytes');
});

test('put: retries 503 for bytes, re-signing each attempt', async () => {
  let n = 0;
  const { bucket, fetch } = bucketWith(() => (++n === 1 ? errXml(503, 'ServiceUnavailable') : new Response('', { status: 200, headers: { etag: '"r"' } })));
  const o = await bucket.put('k', 'abc');
  assert.equal(o.etag, 'r');
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[1].text, 'abc');
  assert.ok(fetch.calls[1].headers.get('authorization'));
});

// ── s3Bucket: delete ───────────────────────────────────────────────────────

test('delete one: 204 and 404 are fine, other errors throw', async () => {
  let status = 204;
  const { bucket, fetch } = bucketWith(() => new Response(null, { status }), { retries: 0 });
  await bucket.delete('a/b');
  assert.equal(fetch.calls[0].method, 'DELETE');
  status = 404;
  await bucket.delete('a/b');
  status = 403;
  await assert.rejects(bucket.delete('a/b'), /B2 DELETE 403/);
});

test('delete many: XML body, Content-MD5 matches, escaping, chunks of 1000', async () => {
  const { bucket, fetch } = bucketWith(() => xml(200, '<DeleteResult></DeleteResult>'));
  await bucket.delete(['a/1.png', 'b&c<d>.png']);
  const c = fetch.calls[0];
  assert.equal(c.method, 'POST');
  assert.equal(c.url, 'https://s3.us-east-005.backblazeb2.com/bkt?delete');
  assert.equal(c.text, '<Delete><Quiet>true</Quiet><Object><Key>a/1.png</Key></Object><Object><Key>b&amp;c&lt;d&gt;.png</Key></Object></Delete>');
  assert.equal(c.headers.get('content-md5'), createHash('md5').update(c.body).digest('base64'));
  fetch.calls.length = 0;
  await bucket.delete(Array.from({ length: 2300 }, (_, i) => `k/${i}`));
  assert.equal(fetch.calls.length, 3);
  assert.deepEqual(fetch.calls.map((x) => (x.text.match(/<Object>/g) || []).length), [1000, 1000, 300]);
  for (const x of fetch.calls) assert.equal(x.headers.get('content-md5'), createHash('md5').update(x.body).digest('base64'));
  fetch.calls.length = 0;
  await bucket.delete([]);
  assert.equal(fetch.calls.length, 0);
});

test('errors keep the object key out of the message', async () => {
  const { bucket } = bucketWith(() => errXml(503, 'ServiceUnavailable'), { retries: 0 });
  await assert.rejects(bucket.delete('a/404abc/x.png'), (e) => !e.message.includes('404') && e.message === 'B2 DELETE 503 ServiceUnavailable' && e.key === 'a/404abc/x.png' && e.status === 503);
});

test('delete many: <Error> entries throw naming the first key and code', async () => {
  const { bucket } = bucketWith(() => xml(200,
    '<DeleteResult><Error><Key>a/2.png</Key><Code>AccessDenied</Code></Error><Error><Key>a/3.png</Key><Code>Other</Code></Error></DeleteResult>'));
  await assert.rejects(bucket.delete(['a/1.png', 'a/2.png', 'a/3.png']), /B2 DELETE AccessDenied/);
});

test('delete many: without an md5 option it uses crypto.subtle MD5 when present', async (t) => {
  try { await crypto.subtle.digest('MD5', new Uint8Array(1)); } catch (_) { t.skip('no MD5 in this runtime'); return; }
  const fetch = fakeFetch(() => xml(200, '<DeleteResult></DeleteResult>'));
  const bucket = s3Bucket({ endpoint: B2.endpoint, region: B2.region, bucket: 'bkt', accessKeyId: 'k', secretAccessKey: 's', fetch });
  await bucket.delete(['x']);
  assert.equal(fetch.calls[0].headers.get('content-md5'), createHash('md5').update(fetch.calls[0].body).digest('base64'));
});

// ── s3Bucket: multipart ────────────────────────────────────────────────────

test('multipart: create, part, complete (sorted XML, HEAD for size), abort, resume is sync', async () => {
  const { bucket, fetch } = bucketWith((c) => {
    if (c.method === 'POST' && c.url.endsWith('?uploads')) return xml(200, '<InitiateMultipartUploadResult><UploadId>up+1/x=</UploadId></InitiateMultipartUploadResult>');
    if (c.method === 'PUT') return new Response('', { status: 200, headers: { etag: '"p1"' } });
    if (c.method === 'POST') return xml(200, '<CompleteMultipartUploadResult><ETag>"z"</ETag></CompleteMultipartUploadResult>');
    if (c.method === 'HEAD') return new Response(null, { status: 200, headers: { ...objHeaders(), 'content-length': '10485760' } });
    return new Response(null, { status: 204 });
  });
  const up = await bucket.createMultipartUpload('ws/v.mp4', { httpMetadata: { contentType: 'video/mp4' }, customMetadata: { a: 'b' } });
  assert.equal(up.uploadId, 'up+1/x=');
  assert.equal(up.key, 'ws/v.mp4');
  assert.equal(fetch.calls[0].headers.get('content-type'), 'video/mp4');
  assert.equal(fetch.calls[0].headers.get('x-amz-meta-a'), 'b');
  const p = await up.uploadPart(2, new Uint8Array([1, 2]));
  assert.deepEqual(p, { partNumber: 2, etag: 'p1' });
  assert.equal(fetch.calls[1].url, 'https://s3.us-east-005.backblazeb2.com/bkt/ws/v.mp4?partNumber=2&uploadId=up%2B1%2Fx%3D');
  const done = await up.complete([{ partNumber: 2, etag: '"b"' }, { partNumber: 1, etag: 'a' }]);
  const c = fetch.calls[2];
  assert.equal(c.text, '<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>"a"</ETag></Part><Part><PartNumber>2</PartNumber><ETag>"b"</ETag></Part></CompleteMultipartUpload>');
  assert.equal(fetch.calls[3].method, 'HEAD');
  assert.equal(done.size, 10485760);
  await up.abort();
  assert.equal(fetch.calls[4].method, 'DELETE');
  assert.match(fetch.calls[4].url, /\?uploadId=up%2B1%2Fx%3D$/);
  const r = bucket.resumeMultipartUpload('ws/v.mp4', 'abc');
  assert.equal(typeof r.then, 'undefined', 'resume is synchronous');
  assert.equal(r.uploadId, 'abc');
  assert.equal(typeof r.uploadPart, 'function');
});

test('multipart: a 200 holding <Error> fails complete; a stream part is not retried', async () => {
  const { bucket } = bucketWith(() => xml(200, '<Error><Code>InternalError</Code></Error>'));
  const up = bucket.resumeMultipartUpload('k', 'id');
  await assert.rejects(up.complete([{ partNumber: 1, etag: 'a' }]), /InternalError/);
  const calls = [];
  const s = bucketWith((c) => { calls.push(c); return errXml(503, 'ServiceUnavailable'); });
  await assert.rejects(s.bucket.resumeMultipartUpload('k', 'id').uploadPart(1, new Response('data').body), /503/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, 'data');
});

test('list is not supported', () => {
  assert.throws(() => bucketWith(() => null).bucket.list(), /list is not supported on B2 here/);
});

// ── routedBucket ───────────────────────────────────────────────────────────

function fakeStore(name, files = {}) {
  const calls = [];
  const s = {
    name, files, calls, failWith: null,
    async get(k, o) { calls.push(['get', k, o]); if (s.failWith) throw s.failWith; return k in files ? { key: k, from: name, body: 'b' } : null; },
    async head(k) { calls.push(['head', k]); if (s.failWith) throw s.failWith; return k in files ? { key: k, from: name } : null; },
    async put(k, v, o) { calls.push(['put', k, v, o]); if (s.failWith) throw s.failWith; files[k] = v; return { key: k, from: name }; },
    async delete(k) { calls.push(['delete', k]); if (s.failWith) throw s.failWith; for (const x of [].concat(k)) delete files[x]; return `del-${name}`; },
    async createMultipartUpload(k, o) { calls.push(['create', k, o]); return { key: k, uploadId: `${name}-id`, uploadPart: async () => 'p', abort: async () => 'ab', complete: async () => 'done' }; },
    resumeMultipartUpload(k, id) { calls.push(['resume', k, id]); return { key: k, uploadId: id, from: name, uploadPart: async () => 'p', abort: async () => 'ab', complete: async () => 'done' }; },
    list(...a) { calls.push(['list', ...a]); return `list-${name}`; },
  };
  return s;
}
const routed = (cfg, { r2f = {}, b2f = {} } = {}) => {
  const r2 = fakeStore('r2', r2f);
  const b2 = fakeStore('b2', b2f);
  const reports = [];
  const bucket = routedBucket({ r2, b2, getConfig: async () => parseStorageConfig(cfg), report: (e, d) => reports.push([e, d]) });
  return { r2, b2, bucket, reports };
};

test('routedBucket: no B2 returns r2 itself', () => {
  const r2 = fakeStore('r2');
  assert.equal(routedBucket({ r2, b2: null, getConfig: async () => ({}) }), r2);
});

test('routedBucket in mode r2 is a pure pass-through', async () => {
  const { r2, b2, bucket, reports } = routed({ mode: 'r2' }, { r2f: { 'ws/a': 1 } });
  const o = { range: { offset: 1 } };
  const got = await bucket.get('ws/a', o);
  assert.equal(got.from, 'r2');
  assert.equal(r2.calls[0][2], o, 'same options object');
  assert.equal(await bucket.get('ws/missing'), null, 'a miss stays a miss, B2 untouched');
  await bucket.head('ws/a');
  const meta = { httpMetadata: {} };
  await bucket.put('ws/n', 'v', meta);
  assert.equal(r2.calls.at(-1)[3], meta);
  assert.equal(await bucket.delete(['ws/a']), 'del-r2', 'result untouched');
  await bucket.delete('ws/n');
  assert.equal((await bucket.createMultipartUpload('ws/m')).uploadId, 'r2-id', 'untagged');
  assert.equal(bucket.resumeMultipartUpload('ws/m', 'plain').from, 'r2');
  assert.equal(bucket.list({ prefix: 'x' }), 'list-r2');
  assert.equal(b2.calls.length, 0);
  assert.equal(reports.length, 0);
  // Same object comes back.
  const sentinel = { key: 'ws/s' };
  r2.get = async () => sentinel;
  assert.equal(await bucket.get('ws/s'), sentinel);
});

test('routedBucket: canary routes by workspace, b2 mode routes everything', async () => {
  const c = routed({ mode: 'canary', workspaces: ['wsb2'] }, { r2f: { 'other/x': 1 }, b2f: { 'wsb2/x': 1 } });
  assert.equal((await c.bucket.get('wsb2/x')).from, 'b2');
  assert.equal((await c.bucket.get('other/x')).from, 'r2');
  await c.bucket.put('wsb2/y', 'v');
  await c.bucket.put('other/y', 'v');
  assert.ok('wsb2/y' in c.b2.files && !('wsb2/y' in c.r2.files));
  assert.ok('other/y' in c.r2.files && !('other/y' in c.b2.files));
  const all = routed({ mode: 'b2' });
  await all.bucket.put('any/k', 'v');
  assert.ok('any/k' in all.b2.files);
});

test('routedBucket: reads fall back to the other store, both ways', async () => {
  const toR2 = routed({ mode: 'b2' }, { r2f: { 'ws/old': 1 } });
  assert.equal((await toR2.bucket.get('ws/old')).from, 'r2');
  assert.equal((await toR2.bucket.head('ws/old')).from, 'r2');
  assert.equal(toR2.reports[0][0], 'read_fallback');
  assert.equal(await toR2.bucket.get('ws/none'), null);
  const toB2 = routed({ mode: 'r2', fallback: true }, { b2f: { 'ws/new': 1 } });
  assert.equal((await toB2.bucket.get('ws/new')).from, 'b2');
  const canary = routed({ mode: 'canary', workspaces: ['w'] }, { r2f: { 'w/x': 1 } });
  assert.equal((await canary.bucket.get('w/x')).from, 'r2');
});

test('routedBucket: a body-less precondition result does not fall back', async () => {
  const { r2, b2, bucket } = routed({ mode: 'b2' }, { r2f: { k: 1 } });
  const pre = { key: 'k', etag: 'e' };
  b2.get = async () => pre;
  assert.equal(await bucket.get('k', { onlyIf: {} }), pre);
  assert.equal(r2.calls.length, 0);
});

test('routedBucket: primary throws', async () => {
  const a = routed({ mode: 'b2' }, { r2f: { k: 1 } });
  a.b2.failWith = new Error('b2 down');
  assert.equal((await a.bucket.get('k')).from, 'r2');
  assert.equal(a.reports[0][0], 'read_fallback_after_error');
  const b = routed({ mode: 'b2' });
  b.b2.failWith = new Error('b2 down');
  await assert.rejects(b.bucket.get('k'), /b2 down/);
  // Primary returns null, the other throws: report and null.
  const c = routed({ mode: 'b2' });
  c.r2.failWith = new Error('r2 down');
  assert.equal(await c.bucket.get('k'), null);
  assert.equal(c.reports[0][0], 'read_fallback_error');
  // A throwing reporter never breaks the read.
  const r2 = fakeStore('r2', { k: 1 });
  const bucket = routedBucket({ r2, b2: fakeStore('b2'), getConfig: async () => parseStorageConfig({ mode: 'b2' }), report: () => { throw new Error('x'); } });
  assert.equal((await bucket.get('k')).from, 'r2');
});

test('routedBucket: delete goes to both; a failure in either store rejects', async () => {
  const both = routed({ mode: 'b2' }, { r2f: { a: 1 }, b2f: { a: 1 } });
  await both.bucket.delete(['a']);
  assert.ok(!('a' in both.r2.files) && !('a' in both.b2.files));
  await both.bucket.delete('a');
  const sec = routed({ mode: 'b2' });
  sec.r2.failWith = new Error('r2 down');
  await assert.rejects(sec.bucket.delete(['a', 'b']), /r2 down/);
  assert.equal(sec.b2.calls.length, 1);
  assert.equal(sec.reports[0][0], 'delete_secondary_error');
  const prim = routed({ mode: 'b2' });
  prim.b2.failWith = new Error('b2 down');
  await assert.rejects(prim.bucket.delete(['a']), /b2 down/);
  // Canary: a key list spanning both stores fails if either primary fails.
  const mixed = routed({ mode: 'canary', workspaces: ['w'] });
  mixed.r2.failWith = new Error('r2 down');
  await assert.rejects(mixed.bucket.delete(['w/1', 'o/1']), /r2 down/);
  mixed.r2.failWith = null;
  mixed.b2.failWith = new Error('b2 down');
  await assert.rejects(mixed.bucket.delete('o/1'), /b2 down/);
  assert.equal(mixed.r2.calls.at(-1)[0], 'delete');
  const rollback = routed({ mode: 'r2', fallback: true });
  await rollback.bucket.delete('k');
  assert.equal(rollback.b2.calls.length, 1);
});

test('routedBucket: delete with both stores failing rejects with the primary error', async () => {
  const both = routed({ mode: 'b2' });
  both.r2.failWith = new Error('r2 down');
  both.b2.failWith = new Error('b2 down');
  await assert.rejects(both.bucket.delete('k'), /b2 down/);
  const ok = routed({ mode: 'b2' }, { r2f: { k: 1 }, b2f: { k: 1 } });
  await ok.bucket.delete('k');
  assert.equal(ok.r2.calls.length + ok.b2.calls.length, 2);
});

test('routedBucket: multipart ids are tagged on B2 and round-trip', async () => {
  const { r2, b2, bucket } = routed({ mode: 'canary', workspaces: ['w'] });
  const up = await bucket.createMultipartUpload('w/v.mp4', { httpMetadata: {} });
  assert.equal(up.uploadId, `${B2_UPLOAD_TAG}b2-id`);
  assert.equal(await up.uploadPart(1, 'x'), 'p');
  assert.equal(await up.complete([]), 'done');
  assert.equal(await up.abort(), 'ab');
  const r = bucket.resumeMultipartUpload('w/v.mp4', up.uploadId);
  assert.equal(typeof r.then, 'undefined', 'sync');
  assert.equal(r.uploadId, up.uploadId);
  assert.deepEqual(b2.calls.at(-1), ['resume', 'w/v.mp4', 'b2-id'], 'raw id reaches B2');
  const plain = await bucket.createMultipartUpload('o/v.mp4');
  assert.equal(plain.uploadId, 'r2-id');
  assert.equal(bucket.resumeMultipartUpload('o/v.mp4', 'r2-id').from, 'r2');
  assert.deepEqual(r2.calls.at(-1), ['resume', 'o/v.mp4', 'r2-id']);
  assert.equal(bucket.list('p'), 'list-r2');
});
