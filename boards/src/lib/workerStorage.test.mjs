// workerStorage.test.mjs — the Worker's storage binding (worker-storage.js):
// same env without B2 secrets, routed with them, and the worker.js wiring.
//
//   node --test src/lib/workerStorage.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { withStorage, resetWorkerStorage } from '../worker-storage.js';

const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

const fakeR2 = () => {
  const calls = [];
  const r = {
    calls,
    get: async (k) => { calls.push(['get', k]); return { key: k, from: 'r2' }; },
    head: async (k) => { calls.push(['head', k]); return { key: k, from: 'r2' }; },
    put: async (k) => { calls.push(['put', k]); return { key: k, from: 'r2' }; },
    delete: async (k) => { calls.push(['delete', k]); },
    createMultipartUpload: async () => ({}),
    resumeMultipartUpload: () => ({}),
    list: async () => ({}),
  };
  return r;
};

const SECRETS = { B2_KEY_ID: 'kid', B2_APP_KEY: 'akey' };
const baseEnv = (extra = {}) => ({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'svc', ...extra });

beforeEach(() => resetWorkerStorage());

test('without B2 secrets the very same env comes back', () => {
  const env = baseEnv({ IMAGES: fakeR2() });
  assert.equal(withStorage(env, null), env);
  const blank = baseEnv({ IMAGES: fakeR2(), B2_KEY_ID: '  ', B2_APP_KEY: 'x' });
  assert.equal(withStorage(blank, null), blank);
  const noBucket = baseEnv(SECRETS);
  assert.equal(withStorage(noBucket, null), noBucket);
});

test('with secrets IMAGES is routed and the raw binding is kept as IMAGES_R2', async () => {
  const r2 = fakeR2();
  const fetchCalls = [];
  const fetch = async (url, init) => {
    fetchCalls.push({ url: String(url), init });
    return new Response(JSON.stringify([{ value: { mode: 'r2' } }]), { status: 200 });
  };
  const env = baseEnv({ IMAGES: r2, ...SECRETS });
  const out = withStorage(env, { waitUntil() {} }, { fetch });
  assert.notEqual(out, env);
  assert.equal(out.IMAGES_R2, r2);
  assert.notEqual(out.IMAGES, r2);
  assert.equal(out.SUPABASE_URL, env.SUPABASE_URL);
  // mode 'r2' is a pure pass-through
  const got = await out.IMAGES.get('ws/a.jpg');
  assert.deepEqual(got, { key: 'ws/a.jpg', from: 'r2' });
  assert.deepEqual(r2.calls, [['get', 'ws/a.jpg']]);
  // the switch row was read once, with the service role and the emailThumbSecret headers
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, 'https://db.example/rest/v1/app_config?key=eq.storage&select=value');
  assert.equal(fetchCalls[0].init.headers.apikey, 'svc');
  assert.equal(fetchCalls[0].init.headers.authorization, 'Bearer svc');
  // wrapping twice does not wrap again
  assert.equal(withStorage(out, null), out);
});

test('an unreadable switch row means R2', async () => {
  const r2 = fakeR2();
  const fetch = async () => { throw new Error('offline'); };
  const out = withStorage(baseEnv({ IMAGES: r2, ...SECRETS }), null, { fetch });
  await out.IMAGES.put('ws/a.jpg', 'x');
  await out.IMAGES.delete('ws/a.jpg');
  assert.deepEqual(r2.calls, [['put', 'ws/a.jpg'], ['delete', 'ws/a.jpg']]);
});

test('STORAGE_MODE overrides the row and routes to B2, with R2 as the read fallback', async () => {
  const r2 = fakeR2();
  const seen = [];
  const fetch = async (req) => {
    seen.push(req.url);
    return new Response('', { status: 404 });
  };
  const out = withStorage(baseEnv({ IMAGES: r2, ...SECRETS, STORAGE_MODE: 'b2' }), null, { fetch });
  const got = await out.IMAGES.get('ws/a.jpg');
  assert.deepEqual(got, { key: 'ws/a.jpg', from: 'r2' });
  assert.equal(seen.length, 1);
  assert.match(seen[0], /^https:\/\/s3\.us-east-005\.backblazeb2\.com\/soleil-boards-images\/ws\/a\.jpg/);
});

test('worker.js wires it: entry points, mirror on the raw bucket, CSP host', () => {
  // After the nonce, because securityHeaders.test.mjs pins the nonce as fetch's first statement.
  assert.match(worker, /async fetch\(request, env, ctx\) \{\n    const nonce = makeNonce\(\);\n    env = withStorage\(env, ctx\);/);
  assert.match(worker, /async scheduled\(event, env, ctx\) \{\n    env = withStorage\(env, ctx\);/);
  const i = worker.indexOf('async function runR2Mirror(env)');
  const mirror = worker.slice(i, worker.indexOf('\n}\n', i));
  assert.match(mirror, /env\?\.IMAGES_R2 \|\| env\?\.IMAGES/);
  assert.doesNotMatch(mirror, /env\.IMAGES\./);
  assert.match(worker, /https:\/\/\*\.r2\.cloudflarestorage\.com https:\/\/s3\.us-east-005\.backblazeb2\.com/);
});
