// /f/<uuid> link previews and /api/file-thumb/<uuid> in the main Worker.
//
//   node --test src/lib/fileShareWorker.test.mjs

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const UUID = '3b2d89f2-9c1d-48af-8b89-2517b1b49712';
const ORIGIN = 'https://clusters.soleilpictures.com';
const SHELL = '<!doctype html><html><head><title>x</title></head><body></body></html>';

// Recording rewriter: remembers every handler registered, so the test can see
// what the Worker would inject without a real HTMLRewriter.
const calls = [];
globalThis.HTMLRewriter = class {
  on(selector, handler) { calls.push({ selector, handler }); return this; }
  transform(res) { return res; }
};

const realFetch = globalThis.fetch;
let fixture = null;
let rpcCalls = 0;
function stubRpc(value) {
  fixture = value; rpcCalls = 0;
  globalThis.fetch = async (input, init) => {
    const u = String(input?.url || input);
    if (u.includes('/rest/v1/rpc/get_file_share')) {
      rpcCalls++;
      assert.deepEqual(JSON.parse(init.body), { p_token: UUID });
      return new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
}
afterEach(() => { globalThis.fetch = realFetch; calls.length = 0; });

function makeEnv(extra = {}) {
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    ASSETS: { fetch: async () => new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }) },
    ...extra,
  };
}
async function get(path, env, init) {
  const { default: worker } = await import('../worker.js');
  return worker.handleFetch(new Request(`${ORIGIN}${path}`, init), env, { waitUntil() {} });
}
const val = (selector) => calls.find((c) => c.selector === selector)?.handler;

test('/f/<uuid> is noindex and revalidated, with an ok file', async () => {
  stubRpc({ status: 'ok', file: { name: 'cut <v2>.mov' }, shared_by: { name: 'Sam' }, keys: { poster: 'r2:a/p.webp' } });
  const res = await get(`/f/${UUID}`, makeEnv());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  assert.equal(rpcCalls, 1);
  assert.equal(val('title').t, 'cut <v2>.mov · Clusters');
  assert.equal(val('meta[name="description"]').v, 'Shared on Clusters by Sam');
  assert.equal(val('meta[property="og:url"]').v, `${ORIGIN}/f/${UUID}`);
  assert.equal(val('meta[property="og:image"]').v, `${ORIGIN}/api/file-thumb/${UUID}`);
  assert.equal(val('meta[name="twitter:card"]').v, 'summary_large_image');
  // The only AppendHead is the static robots tag: nothing dynamic is unescaped.
  const appended = calls.filter((c) => c.handler.constructor.name === 'AppendHead');
  assert.equal(appended.length, 1);
  assert.equal(appended[0].handler.h, '<meta name="robots" content="noindex">');
});

test('/f/<uuid> with no usable file gets generic meta and no image', async () => {
  stubRpc({ status: 'sign_in' });
  const res = await get(`/f/${UUID}`, makeEnv());
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.equal(val('title').t, 'A file shared on Clusters');
  assert.equal(val('meta[name="description"]').v, 'Open it on Clusters.');
  assert.equal(val('meta[property="og:image"]'), undefined);
});

test('/f/<uuid> with a non-webp poster sets no og:image', async () => {
  stubRpc({ status: 'ok', file: { name: 'a.mov' }, shared_by: { name: 'Sam' }, keys: { poster: 'r2:a/p.png' } });
  await get(`/f/${UUID}`, makeEnv());
  assert.equal(val('meta[property="og:image"]'), undefined);
  assert.equal(val('meta[name="twitter:image"]'), undefined);
  assert.equal(val('meta[name="twitter:card"]'), undefined);
});

function fakeImages(store) {
  return { get: async (k) => (k in store ? { body: store[k], httpEtag: '"e1"' } : null) };
}

test('/api/file-thumb serves a webp poster', async () => {
  stubRpc({ status: 'ok', keys: { poster: 'r2:a/p.webp' } });
  const res = await get(`/api/file-thumb/${UUID}`, makeEnv({ IMAGES: fakeImages({ 'a/p.webp': 'bytes' }) }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/webp');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-robots-tag'), 'noindex');
  assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
  const again = await get(`/api/file-thumb/${UUID}`, makeEnv({ IMAGES: fakeImages({ 'a/p.webp': 'bytes' }) }),
    { headers: { 'if-none-match': '"e1"' } });
  assert.equal(again.status, 304);
});

test('/api/file-thumb falls back unless ok with a webp poster that exists', async () => {
  const env = makeEnv({ IMAGES: fakeImages({ 'a/p.webp': 'b', 'x.png': 'b' }) });
  for (const meta of [
    { status: 'sign_in', keys: { poster: 'r2:a/p.webp' } },
    { status: 'ok', keys: { poster: 'r2:x.png' } },
    { status: 'ok', keys: { poster: 'r2:missing.webp' } },
    { status: 'ok', keys: {} },
  ]) {
    stubRpc(meta);
    const res = await get(`/api/file-thumb/${UUID}`, env);
    assert.equal(res.status, 302, JSON.stringify(meta));
    assert.equal(res.headers.get('location'), `${ORIGIN}/clusters-logo-dark.png`);
  }
});
