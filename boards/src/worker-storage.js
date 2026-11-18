// The Worker's storage binding. withStorage(env, ctx) hands back an env whose
// IMAGES follows the 'storage' switch in app_config (see lib/storage.js) and
// keeps the raw R2 binding as IMAGES_R2. Without B2 secrets it returns `env`
// itself, so nothing changes until they exist.

import { B2, makeConfigReader, routedBucket, s3Bucket } from './lib/storage.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');

let reader = null;
let readerKey = '';
let bucket = null;
let bucketKey = '';

// For tests: forget the per-isolate caches.
export function resetWorkerStorage() {
  reader = null; readerKey = ''; bucket = null; bucketKey = '';
}

function overrideFor(env) {
  const mode = text(env.STORAGE_MODE);
  if (!mode) return undefined;
  const workspaces = text(env.STORAGE_WORKSPACES).split(',').map((s) => s.trim()).filter(Boolean);
  return { mode, workspaces };
}

// Same URL and header pattern as emailThumbSecret in worker.js.
async function loadRow(env, fetchFn) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const res = await fetchFn(
    `${env.SUPABASE_URL}/rest/v1/app_config?key=eq.storage&select=value`,
    {
      headers: {
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'accept': 'application/json',
      },
      signal: AbortSignal.timeout(1500),
    },
  );
  if (!res.ok) throw new Error(`storage config fetch ${res.status}`);
  const rows = await res.json();
  return rows?.[0]?.value ?? null;
}

const report = (event, detail) => console.warn(JSON.stringify({ storage: event, ...detail }));

export function withStorage(env, ctx, deps = {}) {
  // Already wrapped (IMAGES_R2 set) or nothing to route: hand the same env back.
  if (!env || !env.IMAGES || env.IMAGES_R2) return env;
  const keyId = text(env.B2_KEY_ID);
  const appKey = text(env.B2_APP_KEY);
  if (!keyId || !appKey) return env;
  const fetchFn = deps.fetch || ((...a) => globalThis.fetch(...a));

  const override = overrideFor(env);
  const rKey = `${env.SUPABASE_URL || ''}|${override ? JSON.stringify(override) : ''}`;
  if (!reader || readerKey !== rKey) {
    reader = makeConfigReader({ load: () => loadRow(env, fetchFn), override });
    readerKey = rKey;
  }
  const waitUntil = ctx && typeof ctx.waitUntil === 'function' ? ctx.waitUntil.bind(ctx) : undefined;
  const cfgReader = reader;

  const settings = {
    endpoint: text(env.B2_S3_ENDPOINT) || B2.endpoint,
    region: text(env.B2_REGION) || B2.region,
    bucket: text(env.B2_BUCKET) || B2.bucket,
  };
  const bKey = `${keyId}|${settings.endpoint}|${settings.region}|${settings.bucket}`;
  if (!bucket || bucketKey !== bKey) {
    bucket = s3Bucket({
      ...settings, accessKeyId: keyId, secretAccessKey: appKey,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    });
    bucketKey = bKey;
  }

  return {
    ...env,
    IMAGES: routedBucket({ r2: env.IMAGES, b2: bucket, getConfig: () => cfgReader.get(waitUntil), report }),
    IMAGES_R2: env.IMAGES,
  };
}
