// Direct R2 object PUT via the S3 API — the same signing party/upload.ts uses,
// but from Node so the seed script never needs a user JWT or the PartyKit
// presign round-trip. Requires the R2 S3 credentials (account id, bucket,
// access key id/secret) — the exact values the Worker/party already hold.

import { AwsClient } from 'aws4fetch';

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
