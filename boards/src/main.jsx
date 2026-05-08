import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { AuthGate } from './auth/AuthGate.jsx';
import { FeedbackProvider } from './components/AppFeedback.jsx';
import { PublicBoardView } from './components/PublicBoardView.jsx';
import { AppErrorBoundary } from './components/AppErrorBoundary.jsx';
import './styles.css';

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
            <App />
          </AuthGate>
        )}
      </FeedbackProvider>
    </AppErrorBoundary>
  </StrictMode>
);
