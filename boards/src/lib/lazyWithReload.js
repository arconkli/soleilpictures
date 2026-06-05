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
// thrown from inside the module, which we must NOT swallow).
function isChunkLoadError(err) {
  const msg = String((err && err.message) || err || '');
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|dynamically imported module/i.test(msg);
}

export function lazyWithReload(factory) {
  return lazy(() =>
    factory().catch((err) => {
      if (typeof window === 'undefined' || !isChunkLoadError(err)) throw err;

      let last = 0;
      try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch (_) { /* private mode */ }
      // We just reloaded — the chunk is genuinely unreachable (offline / real
      // 404), so surface the error instead of looping. A later deploy resets
      // the clock and lets a fresh reload through.
      if (Date.now() - last < RELOAD_WINDOW_MS) throw err;

      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch (_) { /* private mode */ }
      window.location.reload();
      // Keep the Suspense fallback up during the imminent reload rather than
      // flashing the error boundary: never resolve.
      return new Promise(() => {});
    }),
  );
}
