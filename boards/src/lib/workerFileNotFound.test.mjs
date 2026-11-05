// Made-up file addresses answer 404, not the app's HTML; the docs hub's
// Markdown twin is /docs/index.md.
//
//   node --test src/lib/workerFileNotFound.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

const ORIGIN = 'https://clusters.soleilpictures.com';
const SHELL = '<!doctype html><html><head><title>x</title></head><body></body></html>';

// Recording rewriter, as in fileShareWorker.test.mjs.
const calls = [];
globalThis.HTMLRewriter = class {
  on(selector, handler) { calls.push({ selector, handler }); return this; }
  transform(res) { return res; }
};

const html = () => new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
const env = (assetsFetch = async () => html()) => ({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  ASSETS: { fetch: assetsFetch },
});
async function get(path, e = env(), method = 'GET') {
  const { default: worker } = await import('../worker.js');
  return worker.handleFetch(new Request(`${ORIGIN}${path}`, { method }), e, { waitUntil() {} });
}
const mdAlternate = () => calls
  .filter((c) => c.handler.constructor.name === 'AppendHead' && c.handler.h.includes('text/markdown'))
  .map((c) => /href="([^"]+)"/.exec(c.handler.h.split('text/markdown')[1])[1]);

test('the docs hub advertises /docs/index.md, other docs pages <path>.md', async () => {
  calls.length = 0;
  await get('/docs');
  assert.deepEqual(mdAlternate(), ['/docs/index.md']);
  calls.length = 0;
  await get('/docs/canvas');
  assert.deepEqual(mdAlternate(), ['/docs/canvas.md']);
});

test('/docs.md redirects to /docs/index.md, query kept', async () => {
  for (const method of ['GET', 'HEAD']) {
    const res = await get('/docs.md?a=1', env(), method);
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), `${ORIGIN}/docs/index.md?a=1`);
  }
});

test('unknown .md/.xml/.txt addresses are a plain 404', async () => {
  for (const path of ['/explore.md', '/atom.xml', '/sitemap.txt', '/humans.txt', '/ADS.TXT', '/sitemap_index.xml']) {
    const res = await get(path);
    assert.equal(res.status, 404, path);
    assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8', path);
    assert.equal(res.headers.get('cache-control'), 'no-store', path);
    assert.equal(await res.text(), 'Not found', path);
  }
  const head = await get('/atom.xml', env(), 'HEAD');
  assert.equal(head.status, 404);
});

test('a real Markdown file passes through unchanged', async () => {
  const e = env(async () => new Response('# Hi', { status: 200, headers: { 'content-type': 'text/markdown; charset=utf-8' } }));
  const res = await get('/docs/canvas.md', e);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(await res.text(), '# Hi');
});

test('a dotless unknown route still gets the app shell', async () => {
  const res = await get('/some-board-route');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
});
