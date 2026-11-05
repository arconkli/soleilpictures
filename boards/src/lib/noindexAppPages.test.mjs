// Pins the noindex branch in worker.js: /resume and /admin (exact path, any
// case, trailing slash, any query) are served the SPA shell with
// x-robots-tag: noindex and cache-control: no-store, on GET and HEAD. Public
// pages and look-alike paths (/administrator, /admin-tips) are untouched.
import test from 'node:test';
import assert from 'node:assert/strict';

const SHELL = '<!doctype html><html><head><title>Soleil Clusters</title></head><body><main id="seo-fallback"></main></body></html>';
const env = {
  ASSETS: { fetch: async () => new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }) },
};
const ORIGIN = 'https://clusters.soleilpictures.com';
async function call(path, method = 'GET') {
  globalThis.HTMLRewriter ??= class { on() { return this; } transform(res) { return res; } };
  const { default: worker } = await import('../worker.js');
  return worker.handleFetch(new Request(ORIGIN + path, { method }), env, { waitUntil() {} });
}
const noindexed = (res) => /noindex/i.test(res.headers.get('x-robots-tag') || '');

test('/admin is noindex + no-store on GET and HEAD, however it is spelled', async () => {
  for (const p of ['/admin', '/admin/', '/ADMIN', '/admin?tab=users']) {
    for (const method of ['GET', 'HEAD']) {
      const res = await call(p, method);
      // A spelling the Worker canonicalizes (the trailing slash) redirects to
      // /admin itself, which is the page that must carry the header.
      if (res.status === 301 || res.status === 308) {
        assert.equal(new URL(res.headers.get('location'), ORIGIN).pathname, '/admin', `${method} ${p} redirects to /admin`);
        continue;
      }
      assert.equal(res.status, 200, `${method} ${p}`);
      assert.ok(noindexed(res), `${method} ${p} must carry x-robots-tag noindex`);
      assert.match(res.headers.get('cache-control') || '', /no-store/, `${method} ${p}`);
    }
  }
});

test('/resume stays noindex on GET and HEAD', async () => {
  for (const method of ['GET', 'HEAD']) {
    const res = await call('/resume', method);
    assert.ok(noindexed(res), `${method} /resume`);
  }
});

test('public pages are not noindexed', async () => {
  for (const p of ['/', '/pricing', '/tools/mood-board-maker']) {
    const res = await call(p);
    assert.ok(!noindexed(res), `${p} must stay indexable`);
  }
});

test('only the exact /admin path is matched', async () => {
  for (const p of ['/administrator', '/admin-tips']) {
    const res = await call(p);
    assert.ok(!noindexed(res), `${p} must not be caught by the /admin rule`);
  }
});
