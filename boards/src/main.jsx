import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { AuthGate } from './auth/AuthGate.jsx';
import { TierRouter } from './auth/TierRouter.jsx';
import { FeedbackProvider } from './components/AppFeedback.jsx';
import { PublicBoardView } from './components/PublicBoardView.jsx';
import { AppErrorBoundary } from './components/AppErrorBoundary.jsx';
import './styles.css';

// Diagnostic: confirm the panel grain is actually rendering on each
// dark surface. Logs once after first paint with each surface's
// computed background-image + blend mode. Toggle off via
// window.__SOLEIL_GRAIN_DEBUG__ = false.
if (typeof window !== 'undefined' && window.__SOLEIL_GRAIN_DEBUG__ !== false) {
  setTimeout(() => {
    const surfaces = ['.topbar', '.sidebar', '.sb-mid', '.rail', '.share-modal', '.modal', '.twk-panel',
      '.bc', '.cnv-tools', '.tob', '.tob-pop', '.doc-tb', '.sketchpad-toolbar', '.sketchpad-frame',
      '.ctx-menu', '.ctx-submenu', '.cp-pop', '.ws-menu', '.cnv-add-menu', '.topbar-add-menu',
      '.entity-picker', '.entity-hover-popover', '.link-popover', '.link-hover-card',
      '.account-modal', '.settings-modal', '.home-graph-drawer', '.tag-detail', '.inbox'];
    const head = '%c[grain]';
    const headStyle = 'color:#ffa500;font-weight:600';
    // Sanity: try to load grain.gif directly so we know the asset exists.
    const probe = new Image();
    probe.onload  = () => console.log(head, headStyle, `/grain.gif loaded ok: ${probe.naturalWidth}×${probe.naturalHeight}`);
    probe.onerror = () => console.warn(head, headStyle, '/grain.gif FAILED to load — check public/ asset path');
    probe.src = '/grain.gif';
    for (const sel of surfaces) {
      const el = document.querySelector(sel);
      if (!el) { console.log(head, headStyle, `${sel} — not in DOM yet`); continue; }
      const cs = getComputedStyle(el);
      console.log(head, headStyle, sel, {
        bgImage: cs.backgroundImage,
        bgColor: cs.backgroundColor,
        blend:   cs.backgroundBlendMode,
        opacity: cs.opacity,
      });
    }
  }, 1500);
}

// Expose a small set of internals for end-to-end tests when running in
// local QA mode (`?local=1`). Lets Playwright assert invariants like
// "readCards anchors id to the Y.Map key" without needing a live
// Supabase / PartyKit setup.
if (typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('local')) {
  Promise.all([
    import('./lib/yhelpers.js'),
    import('./lib/commentPlacement.js'),
    import('yjs'),
  ]).then(([helpers, placement, Y]) => {
    window.__soleilTest = { ...helpers, ...placement, Y };
  }).catch(() => {});
}

// /share/<uuid> = public read-only viewer. Bypasses auth entirely so
// non-account-holders can preview a board without signing up. Any
// other path falls through to the normal app + auth gate.
const shareMatch = window.location.pathname.match(/^\/share\/([0-9a-f-]{36})\/?$/i);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <FeedbackProvider>
        {shareMatch ? (
          <PublicBoardView token={shareMatch[1]} />
        ) : (
          <AuthGate>
            <TierRouter>
              <App />
            </TierRouter>
          </AuthGate>
        )}
      </FeedbackProvider>
    </AppErrorBoundary>
  </StrictMode>
);
