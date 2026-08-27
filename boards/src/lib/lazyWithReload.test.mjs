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
import { looksLikeStaleChunk } from './lazyWithReload.js';

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
