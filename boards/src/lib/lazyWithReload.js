// lazyWithReload.js — stale-deploy recovery for React.lazy() routes.
//
// Asset filenames are content-hashed, so after a deploy a tab still running the
// PREVIOUS build 404s when it lazy-loads a now-replaced chunk — surfacing as
// "Failed to fetch dynamically imported module". main.jsx already handles Vite's
// `vite:preloadError` event, but a bare React.lazy() import() that rejects on a
// 404 does NOT always fire that event — it rejects the import promise and bubbles
// to the nearest error boundary (the user sees the crash panel). This wraps the
// lazy factory so the same one-shot reload kicks in at the import site too.
//
//   const AppShell = lazyWithReload(() => import('./AppShell.jsx'));
//
// It shares the exact sessionStorage guard key + window with the preloadError
// handler, so the two paths can never double-reload.

import { lazy } from 'react';

const RELOAD_KEY = 'soleil:chunk-reload-at';   // shared with main.jsx vite:preloadError handler
const RELOAD_WINDOW_MS = 10_000;

// A genuine stale-chunk / network module-load failure (vs. a real runtime error
// thrown from inside the module, which we must NOT swallow). Covers the two
// shapes a vanished post-deploy chunk takes: a flat 404 ("Failed to fetch
// dynamically imported module") AND the SPA fallback serving index.html where
// JS was expected, which surfaces as a MIME-type error ("Failed to load module
// script: Expected a JavaScript module script but the server responded with a
// MIME type of text/html"). Phrasing varies by browser, so match each token.
function isChunkLoadError(err) {
  const msg = String((err && err.message) || err || '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|dynamically imported module|Failed to load module script|Expected a JavaScript module script|MIME type/i.test(msg);
}

// The downstream symptom of a lazy chunk that resolved to `undefined`: React's
// lazy initializer reads `.default` off nothing. Chrome phrases this
// "Cannot read properties of undefined (reading 'default')"; Safari/Firefox
// "undefined is not an object (evaluating '….default')". This is the exact crash
// our error boundary saw twice — used (gated on a Lazy component stack) as a
// last-resort recovery signal when a chunk failure slips past isChunkLoadError.
function isLazyDefaultError(err) {
  const msg = String((err && err.message) || err || '');
  return /Cannot read properties of undefined \(reading 'default'\)|undefined is not an object[^]*\bdefault\b/i.test(msg);
}

// Either shape of a stale-deploy lazy failure, by message alone. Safe to call
// from React's getDerivedStateFromError (which has no component stack).
export function looksLikeStaleChunk(err) {
  return isChunkLoadError(err) || isLazyDefaultError(err);
}

// The guarded one-shot reload core, decoupled from error classification. Returns
// true if it triggered a reload; false if the 10s guard says we JUST reloaded
// (so the caller stops retrying and surfaces the failure instead of looping).
// The shared RELOAD_KEY means lazyWithReload, importWithReload, the error
// boundary, and main.jsx can never double-reload each other.
function guardedReloadOnce() {
  if (typeof window === 'undefined') return false;
  let last = 0;
  try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch (_) { /* private mode */ }
  // We just reloaded — the chunk is genuinely unreachable (offline / real
  // 404 / broken deploy), so surface the error instead of looping. A later
  // deploy resets the clock and lets a fresh reload through.
  if (Date.now() - last < RELOAD_WINDOW_MS) return false;
  try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch (_) { /* private mode */ }
  window.location.reload();
  return true;
}

// Shared recovery used by both lazyWithReload() and importWithReload(). Re-throws
// anything that isn't a stale-chunk load failure so real runtime errors still
// surface. On a stale-chunk error it reloads ONCE (guarded) and returns a
// never-resolving promise so the caller's pending UI (a <Suspense> fallback, or
// just nothing) stays put during the imminent reload instead of flashing an
// error boundary. Throws to bubble; never returns a rejected promise.
function recoverFromChunkError(err) {
  if (typeof window === 'undefined' || !isChunkLoadError(err)) throw err;
  if (!guardedReloadOnce()) throw err;
  // Keep whatever was showing up during the imminent reload: never resolve.
  return new Promise(() => {});
}

// Last-resort recovery for an error boundary. Treats `err` as a stale-deploy
// failure when it's an unambiguous chunk-load error, OR a lazy `.default` crash
// whose React componentStack actually names a `Lazy` boundary (so a coincidental
// runtime `.default` bug elsewhere is NOT silently reloaded forever). Returns
// true when it kicked off a one-shot reload (the boundary should show a neutral
// fallback), false otherwise (the boundary should surface its crash panel).
export function reloadIfStaleChunk(err, componentStack = '') {
  const stack = String(componentStack || '');
  const recoverable = isChunkLoadError(err) || (isLazyDefaultError(err) && /\bLazy\b/.test(stack));
  if (!recoverable) return false;
  return guardedReloadOnce();
}

export function lazyWithReload(factory) {
  return lazy(() => factory().catch(recoverFromChunkError));
}

// One-shot equivalent for a bare dynamic import() that isn't a React.lazy route
// (e.g. an on-interaction `import('../lib/uploads.js')`). Same guarded one-shot
// reload on a stale post-deploy chunk, so non-lazy code paths self-heal too.
//   importWithReload(() => import('../lib/uploads.js')).then(m => m.run())
export function importWithReload(factory) {
  return factory().catch(recoverFromChunkError);
}
