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

// ── warm ───────────────────────────────────────────────────────────────

test('warm fetches the chunk ahead of the first render and swallows a failure', async () => {
  const { lazyWithReload } = await import('./lazyWithReload.js');
  let calls = 0;
  const ok = lazyWithReload(() => { calls += 1; return Promise.resolve({ default: () => null }); });
  ok.warm();
  assert.equal(calls, 1, 'the import starts at once');
  const failing = lazyWithReload(() => Promise.reject(new Error('Failed to fetch dynamically imported module: /assets/x.js')));
  let unhandled = null;
  const onUnhandled = (e) => { unhandled = e; };
  process.on('unhandledRejection', onUnhandled);
  failing.warm();
  await new Promise((r) => setTimeout(r, 10));
  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled, null, 'a failed warm is left for the render, which recovers from it');
});

// ── offline (the note editor's option) ─────────────────────────────────
//
// A note opened on a weak connection used to reload the whole app on one
// failed fetch, and offline that reload landed on the browser's offline page.
// No retries: a browser keeps a failed import() for the page's life
// (Chromium 147 and WebKit 26.4, probed 2026-11-09, answered a second
// import() of the same address without fetching), so only a reload helps.

const chunkError = () => new Error('Failed to fetch dynamically imported module: /assets/NoteTiptapSurface-x.js');

// A failing factory: rejects `failures` times (Infinity: always), then loads.
function flaky(failures, err = chunkError) {
  const f = () => {
    f.calls += 1;
    return f.calls <= failures ? Promise.reject(err()) : Promise.resolve({ default: () => null });
  };
  f.calls = 0;
  return f;
}

// A browser just big enough for the reload guard: window.location.reload,
// sessionStorage and navigator.onLine.
function fakeBrowser({ onLine = true, reloadedAt = null } = {}) {
  const store = new Map();
  if (reloadedAt != null) store.set('soleil:chunk-reload-at', String(reloadedAt));
  const reloads = { count: 0 };
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  globalThis.window = { location: { reload: () => { reloads.count += 1; } } };
  globalThis.sessionStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true, writable: true });
  return {
    reloads,
    restore() {
      delete globalThis.window;
      delete globalThis.sessionStorage;
      if (nav) Object.defineProperty(globalThis, 'navigator', nav);
      else delete globalThis.navigator;
    },
  };
}

// 'resolved' | 'rejected' | 'pending' (a reload in flight never settles).
const settleWithin = (p, ms = 30) => Promise.race([
  p.then(() => 'resolved', () => 'rejected'),
  new Promise((r) => setTimeout(() => r('pending'), ms)),
]);

test('without options a chunk failure still reloads at once, online or not', async () => {
  const { loadChunk } = await import('./lazyWithReload.js');
  const b = fakeBrowser({ onLine: false });
  try {
    const f = flaky(Infinity);
    assert.equal(await settleWithin(loadChunk(f)), 'pending', 'the reload is in flight');
    assert.equal(f.calls, 1, 'no retries by default');
    assert.equal(b.reloads.count, 1, 'every other caller keeps the old behaviour');
  } finally { b.restore(); }
});

test("the note editor's option, online: one try, then the reload", async () => {
  const { loadChunk } = await import('./lazyWithReload.js');
  const b = fakeBrowser();
  try {
    const f = flaky(Infinity);
    assert.equal(await settleWithin(loadChunk(f, { reloadWhenOffline: false })), 'pending', 'the reload is in flight');
    assert.equal(f.calls, 1, 'a second import of the same address would only repeat the failure');
    assert.equal(b.reloads.count, 1, 'a stale deploy still gets its one reload');
  } finally { b.restore(); }
});

test('offline, the note editor never reloads: the failure reaches its boundary', async () => {
  const { loadChunk } = await import('./lazyWithReload.js');
  const b = fakeBrowser({ onLine: false });
  try {
    const f = flaky(Infinity);
    await assert.rejects(loadChunk(f, { reloadWhenOffline: false }), /dynamically imported module/);
    assert.equal(f.calls, 1, 'one try');
    assert.equal(b.reloads.count, 0);
  } finally { b.restore(); }
});

test('just reloaded for a chunk: the failure reaches the boundary instead of looping', async () => {
  const { loadChunk } = await import('./lazyWithReload.js');
  const b = fakeBrowser({ reloadedAt: Date.now() - 1_000 });
  try {
    await assert.rejects(loadChunk(flaky(Infinity), { reloadWhenOffline: false }));
    assert.equal(b.reloads.count, 0);
  } finally { b.restore(); }
});

test("the note editor's lazy warms with one import and can be reset", async () => {
  const { lazyWithReload } = await import('./lazyWithReload.js');
  const f = flaky(0);
  const C = lazyWithReload(f, { reloadWhenOffline: false });
  assert.equal(typeof C, 'function', 'a component');
  assert.equal(typeof C.reset, 'function');
  C.warm();
  assert.equal(f.calls, 1, 'warm is one import(), no render');
  C.reset(); // nothing failed: a no-op, so a loaded editor never re-suspends
});
