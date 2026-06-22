// Unit tests for the stale-deploy chunk-recovery contract
// (lib/lazyWithReload.js) — the classifier + guarded one-shot reload that every
// lazy route (incl. the note editor, since this fix) relies on. Pure functions
// that read global `window`/`sessionStorage`, so we run them straight in the
// Playwright Node process behind a fake window/sessionStorage. No page.

import { expect, test } from '@playwright/test';
import { looksLikeStaleChunk, reloadIfStaleChunk } from '../src/lib/lazyWithReload.js';

// Run `fn` with a fresh fake window + sessionStorage installed on globalThis
// (the module references both bare). `fn` receives a getter for the reload count.
function withFakeWindow(fn) {
  const store = new Map();
  let reloads = 0;
  const prevWindow = globalThis.window;
  const prevSession = globalThis.sessionStorage;
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.window = { location: { reload: () => { reloads += 1; } } };
  try {
    return fn(() => reloads);
  } finally {
    globalThis.window = prevWindow;
    globalThis.sessionStorage = prevSession;
  }
}

const CHUNK_404 = 'Failed to fetch dynamically imported module: https://x/assets/NoteTiptapSurface-ABC.js';
const MIME_HTML = 'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of text/html';
const LAZY_DEFAULT = "Cannot read properties of undefined (reading 'default')";

test('looksLikeStaleChunk: recognizes a 404 dynamic-import failure', () => {
  expect(looksLikeStaleChunk(new Error(CHUNK_404))).toBe(true);
});

test('looksLikeStaleChunk: recognizes the SPA-fallback MIME error', () => {
  expect(looksLikeStaleChunk(new Error(MIME_HTML))).toBe(true);
});

test('looksLikeStaleChunk: recognizes the undefined-.default lazy crash', () => {
  expect(looksLikeStaleChunk(new Error(LAZY_DEFAULT))).toBe(true);
});

test('looksLikeStaleChunk: a genuine runtime error is NOT a stale chunk', () => {
  expect(looksLikeStaleChunk(new Error('x.map is not a function'))).toBe(false);
});

test('reloadIfStaleChunk: a stale chunk reloads exactly once (10s guard blocks the retry)', () => {
  withFakeWindow((reloads) => {
    const err = new Error(CHUNK_404);
    expect(reloadIfStaleChunk(err)).toBe(true);   // first hit → reload
    expect(reloads()).toBe(1);
    expect(reloadIfStaleChunk(err)).toBe(false);  // within 10s → guarded, no loop
    expect(reloads()).toBe(1);
  });
});

test('reloadIfStaleChunk: a real runtime error never reloads', () => {
  withFakeWindow((reloads) => {
    expect(reloadIfStaleChunk(new Error('totally unrelated bug'))).toBe(false);
    expect(reloads()).toBe(0);
  });
});

test('reloadIfStaleChunk: undefined-.default only recovers when the stack names a Lazy boundary', () => {
  withFakeWindow((reloads) => {
    // No Lazy in the stack → treat as a real bug, do not reload.
    expect(reloadIfStaleChunk(new Error(LAZY_DEFAULT), 'at App\n at div')).toBe(false);
    expect(reloads()).toBe(0);
  });
  withFakeWindow((reloads) => {
    // Stack names Lazy → it's a stale lazy chunk → reload once.
    expect(reloadIfStaleChunk(new Error(LAZY_DEFAULT), 'at Lazy\n at Suspense')).toBe(true);
    expect(reloads()).toBe(1);
  });
});
