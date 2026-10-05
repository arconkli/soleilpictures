// The template store hold — what is held, where, and that every half obeys it.
//
//   node --test src/lib/templateStoreHold.test.mjs
//
// The store is built and reviewable on the preview deploy, and held off
// production (owner, 2026-10-04). Holding it is not one switch but a dozen
// readers of one: the Worker's routes and sitemap, IndexNow, the React router's
// pages, the canvas panel, the sign-up claim in App.jsx, and the docs build. A
// hold that one of them forgets is a store that is half launched — a page that
// 404s but sits in the sitemap, or a panel that offers a store that is not
// there. These tests are the closed side of each, which no e2e run can reach:
// Playwright drives the dev server, where the store is always open.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATE_STORE_HELD, isTemplateStorePath, templateStoreOpenOn } from './templatePaths.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(HERE, '..', rel), 'utf8');
const UUID = '3b2d89f2-9c1d-48af-8b89-2517b1b49712';

test('what counts as the store', () => {
  for (const p of ['/templates', '/templates/', '/templates/storyboard-template',
    '/templates/g/my-layout', '/Templates', `/t/${UUID}`, `/t/${UUID}/`]) {
    assert.equal(isTemplateStorePath(p), true, p);
  }
  for (const p of ['/', '/templatesx', '/tools/storyboard-maker', '/docs/canvas/grids',
    '/t/not-a-token', `/share/${UUID}`, '/templates.md', '', null]) {
    assert.equal(isTemplateStorePath(p), false, String(p));
  }
});

test('while held, only the preview deploy serves it', () => {
  if (!TEMPLATE_STORE_HELD) return;
  assert.equal(templateStoreOpenOn('soleil-boards.arconkli.workers.dev'), true, 'preview');
  assert.equal(templateStoreOpenOn('X.WORKERS.DEV'), true, 'hostnames are case-insensitive');
  assert.equal(templateStoreOpenOn('clusters.soleilpictures.com'), false, 'production');
  // capacitor://localhost is where the shipped native shells load from.
  assert.equal(templateStoreOpenOn('localhost'), false, 'the native shell');
  assert.equal(templateStoreOpenOn('clusters.example.com'), false, 'a future alias, closed by default');
  assert.equal(templateStoreOpenOn('workers.dev.evil.com'), false, 'anchored at the end');
  assert.equal(templateStoreOpenOn(''), false);
});

test('the client gate is the same allowlist, never a negated production check', () => {
  const src = read('lib/appHost.js');
  const body = (src.match(/export function templateStoreAllowed\(\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
  assert.ok(body, 'appHost.js no longer exports templateStoreAllowed()');
  assert.match(body, /import\.meta\.env\.DEV/, 'the dev server (and Playwright on it) keeps the store');
  assert.match(body, /templateStoreOpenOn\(window\.location\.hostname\)/, 'one host rule for both halves');
  assert.doesNotMatch(body, /onProdHost|localhost/, 'a denylist, or a localhost exception, opens it in the native shell');
});

// ── The Worker ──────────────────────────────────────────────────────────────
// worker.js imports cleanly under node (no Workers global at module scope), and
// the branches exercised here need only two of them: ASSETS, stubbed with the
// SPA shell, and HTMLRewriter, stubbed as a pass-through — the status code and
// the routing decision are what is under test, not the rewritten HTML.
const SHELL = '<!doctype html><html><head><title>Soleil Clusters</title></head><body><main id="seo-fallback"></main></body></html>';
const env = {
  ASSETS: { fetch: async () => new Response(SHELL, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }) },
};
async function get(url) {
  globalThis.HTMLRewriter ??= class { on() { return this; } transform(res) { return res; } };
  const { default: worker } = await import('../worker.js');
  return worker.handleFetch(new Request(url), env, { waitUntil() {} });
}

test('production answers every store URL with a real 404', async () => {
  if (!TEMPLATE_STORE_HELD) return;
  for (const p of ['/templates', '/templates/storyboard-template', '/templates/g/someones-layout', `/t/${UUID}`]) {
    const res = await get(`https://clusters.soleilpictures.com${p}`);
    assert.equal(res.status, 404, p);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex', `${p} must be noindex`);
  }
  // …and only the store: its neighbours still render.
  for (const p of ['/tools/storyboard-maker', '/use-cases']) {
    assert.equal((await get(`https://clusters.soleilpictures.com${p}`)).status, 200, p);
  }
});

test('the preview deploy still serves the store for review', async () => {
  for (const p of ['/templates', '/templates/storyboard-template', `/t/${UUID}`]) {
    assert.equal((await get(`https://soleil-boards.arconkli.workers.dev${p}`)).status, 200, p);
  }
});

test('the sitemap lists none of it', async () => {
  if (!TEMPLATE_STORE_HELD) return;
  const xml = await (await get('https://clusters.soleilpictures.com/sitemap.xml')).text();
  assert.match(xml, /\/tools\/storyboard-maker</, 'the sitemap failed to build at all');
  assert.doesNotMatch(xml, /\/templates/, 'the sitemap lists the held store');
});

// ── The client ──────────────────────────────────────────────────────────────
// Source-level, because these components cannot be rendered under node. Each
// line is the one place a refactor could drop the hold without anything else
// noticing.
test('every client entry point asks the gate', () => {
  const canvas = read('components/CanvasSurface.jsx');
  assert.match(canvas, /const templateStoreOpen = templateStoreAllowed\(\);/);
  assert.match(canvas, /const templatesEnabled = templateStoreOpen && /,
    'saved templates, Save as template, and Share in the store');
  assert.match(canvas, /const isTpl = templateStoreOpen && t\.id === 'grid';/,
    'the grid tool opens the Templates panel only where the store is open');
  assert.match(canvas, /if \(templateStoreOpen\) \{\s*items\.push\(\{\s*id: 'grid-apply-template'/,
    'Apply template… opens the panel');
  assert.match(canvas, /\{templateStoreOpen && justAddedTemplate && \(/, 'the "Grid template added" prompt');

  assert.match(read('App.jsx'), /src\.kind === 'curated'\) \{[\s\S]{0,600}?if \(!templateStoreAllowed\(\)\) return;/,
    'a template claim carried through sign-up');
  assert.match(read('pages/TemplateSharePage.jsx'), /if \(!templateStoreAllowed\(\)\) return <NotFoundPage \/>;/,
    'the /t/ share page');
  assert.match(read('pages/SeoLandingPage.jsx'), /const storeHeld = !specProp && isTemplateStorePath\(path\) && !templateStoreAllowed\(\);/,
    'the store front and its items');
});
