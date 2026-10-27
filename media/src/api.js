// The Worker client: the box's only way to learn of work, read an original
// and hand back an output. The one secret (MEDIA_BOX_SECRET) goes in the
// Authorization header of calls to OUR Worker and nowhere else: not to ffmpeg,
// not into a URL, not into a log.

import { openOwn } from './ffmpeg.js';

const BASE = String(process.env.MEDIA_API_BASE || '').replace(/\/+$/, '');
const SECRET = process.env.MEDIA_BOX_SECRET || '';
const PREFIX = `${BASE}/api/media/copy`;

export const PART_BYTES = 64 * 1024 * 1024;
// Files up to this go up in one request; over it, multipart.
export const PUT_MAX_BYTES = 95 * 1024 * 1024;

const auth = () => ({ authorization: `Bearer ${SECRET}` });

async function call(path, { body, json, headers = {}, timeoutMs = 30_000 } = {}) {
  const res = await fetch(`${PREFIX}/${path}`, {
    method: 'POST',
    headers: { ...auth(), ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res;
}

async function okJson(res, what) {
  if (!res.ok) throw new Error(`${what} failed (${res.status})`);
  return res.json();
}

// null when there is no work; throws with .status on any non-2xx.
export async function claim() {
  const res = await call('claim');
  if (res.status === 204) return null;
  if (!res.ok) {
    const e = new Error(`claim ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return res.json();
}

// The relative `source` the Worker gave us, made absolute. It already carries
// a per-job token in its query: that is the only credential ffmpeg gets.
export function sourceUrl(job) {
  return `${BASE}${job.source}`;
}

export async function heartbeat(key) {
  await okJson(await call('heartbeat', { json: { key } }), 'heartbeat');
}

export async function finish(key, state, result) {
  await okJson(await call('finish', { json: { key, state, result }, timeoutMs: 60_000 }), 'finish');
}

const q = (o) => new URLSearchParams(o).toString();

async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw last;
}

async function readRange(fh, start, len) {
  const buf = Buffer.allocUnsafe(len);
  let got = 0;
  while (got < len) {
    const { bytesRead } = await fh.read(buf, got, len - got, start + got);
    if (!bytesRead) break;
    got += bytesRead;
  }
  return buf.subarray(0, got);
}

// Uploads a file as `out` ('copy' | 'poster' | 'view' | 'view_sm' | 'pdf').
// Small files in one request, big ones in 64 MiB parts so one dropped
// connection costs a part, not an hour. The file is opened as the file it is
// (openOwn: never through a link a decoder left in its place). Resolves with
// the number of bytes sent.
export async function uploadFile(key, out, path, contentType) {
  const { fh, size } = await openOwn(path);
  try {
    if (size <= PUT_MAX_BYTES) {
      const body = await readRange(fh, 0, size);
      await withRetry(async () => okJson(await call(`upload?${q({ key, out, step: 'put' })}`, {
        body, headers: { 'content-type': contentType }, timeoutMs: 10 * 60_000,
      }), 'upload'));
      return size;
    }
    const { uploadId } = await okJson(await call(`upload?${q({ key, out, step: 'create' })}`), 'upload create');
    const parts = [];
    for (let n = 1, off = 0; off < size; n += 1, off += PART_BYTES) {
      const body = await readRange(fh, off, Math.min(PART_BYTES, size - off));
      const part = await withRetry(async () => okJson(await call(`upload?${q({ key, out, step: 'part', uploadId, n })}`, {
        body, headers: { 'content-type': 'application/octet-stream' }, timeoutMs: 10 * 60_000,
      }), 'upload part'));
      parts.push({ partNumber: part.partNumber, etag: part.etag });
    }
    await okJson(await call(`upload?${q({ key, out, step: 'complete', uploadId })}`, {
      json: { parts }, timeoutMs: 120_000,
    }), 'upload complete');
    return size;
  } finally {
    await fh.close();
  }
}
