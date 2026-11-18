// The upload party's stores (party/upload.ts): which store a key lives in,
// the signing client and URL for each, and where an upload in flight began.
// Plain ESM so it unit-tests in Node and bundles into the party (workerd).
//
// The party never moves bytes itself: it signs URLs the browser uses and does
// the few S3 POST/HEAD/DELETE/copy calls CORS forbids. Each needs a target:
//   { kind: 'r2'|'b2', aws: AwsClient, bucket, url(key) }
// R2's is built exactly as the party always built it (region "auto", the
// account host, the key as it is). B2's uses the real region and a path-style
// URL. The 'storage' switch in app_config (lib/storage.js) picks per key.

import { AwsClient } from 'aws4fetch';
import { B2, B2_UPLOAD_TAG, backendForKey, makeConfigReader, readsFallBack } from './storage.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const encodeKey = (key) => String(key).split('/').map(encodeURIComponent).join('/');

// Keys the client asks to have looked for again (POST /sign-reads `recheck`).
export const RECHECK_MAX = 50;

// R2, from r2Env()'s values: today's client and URL, unchanged.
export function r2Target({ accountId, bucket, accessKeyId, secretAccessKey }) {
  return {
    kind: 'r2',
    bucket,
    aws: new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' }),
    url: (key) => `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`,
  };
}

// B2, from the party's own env. Null unless both B2_KEY_ID and B2_APP_KEY are
// set (trimmed, as r2Env() trims: a trailing newline would be signed in).
export function b2Target(env) {
  const accessKeyId = text(env?.B2_KEY_ID);
  const secretAccessKey = text(env?.B2_APP_KEY);
  if (!accessKeyId || !secretAccessKey) return null;
  const endpoint = (text(env?.B2_S3_ENDPOINT) || B2.endpoint).replace(/\/+$/, '');
  const region = text(env?.B2_REGION) || B2.region;
  const bucket = text(env?.B2_BUCKET) || B2.bucket;
  return {
    kind: 'b2',
    bucket,
    aws: new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region }),
    url: (key) => `${endpoint}/${bucket}/${encodeKey(key)}`,
  };
}

// The store a key lives in under `cfg`. The switch asking for B2 while the
// party has no B2 target answers R2 and calls `onB2Missing`.
export function targetFor(targets, cfg, key, onB2Missing) {
  if (backendForKey(key, cfg) !== 'b2') return targets.r2;
  if (targets.b2) return targets.b2;
  if (typeof onB2Missing === 'function') onB2Missing();
  return targets.r2;
}

// The id the client carries for an upload opened in `target`: B2's carry the
// tag, so every later call finds the store the upload began in whatever the
// switch says by then. R2's are exactly what R2 returned.
export function clientUploadId(target, rawUploadId) {
  return target.kind === 'b2' ? B2_UPLOAD_TAG + rawUploadId : rawUploadId;
}

// Where an upload the client names lives: { target, raw } with the id the
// store knows, or null for a tagged id the party has no B2 target for.
export function uploadTarget(targets, uploadId) {
  const id = String(uploadId || '');
  if (id.startsWith(B2_UPLOAD_TAG)) {
    return targets.b2 ? { target: targets.b2, raw: id.slice(B2_UPLOAD_TAG.length) } : null;
  }
  return { target: targets.r2, raw: id };
}

// The keys of a /sign-reads `recheck` list worth looking for: strings also in
// `requested`, once each, at most RECHECK_MAX.
export function recheckKeys(recheck, requested) {
  if (!Array.isArray(recheck)) return new Set();
  const asked = new Set(requested);
  const out = new Set();
  for (const k of recheck) {
    if (out.size >= RECHECK_MAX) break;
    if (typeof k === 'string' && asked.has(k)) out.add(k);
  }
  return out;
}

async function headIn(target, key) {
  try {
    const res = await target.aws.fetch(target.url(key), { method: 'HEAD' });
    return res;
  } catch (_) {
    return null;
  }
}

// Find an object: HEAD it in its store and, when the switch lets reads fall
// back and that store answers 404, in the other. { target, head } where head
// is the OK HEAD response, or null when it was not found (target is then the
// key's own store). With reads not falling back this is one HEAD in R2, as
// before the switch existed.
export async function findObject(targets, cfg, key, onB2Missing) {
  const first = targetFor(targets, cfg, key, onB2Missing);
  const res = await headIn(first, key);
  if (res && res.ok) return { target: first, head: res };
  if (!res || res.status !== 404 || !readsFallBack(cfg)) return { target: first, head: null };
  const second = first.kind === 'b2' ? targets.r2 : targets.b2;
  if (!second || second === first) return { target: first, head: null };
  const alt = await headIn(second, key);
  if (alt && alt.ok) return { target: second, head: alt };
  return { target: first, head: null };
}

// The env override (never set in production), as the Worker reads it.
export function storageOverride(env) {
  const mode = text(env?.STORAGE_MODE);
  if (!mode) return undefined;
  const workspaces = text(env?.STORAGE_WORKSPACES).split(',').map((s) => s.trim()).filter(Boolean);
  return { mode, workspaces };
}

// The switch, read as the service role (party serviceRpc's headers), at most
// 1.5 s. A non-OK answer throws so the reader keeps its last good value.
export function partyConfigReader(env, { supabaseUrl, fetch: fetchFn = (...a) => globalThis.fetch(...a), ...opts } = {}) {
  const load = async () => {
    const key = text(env?.SUPABASE_SERVICE_ROLE_KEY);
    if (!key) return null;
    const res = await fetchFn(`${supabaseUrl}/rest/v1/app_config?key=eq.storage&select=value`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) throw new Error(`storage config ${res.status}`);
    const rows = await res.json();
    return Array.isArray(rows) ? (rows[0]?.value ?? null) : null;
  };
  return makeConfigReader({ load, override: storageOverride(env), ...opts });
}
