#!/usr/bin/env node
// Live check of src/lib/storage.js s3Bucket against the Backblaze bucket, with
// the Worker's key. Works under _probe/smoke-<timestamp>/ and deletes what it
// wrote. Prints pass/fail lines only, never a value from the env file.
//
//   [ENV_FILE=…] node scripts/storageSmoke.mjs

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { s3Bucket } from '../src/lib/storage.js';

const ENV_FILE = process.env.ENV_FILE || '/Users/andrewconklin/soleilpictures-1/boards/scripts/.env';
const env = Object.fromEntries(readFileSync(ENV_FILE, 'utf8').split('\n')
  .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
for (const k of ['B2_S3_ENDPOINT', 'B2_REGION', 'B2_BUCKET', 'B2_WORKER_KEY_ID', 'B2_WORKER_APP_KEY']) {
  if (!env[k]) { console.error(`FAIL ${k} missing from the env file`); process.exit(1); }
}

const bucket = s3Bucket({
  endpoint: env.B2_S3_ENDPOINT, region: env.B2_REGION, bucket: env.B2_BUCKET,
  accessKeyId: env.B2_WORKER_KEY_ID, secretAccessKey: env.B2_WORKER_APP_KEY,
  md5: (bytes) => createHash('md5').update(bytes).digest('base64'),
});
const RUN = `_probe/smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const written = [];
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; };
async function step(name, fn) {
  try { check(name, Boolean(await fn())); } catch (e) { check(`${name} (threw ${String(e.message).slice(0, 80)})`, false); }
}
const key = (n) => { const k = `${RUN}/${n}`; written.push(k); return k; };

const k1 = key('small.txt');
const META = { 'board-id': 'abc', 'op-count': '2' };
let etag;
await step('put bytes with metadata', async () => {
  const o = await bucket.put(k1, '0123456789', { httpMetadata: { contentType: 'text/plain', cacheControl: 'no-store' }, customMetadata: META });
  etag = o.etag;
  return o.size === 10 && Boolean(o.etag);
});
await step('head: size, type, etag, date, metadata', async () => {
  const o = await bucket.head(k1);
  return o.size === 10 && o.httpMetadata.contentType === 'text/plain' && o.etag === etag && o.httpEtag === `"${etag}"`
    && o.uploaded instanceof Date && !Number.isNaN(o.uploaded.getTime())
    && o.customMetadata['board-id'] === 'abc' && o.customMetadata['op-count'] === '2';
});
await step('get full', async () => {
  const o = await bucket.get(k1);
  return o.size === 10 && (await o.text()) === '0123456789' && o.httpMetadata.cacheControl === 'no-store';
});
await step('get range offset+length', async () => {
  const o = await bucket.get(k1, { range: { offset: 2, length: 3 } });
  return (await o.text()) === '234' && o.size === 10 && o.range.offset === 2 && o.range.length === 3;
});
await step('get range suffix', async () => {
  const o = await bucket.get(k1, { range: { suffix: 4 } });
  return (await o.text()) === '6789' && o.size === 10;
});
await step('get range from a Headers', async () => {
  const o = await bucket.get(k1, { range: new Headers({ range: 'bytes=0-1' }) });
  return (await o.text()) === '01';
});
await step('If-None-Match with the current etag: no body', async () => {
  const o = await bucket.get(k1, { onlyIf: new Headers({ 'if-none-match': `"${etag}"` }) });
  return o && !o.body && o.etag === etag;
});
await step('wrong If-Match: no body', async () => {
  const o = await bucket.get(k1, { onlyIf: { etagMatches: '0000' } });
  return o && !o.body;
});
await step('missing key: null', async () => (await bucket.get(`${RUN}/nothing-here`)) === null && (await bucket.head(`${RUN}/nothing-here`)) === null);
await step('range past the end throws', async () => {
  try { await bucket.get(k1, { range: { offset: 999 } }); return false; } catch (_) { return true; }
});

const k2 = key('multi.bin');
const PART = 5 * 1024 * 1024;
await step('multipart 2 x 5 MB, resume by id, complete: 10 MB', async () => {
  const up = await bucket.createMultipartUpload(k2, { httpMetadata: { contentType: 'video/mp4' } });
  const p1 = await up.uploadPart(1, new Uint8Array(PART).fill(1));
  const again = bucket.resumeMultipartUpload(k2, up.uploadId);
  const p2 = await again.uploadPart(2, new Uint8Array(PART).fill(2));
  const done = await again.complete([p2, p1]);
  return done.size === 2 * PART && done.httpMetadata.contentType === 'video/mp4';
});
await step('multipart abort', async () => {
  const k = key('aborted.bin');
  const up = await bucket.createMultipartUpload(k);
  await bucket.resumeMultipartUpload(k, up.uploadId).abort();
  return (await bucket.head(k)) === null;
});

await step('delete one', async () => {
  const k = key('one.txt');
  await bucket.put(k, 'x');
  await bucket.delete(k);
  await bucket.delete(k);
  return (await bucket.head(k)) === null;
});
await step('delete many', async () => {
  const keys = [key('a&b.txt'), key('c.txt')];
  for (const k of keys) await bucket.put(k, 'y');
  await bucket.delete(keys);
  return (await bucket.head(keys[0])) === null && (await bucket.head(keys[1])) === null;
});

// Cleanup: an S3 delete only hides a file in a versioned bucket, so remove
// every version through the native API with the admin key.
async function cleanup() {
  await bucket.delete(written).catch(() => null);
  if (!env.B2_ADMIN_KEY_ID || !env.B2_ADMIN_APP_KEY) return 'hidden only (no admin key)';
  const basic = Buffer.from(`${env.B2_ADMIN_KEY_ID}:${env.B2_ADMIN_APP_KEY}`).toString('base64');
  const a = await (await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', { headers: { authorization: `Basic ${basic}` } })).json();
  const call = async (name, body) => {
    const res = await fetch(`${a.apiInfo.storageApi.apiUrl}/b2api/v3/${name}`, {
      method: 'POST', headers: { authorization: a.authorizationToken, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${name} ${res.status}`);
    return j;
  };
  const { buckets } = await call('b2_list_buckets', { accountId: a.accountId, bucketName: env.B2_BUCKET });
  const bucketId = buckets[0].bucketId;
  let next = { startFileName: null, startFileId: null };
  do {
    const r = await call('b2_list_file_versions', { bucketId, prefix: `${RUN}/`, maxFileCount: 1000, ...next });
    for (const f of r.files) await call('b2_delete_file_version', { fileName: f.fileName, fileId: f.fileId });
    next = { startFileName: r.nextFileName, startFileId: r.nextFileId };
  } while (next.startFileName);
  const u = await call('b2_list_unfinished_large_files', { bucketId, namePrefix: `${RUN}/` });
  for (const f of u.files) await call('b2_cancel_large_file', { fileId: f.fileId });
  const left = await call('b2_list_file_versions', { bucketId, prefix: `${RUN}/`, maxFileCount: 10 });
  return left.files.length === 0 ? 'clean' : `${left.files.length} left`;
}
try { check(`cleanup (${await cleanup()})`, true); } catch (e) { check(`cleanup (${String(e.message).slice(0, 60)})`, false); }
console.log(failed ? `${failed} failed` : 'all passed');
if (failed) process.exitCode = 1;
