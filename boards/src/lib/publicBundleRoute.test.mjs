// publicBundleRoute.test.mjs — a /c/ page asks for its board at our own
// address, never by a cross-origin POST a crawler's renderer refuses.
//
// In late 2026-10 Google's renderer stopped making the page's POST to the
// party's host, every /c/ page it rendered read "Couldn't load this board", and
// Search Console filed the boards as Soft 404s. These pin both halves of the
// fix: the same-origin GET, and the article that stays when the board doesn't.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PUBLIC_BUNDLE_PATH, publicBundleQuery, publicBundlePath } from './publicBundleRoute.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const BOARD = '0b6b3c1e-5b4f-4d0e-9a51-6f2d1c7a9e10';
const q = (s) => publicBundleQuery(new URLSearchParams(s));

test('the query is the slug, and the board id only when it is one', () => {
  assert.deepEqual(q('slug=film-noir-look-book'), { slug: 'film-noir-look-book' });
  assert.deepEqual(q(`slug=film-noir-look-book&b=${BOARD}`), { slug: 'film-noir-look-book', boardId: BOARD });
  assert.deepEqual(q('slug=film-noir-look-book&b=not-a-board'), { slug: 'film-noir-look-book' });
});

test('anything that is not a slug is refused', () => {
  for (const s of ['', 'slug=', 'slug=Film-Noir', 'slug=-noir', 'slug=a/b', `slug=${'a'.repeat(81)}`, 'b=' + BOARD]) {
    assert.equal(q(s), null, s);
  }
});

test('the URL the page builds is the query the Worker reads', () => {
  const url = new URL(publicBundlePath('film-noir-look-book', BOARD), 'https://clusters.soleilpictures.com');
  assert.equal(url.origin, 'https://clusters.soleilpictures.com');
  assert.equal(url.pathname, PUBLIC_BUNDLE_PATH);
  assert.deepEqual(publicBundleQuery(url.searchParams), { slug: 'film-noir-look-book', boardId: BOARD });
  assert.equal(publicBundlePath('noir'), `${PUBLIC_BUNDLE_PATH}?slug=noir`);
});

test('the early fetch the Worker injects into /c/ pages is a same-origin GET', () => {
  const src = read('../worker.js');
  const early = src.slice(src.indexOf('const PUBLIC_EARLY_FETCH'), src.indexOf('function injectShareMeta'));
  assert.ok(early.includes('${PUBLIC_BUNDLE_PATH}?slug='), 'the early fetch asks /api/public-bundle');
  assert.ok(!/parties\/upload\/share\/public-bundle/.test(early), 'never the party host');
  assert.ok(!/method\s*:\s*'POST'/.test(early), 'a GET: no preflight');
});

test('the Worker answers the path, asking the party over the binding', () => {
  const src = read('../worker.js');
  assert.ok(src.includes('url.pathname === PUBLIC_BUNDLE_PATH'), 'the route is wired');
  const h = src.slice(src.indexOf('async function handlePublicBundle('), src.indexOf('async function handleBoardReset('));
  assert.ok(h.includes('partyFetch(env,'), 'server to server, by the PARTY binding');
  // The page trusts an answer only when the route marked it; anything else
  // (vite's own 404, a Worker that crashed) falls back to the direct POST.
  assert.ok(h.includes("'x-soleil-bundle': '1'"), 'the route marks its answers');
  const page = read('../components/PublicBoardView.jsx');
  assert.ok(page.includes("res.headers.get('x-soleil-bundle')"), 'the page reads the mark');
});

test('the page asks our own address first and keeps its article while the board is missing', () => {
  const src = read('../components/PublicBoardView.jsx');
  const fn = src.slice(src.indexOf('async function fetchPublicBundle('), src.indexOf('async function fetchPublicBundle(') + 1400);
  assert.ok(fn.indexOf('publicBundlePath(') > -1 && fn.indexOf('publicBundlePath(') < fn.indexOf('parties/upload/share/public-bundle'),
    'the same-origin GET comes before the direct POST');
  assert.ok(/if \(!res\) res = await fetchPublicBundle\(slug, boardId\);/.test(src), 'slug mode uses it');
  assert.ok(/\(status === 'loading' \|\| status === 'error'\) && pageModel/.test(src), 'loading and failure keep the article');
});

test('robots.txt never shuts a renderer out of /api/ (the board and its images are fetched there)', () => {
  const robots = read('../../public/robots.txt');
  assert.ok(!/^\s*Disallow:\s*\/api\b/im.test(robots));
});
