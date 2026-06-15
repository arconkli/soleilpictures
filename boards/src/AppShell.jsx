// AppShell — the post-auth subtree (TierRouter + App), loaded as a single
// lazy chunk from main.jsx so the signed-out landing never downloads the
// editor (Yjs, TipTap, Three, etc.). Owns the perf-timing wrap so perf.js
// (which imports yjs) stays out of the entry chunk too.
import { useEffect } from 'react';
import { TierRouter } from './auth/TierRouter.jsx';
import { App as RawApp } from './App.jsx';
import { withPerfTime } from './lib/perf.js';

// Wrap App so render.App.ms surfaces in perf.dump() without touching App.jsx.
const App = withPerfTime(RawApp, 'App');

export default function AppShell() {
  // DocSurface (TipTap) is lazy off DocCard so the public /share path never
  // downloads vendor-editor. Warm it here on idle so SIGNED-IN users almost
  // never see the doc-card skeleton on their first doc open.
  useEffect(() => {
    const warm = () => { import('./components/DocSurface.jsx').catch(() => {}); };
    if (typeof window.requestIdleCallback === 'function') {
      const h = window.requestIdleCallback(warm, { timeout: 8000 });
      return () => window.cancelIdleCallback?.(h);
    }
    const t = setTimeout(warm, 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <TierRouter>
      <App />
    </TierRouter>
  );
}
