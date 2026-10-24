// AppShell — the post-auth subtree (TierRouter + App), loaded as a single
// lazy chunk from main.jsx so the signed-out landing never downloads the
// editor (Yjs, TipTap, Three, etc.). Owns the perf-timing wrap so perf.js
// (which imports yjs) stays out of the entry chunk too.
import { useEffect } from 'react';
import { TierRouter } from './auth/TierRouter.jsx';
import { App as RawApp } from './App.jsx';
import { withPerfTime } from './lib/perf.js';
import { maybeRedirectToLatest } from './lib/stagingRedirect.js';
import { StagingBanner } from './components/StagingBanner.jsx';
import { bootMark } from './lib/bootMarks.js';
import { docLook } from './lib/looks.js';

// Wrap App so render.App.ms surfaces in perf.dump() without touching App.jsx.
const App = withPerfTime(RawApp, 'App');

// This chunk and everything it imports have run. `cached`: it came out of the
// HTTP cache, which the first open after a deploy never does, since its hash
// changes with nearly every promote.
bootMark('shell', { cached: (() => {
  try {
    const e = performance.getEntriesByName(import.meta.url)[0];
    return e ? e.transferSize === 0 : null;
  } catch (_) { return null; }
})() });

export default function AppShell() {
  // DocSurface (TipTap) is lazy off DocCard so the public /share path never
  // downloads vendor-editor. Warm it here on idle so SIGNED-IN users almost
  // never see the doc-card skeleton on their first doc open.
  useEffect(() => {
    const warm = () => {
      import('./components/DocSurface.jsx').catch(() => {});
      // The doc look's frame (components/doc/DocFrameA.jsx) beside it,
      // so the header doesn't arrive a beat after the doc.
      if (docLook()) import('./components/doc/DocFrameA.jsx').catch(() => {});
    };
    if (typeof window.requestIdleCallback === 'function') {
      const h = window.requestIdleCallback(warm, { timeout: 8000 });
      return () => window.cancelIdleCallback?.(h);
    }
    const t = setTimeout(warm, 4000);
    return () => clearTimeout(t);
  }, []);

  // Staging auto-redirect: on the prod domain, send eligible admins (admin or
  // internal allowlist) to the latest preview build, session handed off so they
  // stay logged in. No-op for everyone else / when opted to stable / when no
  // preview URL is set. Runs once we know the user is signed in (AppShell only
  // mounts inside AuthGate).
  useEffect(() => { maybeRedirectToLatest(); }, []);

  return (
    <TierRouter>
      <App />
      <StagingBanner />
    </TierRouter>
  );
}
