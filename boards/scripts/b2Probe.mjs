#!/usr/bin/env node
// Live checks that the Backblaze bucket does what Clusters relies on, signed
// the way party/upload.ts and the Worker sign for R2 today. Writes only under
// _probe/<run>/ and deletes every version it wrote before it exits.
//
//   ENV_FILE=… node scripts/b2Probe.mjs
//
// Reads B2_S3_ENDPOINT, B2_REGION, B2_BUCKET, the clusters-party key (it signs
// the browser's URLs) and the clusters-admin key (cleanup) from
// boards/scripts/.env (see scripts/b2Setup.mjs). ✓ pass, ✗ fail, · recorded.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AwsClient } from 'aws4fetch';
import { attachmentDisposition } from '../src/lib/attachmentDisposition.js';

const ENV_FILE = process.env.ENV_FILE || fileURLToPath(new URL('./.env', import.meta.url));
const env = Object.fromEntries(readFileSync(ENV_FILE, 'utf8').split('\n')
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
for (const k of ['B2_S3_ENDPOINT', 'B2_REGION', 'B2_BUCKET', 'B2_PARTY_KEY_ID', 'B2_PARTY_APP_KEY', 'B2_ADMIN_KEY_ID', 'B2_ADMIN_APP_KEY']) {
  if (!env[k]) { console.error(`✗ ${k} missing from ${ENV_FILE}`); process.exit(1); }
}

const ENDPOINT = env.B2_S3_ENDPOINT;
const BUCKET = env.B2_BUCKET;
const RUN = `_probe/${new Date().toISOString().replace(/[:.]/g, '-')}`;
const APP = 'https://clusters.soleilpictures.com';
const CC = 'public, max-age=604800, immutable'; // party/upload.ts READ_RESPONSE_CACHE_CONTROL
const PART1 = 5 * 1024 * 1024;
const PART2 = 1234;

const s3 = new AwsClient({ accessKeyId: env.B2_PARTY_KEY_ID, secretAccessKey: env.B2_PARTY_APP_KEY, service: 's3', region: env.B2_REGION });
const objectUrl = (key) => `${ENDPOINT}/${BUCKET}/${key}`;
const presign = async (url, method = 'GET', headers = {}, allHeaders = false) => (await s3.sign(
  new Request(url, { method, headers }), { aws: { signQuery: true, ...(allHeaders ? { allHeaders: true } : {}) } })).url;
const h = (res, name) => res.headers.get(name);
const code = (text) => text.match(/<Code>([^<]+)/)?.[1] || '';
const drain = async (res) => { await res.arrayBuffer().catch(() => null); return res; };
const completeXml = (parts) => `<CompleteMultipartUpload>${parts.map((p) => (
  `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>"${String(p.etag).replace(/^"+|"+$/g, '')}"</ETag></Part>`)).join('')}</CompleteMultipartUpload>`;

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass });
  console.log(`${pass === null ? '·' : pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}
async function step(name, fn) {
  try { await fn(); } catch (e) { record(name, false, `threw ${e.message}`); }
}

const META = {
  'history-batch': 'hourly', 'board-id': '00000000-0000-4000-8000-000000000000', 'from-seq': '1',
  'to-seq': '2', 'op-count': '2', 'merged-hash': 'abc123',
}; // worker-compaction.js customMetadata
const k1 = `${RUN}/small.txt`;
const k3 = `${RUN}/multipart.bin`;

await step('put + head with metadata (Worker style)', async () => {
  const put = await s3.fetch(objectUrl(k1), {
    method: 'PUT', body: 'hello probe',
    headers: { 'content-type': 'text/plain', ...Object.fromEntries(Object.entries(META).map(([k, v]) => [`x-amz-meta-${k}`, v])) },
  });
  const pt = await put.text();
  if (!put.ok) return record('put + head with metadata (Worker style)', false, `PUT ${put.status} ${code(pt)}`);
  const head = await drain(await s3.fetch(objectUrl(k1), { method: 'HEAD' }));
  const kept = Object.entries(META).every(([k, v]) => h(head, `x-amz-meta-${k}`) === v);
  record('put + head with metadata (Worker style)',
    head.status === 200 && h(head, 'content-length') === '11' && h(head, 'content-type') === 'text/plain'
      && Boolean(h(head, 'etag')) && Boolean(h(head, 'last-modified')) && kept,
    `HEAD ${head.status}, ${h(head, 'content-length')} bytes, ${h(head, 'content-type')}, etag ${h(head, 'etag')}, last-modified ${h(head, 'last-modified')}, metadata ${kept ? 'kept' : 'LOST'}`);
});

await step('ranged get', async () => {
  const r = await s3.fetch(objectUrl(k1), { headers: { range: 'bytes=2-5' } });
  const body = await r.text();
  record('ranged get', r.status === 206 && body === 'llo ' && h(r, 'content-range') === 'bytes 2-5/11',
    `${r.status} "${body}" content-range ${h(r, 'content-range')}`);
});

await step('conditional get (worker-keep)', async () => {
  const head = await drain(await s3.fetch(objectUrl(k1), { method: 'HEAD' }));
  const a = await drain(await s3.fetch(objectUrl(k1), { headers: { 'if-none-match': h(head, 'etag') } }));
  const b = await drain(await s3.fetch(objectUrl(k1), { headers: { 'if-modified-since': h(head, 'last-modified') } }));
  const c = await drain(await s3.fetch(objectUrl(k1), { headers: { 'if-match': '"0000"' } }));
  record('conditional get (worker-keep)', a.status === 304 && b.status === 304 && c.status === 412,
    `If-None-Match ${a.status}, If-Modified-Since ${b.status}, wrong If-Match ${c.status}`);
});

await step('presigned put (party /presign)', async () => {
  const k2 = `${RUN}/presigned-put.bin`;
  const declared = 1000;
  const url = await presign(`${objectUrl(k2)}?X-Amz-Expires=300`, 'PUT', { 'Content-Length': String(declared) }, true);
  const signed = /X-Amz-SignedHeaders=[^&]*content-length/i.test(url);
  record('presigned put: the length is signed', signed, signed ? '' : 'content-length missing from X-Amz-SignedHeaders');
  const exact = await drain(await fetch(url, { method: 'PUT', body: Buffer.alloc(declared, 97) }));
  record('presigned put: the declared length uploads', exact.status === 200, `${exact.status}`);
  const longer = await fetch(url, { method: 'PUT', body: Buffer.alloc(declared + 1, 97) });
  record('presigned put: a longer body is refused', longer.status === 403, `${longer.status} ${code(await longer.text())}`);
  const shorter = await fetch(url, { method: 'PUT', body: Buffer.alloc(declared - 1, 97) });
  record('presigned put: a shorter body is refused', shorter.status === 403, `${shorter.status} ${code(await shorter.text())}`);
  const typed = await drain(await fetch(url, { method: 'PUT', body: Buffer.alloc(declared, 98), headers: { 'content-type': 'image/png' } }));
  const head = await drain(await s3.fetch(objectUrl(k2), { method: 'HEAD' }));
  record('presigned put: the browser\'s content-type is kept', typed.status === 200 && h(head, 'content-type') === 'image/png',
    `${typed.status}, stored as ${h(head, 'content-type')}`);
});

await step('presigned get (party signReadUrl)', async () => {
  const disp = attachmentDisposition('Storyboard — Ünïcode (final).png');
  const url = await presign(`${objectUrl(k1)}?response-cache-control=${encodeURIComponent(CC)}`
    + `&response-content-disposition=${encodeURIComponent(disp)}&response-content-type=${encodeURIComponent('image/png')}`
    + '&X-Amz-Expires=604800');
  const r = await drain(await fetch(url));
  record('presigned get: a 7-day URL works', r.status === 200, `${r.status}`);
  record('presigned get: cache-control override', h(r, 'cache-control') === CC, `${h(r, 'cache-control')}`);
  record('presigned get: download name override', h(r, 'content-disposition') === disp, `${h(r, 'content-disposition')}`);
  record('presigned get: content-type override', h(r, 'content-type') === 'image/png', `${h(r, 'content-type')}`);
  const over = await fetch(await presign(`${objectUrl(k1)}?X-Amz-Expires=604801`));
  record('presigned get: 7 days + 1 second', null, `${over.status} ${code(await over.text())}`);
  const auto = new AwsClient({ accessKeyId: env.B2_PARTY_KEY_ID, secretAccessKey: env.B2_PARTY_APP_KEY, service: 's3', region: 'auto' });
  const a = await drain(await auto.fetch(objectUrl(k1), { method: 'HEAD' }));
  record('signing with region "auto" instead of the real one', null, `${a.status}`);
});

await step('cors', async () => {
  const putUrl = await presign(`${objectUrl(`${RUN}/cors.bin`)}?X-Amz-Expires=300`, 'PUT', { 'Content-Length': '10' }, true);
  const pre = await drain(await fetch(putUrl, {
    method: 'OPTIONS', headers: { origin: APP, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'content-type' },
  }));
  record('cors: upload preflight from the app',
    pre.ok && h(pre, 'access-control-allow-origin') === APP && /PUT/i.test(h(pre, 'access-control-allow-methods') || ''),
    `${pre.status}, allow-origin ${h(pre, 'access-control-allow-origin')}, methods ${h(pre, 'access-control-allow-methods')}, headers ${h(pre, 'access-control-allow-headers')}, max-age ${h(pre, 'access-control-max-age')}`);
  const put = await drain(await fetch(putUrl, { method: 'PUT', body: Buffer.alloc(10, 99), headers: { origin: APP, 'content-type': 'application/octet-stream' } }));
  record('cors: upload answer readable by the app', put.ok && h(put, 'access-control-allow-origin') === APP,
    `${put.status}, allow-origin ${h(put, 'access-control-allow-origin')}, expose ${h(put, 'access-control-expose-headers')}`);
  const getUrl = await presign(objectUrl(k1));
  for (const [label, origin, want] of [
    ['the app', APP, true],
    ['the main preview', 'https://main-soleil-boards.arconkli.workers.dev', true],
    ['another preview', 'https://a1b2c3d4-soleil-boards.arconkli.workers.dev', true],
    ['local dev', 'http://localhost:5173', true],
    ['a stranger', 'https://example.com', false],
  ]) {
    const r = await drain(await fetch(getUrl, { headers: { origin } }));
    const got = h(r, 'access-control-allow-origin');
    const exposed = (h(r, 'access-control-expose-headers') || '').toLowerCase();
    record(`cors: read from ${label}`, want ? (got === origin || got === '*') && exposed.includes('etag') : !got,
      `${r.status}, allow-origin ${got}, expose ${exposed || 'none'}`);
  }
  const tampered = getUrl.replace(/X-Amz-Signature=([0-9a-f])/, (m, c) => `X-Amz-Signature=${c === '0' ? '1' : '0'}`);
  const bad = await fetch(tampered, { headers: { origin: APP } });
  record('cors: on a refused signature', null, `${bad.status} ${code(await bad.text())}, allow-origin ${h(bad, 'access-control-allow-origin')}`);
  const missing = await fetch(await presign(objectUrl(`${RUN}/nothing-here`)), { headers: { origin: APP } });
  record('cors: on a missing file', null, `${missing.status} ${code(await missing.text())}, allow-origin ${h(missing, 'access-control-allow-origin')}`);
});

await step('multipart from the browser (party /mpu)', async () => {
  const create = await s3.fetch(`${objectUrl(k3)}?uploads`, { method: 'POST', headers: { 'Content-Type': 'video/mp4' } });
  const uploadId = (await create.text()).match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
  record('multipart: start', Boolean(uploadId), `${create.status}`);
  if (!uploadId) return;
  const parts = [];
  for (const [n, size] of [[1, PART1], [2, PART2]]) {
    const url = await presign(`${objectUrl(k3)}?partNumber=${n}&uploadId=${encodeURIComponent(uploadId)}&X-Amz-Expires=3600`, 'PUT');
    const pre = await drain(await fetch(url, { method: 'OPTIONS', headers: { origin: APP, 'access-control-request-method': 'PUT' } }));
    const r = await drain(await fetch(url, { method: 'PUT', body: Buffer.alloc(size, 100 + n), headers: { origin: APP } }));
    const etag = h(r, 'etag');
    const exposed = (h(r, 'access-control-expose-headers') || '').toLowerCase().includes('etag');
    record(`multipart: part ${n} from the browser`, pre.ok && r.ok && Boolean(etag) && exposed,
      `preflight ${pre.status}, put ${r.status}, etag ${etag ? 'sent' : 'missing'}, page can read it: ${exposed}`);
    parts.push({ partNumber: n, etag });
  }
  const done = await s3.fetch(`${objectUrl(k3)}?uploadId=${encodeURIComponent(uploadId)}`, {
    method: 'POST', body: completeXml(parts), headers: { 'Content-Type': 'application/xml' },
  });
  const text = await done.text();
  const head = await drain(await s3.fetch(objectUrl(k3), { method: 'HEAD' }));
  record('multipart: finish', done.ok && !/<Error>/.test(text) && Number(h(head, 'content-length')) === PART1 + PART2
    && h(head, 'content-type') === 'video/mp4', `${done.status} ${code(text)}, ${h(head, 'content-length')} bytes, ${h(head, 'content-type')}`);
  const range = await drain(await s3.fetch(objectUrl(k3), { headers: { range: 'bytes=0-99' } }));
  record('multipart: a ranged get tells the full size', h(range, 'content-range') === `bytes 0-99/${PART1 + PART2}`,
    `${range.status}, content-range ${h(range, 'content-range')}, content-length ${h(range, 'content-length')}`);
  const k = `${RUN}/aborted.bin`;
  const c2 = await s3.fetch(`${objectUrl(k)}?uploads`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' } });
  const id2 = (await c2.text()).match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
  const ab = await drain(await s3.fetch(`${objectUrl(k)}?uploadId=${encodeURIComponent(id2)}`, { method: 'DELETE' }));
  record('multipart: abort', ab.status === 204, `${ab.status}`);
});

await step('server-side copy (party file-save)', async () => {
  const source = (k) => `/${BUCKET}/${k.split('/').map(encodeURIComponent).join('/')}`;
  const k4 = `${RUN}/copy-single.txt`;
  const c = await s3.fetch(objectUrl(k4), { method: 'PUT', headers: { 'x-amz-copy-source': source(k1) } });
  const ct = await c.text();
  const head = await drain(await s3.fetch(objectUrl(k4), { method: 'HEAD' }));
  record('copy: CopyObject', c.ok && /<CopyObjectResult/.test(ct) && h(head, 'content-length') === '11',
    `${c.status} ${code(ct)}, copy is ${h(head, 'content-length')} bytes, ${h(head, 'content-type')}`);
  const k5 = `${RUN}/copy-parts.bin`;
  const create = await s3.fetch(`${objectUrl(k5)}?uploads`, { method: 'POST', headers: { 'Content-Type': 'video/mp4' } });
  const uploadId = (await create.text()).match(/<UploadId>([^<]+)<\/UploadId>/)?.[1];
  const parts = [];
  for (const [n, start, end] of [[1, 0, PART1 - 1], [2, PART1, PART1 + PART2 - 1]]) {
    const r = await s3.fetch(`${objectUrl(k5)}?partNumber=${n}&uploadId=${encodeURIComponent(uploadId)}`, {
      method: 'PUT', headers: { 'x-amz-copy-source': source(k3), 'x-amz-copy-source-range': `bytes=${start}-${end}` },
    });
    const t = await r.text();
    parts.push({ partNumber: n, etag: t.match(/<ETag>([^<]+)<\/ETag>/)?.[1]?.replace(/&quot;/g, '') || null, status: r.status, code: code(t) });
  }
  const done = await s3.fetch(`${objectUrl(k5)}?uploadId=${encodeURIComponent(uploadId)}`, {
    method: 'POST', body: completeXml(parts), headers: { 'Content-Type': 'application/xml' },
  });
  const dt = await done.text();
  const head2 = await drain(await s3.fetch(objectUrl(k5), { method: 'HEAD' }));
  record('copy: UploadPartCopy', parts.every((p) => p.etag) && done.ok && !/<Error>/.test(dt)
    && Number(h(head2, 'content-length')) === PART1 + PART2,
    `parts ${parts.map((p) => `${p.status}${p.code ? ` ${p.code}` : ''}`).join(', ')}, finish ${done.status} ${code(dt)}, ${h(head2, 'content-length')} bytes`);
});

await step('delete', async () => {
  const k6 = `${RUN}/to-delete.txt`;
  await drain(await s3.fetch(objectUrl(k6), { method: 'PUT', body: 'x' }));
  const one = await drain(await s3.fetch(objectUrl(k6), { method: 'DELETE' }));
  const gone = await drain(await s3.fetch(objectUrl(k6), { method: 'HEAD' }));
  record('delete: one file', one.status === 204 && gone.status === 404, `DELETE ${one.status}, then HEAD ${gone.status}`);
  const keys = [`${RUN}/bulk-a.txt`, `${RUN}/bulk-b.txt`];
  for (const k of keys) await drain(await s3.fetch(objectUrl(k), { method: 'PUT', body: 'y' }));
  const xml = `<Delete><Quiet>false</Quiet>${keys.map((k) => `<Object><Key>${k}</Key></Object>`).join('')}</Delete>`;
  const bulk = await s3.fetch(`${ENDPOINT}/${BUCKET}?delete`, {
    method: 'POST', body: xml,
    headers: { 'content-md5': createHash('md5').update(xml).digest('base64'), 'content-type': 'application/xml' },
  });
  const bt = await bulk.text();
  const deleted = (bt.match(/<Deleted>/g) || []).length;
  const goneA = await drain(await s3.fetch(objectUrl(keys[0]), { method: 'HEAD' }));
  record('delete: many at once (DeleteObjects)', bulk.ok && deleted === 2 && goneA.status === 404,
    `${bulk.status} ${code(bt)}, ${deleted} deleted, then HEAD ${goneA.status}`);
  const miss = await s3.fetch(objectUrl(`${RUN}/never-was`));
  record('a missing file is a 404', miss.status === 404, `${miss.status} ${code(await miss.text())}`);
});

// Cleanup through the native API: S3 DELETE only hides a file, so remove
// every version (and hide marker) this run wrote, plus unfinished uploads.
async function cleanup() {
  const basic = Buffer.from(`${env.B2_ADMIN_KEY_ID}:${env.B2_ADMIN_APP_KEY}`).toString('base64');
  const a = await (await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', { headers: { authorization: `Basic ${basic}` } })).json();
  const call = async (name, body) => {
    const res = await fetch(`${a.apiInfo.storageApi.apiUrl}/b2api/v3/${name}`, {
      method: 'POST', headers: { authorization: a.authorizationToken, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${name} → ${res.status} ${j.code || ''}`);
    return j;
  };
  const { buckets } = await call('b2_list_buckets', { accountId: a.accountId, bucketName: BUCKET });
  const bucketId = buckets[0].bucketId;
  let n = 0;
  let next = { startFileName: null, startFileId: null };
  do {
    const r = await call('b2_list_file_versions', { bucketId, prefix: `${RUN}/`, maxFileCount: 1000, ...next });
    for (const f of r.files) { await call('b2_delete_file_version', { fileName: f.fileName, fileId: f.fileId }); n++; }
    next = { startFileName: r.nextFileName, startFileId: r.nextFileId };
  } while (next.startFileName);
  const u = await call('b2_list_unfinished_large_files', { bucketId, namePrefix: `${RUN}/` });
  for (const f of u.files) { await call('b2_cancel_large_file', { fileId: f.fileId }); n++; }
  const left = await call('b2_list_file_versions', { bucketId, prefix: `${RUN}/`, maxFileCount: 10 });
  console.log(`cleanup: removed ${n} versions under ${RUN}/, ${left.files.length} left`);
}

try { await cleanup(); } catch (e) { console.log(`✗ cleanup: ${e.message}`); process.exitCode = 1; }
const failed = results.filter((r) => r.pass === false).length;
const passed = results.filter((r) => r.pass === true).length;
console.log(`${passed} passed, ${failed} failed, ${results.length - passed - failed} recorded`);
if (failed) process.exitCode = 1;
