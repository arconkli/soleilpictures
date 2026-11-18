// Direct object PUT/GET/DELETE via the S3 API — the same signing party/upload.ts
// uses, but from Node so the seed script never needs a user JWT or the PartyKit
// presign round-trip. `makeStorage` picks the store (Cloudflare R2 or Backblaze
// B2) from STORAGE_BACKEND; `makeR2` is the R2-only form it wraps.

import { createHash } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { B2, s3Bucket } from '../../src/lib/storage.js';

export function makeR2({ accountId, bucket, accessKeyId, secretAccessKey }) {
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('makeR2: missing R2 credentials (accountId/bucket/accessKeyId/secretAccessKey)');
  }
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  const base = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;

  return {
    // PUT bytes at `key`. Returns the key on success, throws on non-2xx.
    async put(key, bytes, contentType = 'application/octet-stream') {
      const res = await client.fetch(`${base}/${encodeURI(key)}`, {
        method: 'PUT',
        body: bytes,
        headers: { 'content-type': contentType },
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`R2 PUT ${key} → ${res.status} ${detail.slice(0, 200)}`);
      }
      return key;
    },

    // GET an object's bytes, or null if it isn't there. Used to build the
    // contact sheets Scout texts back — reading the 640px preview tier rather
    // than the original keeps a 20-photo sheet around a megabyte, and egress is
    // free up to a share of what is stored on B2 and charged by the byte past it.
    async get(key) {
      const res = await client.fetch(`${base}/${encodeURI(key)}`);
      if (res.status === 404) return null;
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`R2 GET ${key} → ${res.status} ${detail.slice(0, 200)}`);
      }
      return Buffer.from(await res.arrayBuffer());
    },

    // DELETE an object. 404 is treated as success (already gone).
    async del(key) {
      const res = await client.fetch(`${base}/${encodeURI(key)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) {
        const detail = await res.text().catch(() => '');
        throw new Error(`R2 DELETE ${key} → ${res.status} ${detail.slice(0, 200)}`);
      }
      return key;
    },
  };
}

// The store the scripts and Scout write to: {put, get, del}, the same three
// calls whichever backend answers.
//   STORAGE_BACKEND  'r2' (default) | 'b2'
//   r2: R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
//   b2: B2_WORKER_KEY_ID, B2_WORKER_APP_KEY; B2_S3_ENDPOINT, B2_REGION and
//       B2_BUCKET default to the production values in src/lib/storage.js
export function makeStorage(env = process.env) {
  const backend = String(env.STORAGE_BACKEND || 'r2').trim().toLowerCase();
  if (backend === 'r2') {
    return makeR2({
      accountId: env.R2_ACCOUNT_ID,
      bucket: env.R2_BUCKET,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    });
  }
  if (backend !== 'b2') throw new Error(`makeStorage: STORAGE_BACKEND must be 'r2' or 'b2', got '${backend}'`);
  const accessKeyId = env.B2_WORKER_KEY_ID;
  const secretAccessKey = env.B2_WORKER_APP_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('makeStorage: missing B2 credentials (B2_WORKER_KEY_ID/B2_WORKER_APP_KEY)');
  }
  const bucket = s3Bucket({
    endpoint: env.B2_S3_ENDPOINT || B2.endpoint,
    region: env.B2_REGION || B2.region,
    bucket: env.B2_BUCKET || B2.bucket,
    accessKeyId,
    secretAccessKey,
    md5: (bytes) => createHash('md5').update(bytes).digest('base64'),
  });
  return {
    async put(key, bytes, contentType = 'application/octet-stream') {
      await bucket.put(key, bytes, { httpMetadata: { contentType } });
      return key;
    },
    async get(key) {
      const obj = await bucket.get(key);
      return obj ? Buffer.from(await obj.arrayBuffer()) : null;
    },
    async del(key) {
      await bucket.delete(key);
      return key;
    },
  };
}
