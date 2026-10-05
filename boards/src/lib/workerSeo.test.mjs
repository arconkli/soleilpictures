// workerSeo.test.mjs — the pure parts of the admin SEO worker routes.
//
//   node --test src/lib/workerSeo.test.mjs
//
// IndexNow: the ping had never once reached its handler. handleSeoRoute gated
// every /api/seo/* body on a UUID board_id (the draft/alt contract) before
// dispatching, and the client posted { slug } — a 400 on every publish since
// the route shipped, swallowed by the best-effort caller. Bing's index feeds
// ChatGPT search, so the marketing pages now go through the same door, and the
// URL resolution is a pure function so this file can prove what it accepts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIndexNowUrls } from '../worker-seo.js';
import { SEO_LANDING_LISTED } from './seoLanding.js';

const ORIGIN = 'https://clusters.soleilpictures.com';
// /templates is a landing spec only on trees that carry the template store, and
// a LISTED one only once the store is no longer held (lib/templatePaths.js) —
// production 404s it until then, so IndexNow must not be told about it. Demand
// it where the registry lists it, never literally.
const TEMPLATES = SEO_LANDING_LISTED.some((p) => p.path === '/templates') ? ['/templates'] : [];

test('a published board slug resolves to its /c/ URL', () => {
  assert.deepEqual(resolveIndexNowUrls({ slug: 'film-noir-look-book' }), [`${ORIGIN}/c/film-noir-look-book`]);
});

test('a malformed slug resolves to nothing', () => {
  assert.deepEqual(resolveIndexNowUrls({ slug: '../etc' }), []);
  assert.deepEqual(resolveIndexNowUrls({ slug: '' }), []);
  assert.deepEqual(resolveIndexNowUrls({}), []);
});

test('marketing paths resolve only when the registries know them', () => {
  const urls = resolveIndexNowUrls({ paths: ['/vs/pureref', '/best/pureref-alternatives', '/docs/api', '/changelog', ...TEMPLATES, '/explore', '/pricing'] });
  assert.deepEqual(urls, [
    `${ORIGIN}/vs/pureref`, `${ORIGIN}/best/pureref-alternatives`, `${ORIGIN}/docs/api`,
    `${ORIGIN}/changelog`, ...TEMPLATES.map((p) => `${ORIGIN}${p}`), `${ORIGIN}/explore`, `${ORIGIN}/pricing`,
  ]);
});

test('a page held off production is never submitted', () => {
  // The template store is a 404 on production while it is held. Telling a
  // search engine to index it would hand Bing a dead URL with our name on it.
  if (TEMPLATES.length) return;
  assert.deepEqual(resolveIndexNowUrls({ paths: ['/templates', '/templates/storyboard-template'] }), []);
  assert.ok(!resolveIndexNowUrls({ all: true }).some((u) => u.includes('/templates')),
    '{ all: true } submits the held template store');
});

test('unknown, tokened, or duplicate paths are dropped, never submitted', () => {
  // A share token or an arbitrary path must never be handed to a search engine
  // as something to index; a duplicate must not double-count against the quota.
  const urls = resolveIndexNowUrls({ paths: ['/vs/nope', '/share/abcd', '/api/v1/boards', '/vs/pureref', '/vs/pureref', 'https://evil.example/x', 42] });
  assert.deepEqual(urls, [`${ORIGIN}/vs/pureref`]);
});

test('slug and paths combine, in that order', () => {
  assert.deepEqual(resolveIndexNowUrls({ slug: 'japandi-living-room', paths: ['/use-cases'] }),
    [`${ORIGIN}/c/japandi-living-room`, `${ORIGIN}/use-cases`]);
});

test('{ all: true } submits every registry page once, and nothing outside them', () => {
  const urls = resolveIndexNowUrls({ all: true });
  assert.ok(urls.length >= 80, `expected the whole public surface, got ${urls.length}`);
  assert.equal(new Set(urls).size, urls.length, 'duplicates');
  for (const u of urls) assert.match(u, /^https:\/\/clusters\.soleilpictures\.com\/(?!share\/|api\/|t\/|oauth\/)/, u);
  assert.ok(urls.includes(`${ORIGIN}/docs/mcp`) && urls.includes(`${ORIGIN}/best/storyboard-software`) && urls.includes(`${ORIGIN}/`));
});
