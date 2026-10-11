// lazyWithReload.test.mjs — the stale-chunk predicate.
//
//   node --test src/lib/lazyWithReload.test.mjs
//
// looksLikeStaleChunk is the whole recovery decision: true means "a deploy
// moved out from under this tab, reload once", false means "a real runtime
// error — surface it". Every miss is a user staring at the crash panel on a
// page that would have worked after one reload, so the cases below are the
// exact message strings browsers and Vite actually produce, not paraphrases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeStaleChunk, isCssPreloadError, reloadedRecently } from './lazyWithReload.js';

// ── module chunks ──────────────────────────────────────────────────────

test('a 404ed JS chunk is a stale chunk', () => {
  assert.equal(looksLikeStaleChunk(new Error(
    'Failed to fetch dynamically imported module: https://clusters.soleilpictures.com/assets/AppShell-abc123.js')), true);
  assert.equal(looksLikeStaleChunk(new Error('Importing a module script failed.')), true);
});

test('the SPA fallback serving index.html for JS is a stale chunk', () => {
  assert.equal(looksLikeStaleChunk(new Error(
    'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of text/html.')), true);
});

test('a chunk that resolved to undefined is a stale chunk', () => {
  assert.equal(looksLikeStaleChunk(new Error("Cannot read properties of undefined (reading 'default')")), true);
  assert.equal(looksLikeStaleChunk(new Error("undefined is not an object (evaluating 'e._result.default')")), true);
});

// ── CSS chunks ─────────────────────────────────────────────────────────
//
// Vite code-splits CSS per lazy chunk and __vitePreload throws this exact
// string on a failed <link> dep. It shares no token with any module message,
// so it used to fall through to the crash panel — observed in production on
// /best/pureref-alternatives, /best/mood-board-apps and /c/*.

test('a 404ed CSS dep is a stale chunk', () => {
  assert.equal(looksLikeStaleChunk(new Error(
    'Unable to preload CSS for /assets/SeoListiclePage-CHS83PAp.css')), true);
  assert.equal(looksLikeStaleChunk(new Error(
    'Unable to preload CSS for /assets/seoLanding-DwrwM0kR.css')), true);
  assert.equal(looksLikeStaleChunk(new Error(
    'Unable to preload CSS for /assets/CanvasSurface-CYs0vVfn.css')), true);
});

// ── real errors must NOT be swallowed ──────────────────────────────────

test('a genuine runtime error from inside the module is not a stale chunk', () => {
  assert.equal(looksLikeStaleChunk(new TypeError("Cannot read properties of null (reading 'forEach')")), false);
  assert.equal(looksLikeStaleChunk(new RangeError('Position 529 out of range')), false);
  assert.equal(looksLikeStaleChunk(new ReferenceError('board is not defined')), false);
});

test('a CSS-shaped message that is not the preload failure is not a stale chunk', () => {
  // Guards against widening the pattern to a bare /CSS/ — an app error that
  // merely mentions CSS must still reach the boundary.
  assert.equal(looksLikeStaleChunk(new Error('Invalid CSS custom property --soleil')), false);
});

test('non-Error inputs do not throw', () => {
  assert.equal(looksLikeStaleChunk(undefined), false);
  assert.equal(looksLikeStaleChunk(null), false);
  assert.equal(looksLikeStaleChunk('Unable to preload CSS for /assets/x.css'), true);
});

// ── the second CSS failure renders instead of crashing ─────────────────
//
// main.jsx prevents vite:preloadError for a stylesheet that fails again right
// after the recovery reload, so the page renders with the CSS it has instead
// of the red panel. That decision is these two predicates.

test('only the route stylesheet failure counts as a CSS preload error', () => {
  assert.equal(isCssPreloadError(new Error('Unable to preload CSS for /assets/LegalPage-DlZ4kV4w.css')), true);
  assert.equal(isCssPreloadError(new Error('Failed to fetch dynamically imported module: /assets/LegalPage-x.js')), false);
  assert.equal(isCssPreloadError(undefined), false);
});

test('reloadedRecently reads the shared reload guard', () => {
  const store = new Map();
  globalThis.window = {};
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  try {
    assert.equal(reloadedRecently(), false, 'no reload yet: let the error reload the page');
    store.set('soleil:chunk-reload-at', String(Date.now() - 2_000));
    assert.equal(reloadedRecently(), true, 'just reloaded: a reload would be refused');
    store.set('soleil:chunk-reload-at', String(Date.now() - 60_000));
    assert.equal(reloadedRecently(), false, 'an old reload no longer counts');
  } finally {
    delete globalThis.window;
    delete globalThis.sessionStorage;
  }
});
