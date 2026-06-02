import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthGate, SplashLoading } from './auth/AuthGate.jsx';
import { FeedbackProvider } from './components/AppFeedback.jsx';
import { isDocQaMode } from './lib/localMode.js';
import { AppErrorBoundary } from './components/AppErrorBoundary.jsx';
import { startHeartbeat } from './lib/heartbeat.js';
import { initCapacitor } from './lib/capacitorInit.js';
import { preloadRecentGoogleFonts } from './lib/googleFonts.js';
import { getRecentFonts } from './lib/customFonts.js';
import { captureFbclid, installSpaPageViews } from './lib/metaPixel.js';
import './styles/breakpoints.css';
import './styles.css';

// Heavy/post-auth subtrees are code-split out of the entry chunk so the
// signed-out landing (AuthGate → SignIn → SignInBackdrop) ships minimal JS.
// AppShell (TierRouter + App + the whole editor) only loads once signed in;
// the share + legal viewers load only on their routes. A single <Suspense>
// below covers all three, using AuthGate's own SplashLoading as the fallback.
const AppShell        = lazy(() => import('./AppShell.jsx'));
const PublicBoardView = lazy(() => import('./components/PublicBoardView.jsx').then(m => ({ default: m.PublicBoardView })));
const LegalPage       = lazy(() => import('./auth/LegalPage.jsx').then(m => ({ default: m.LegalPage })));
const PublicPricingPage = lazy(() => import('./auth/PublicPricingPage.jsx').then(m => ({ default: m.PublicPricingPage })));

// Meta Pixel: persist any ?fbclid= ad-click id (durable _fbc) BEFORE anything
// reads getFbCookies(), so a conversion attributes to the ad even days later.
// Then fire PageView on SPA route changes too — the base snippet in index.html
// only fires the cold load. Same rationale as the CWA spa:true beacon below: our
// hand-rolled router navigates via the History API.
captureFbclid();
installSpaPageViews();

// Cloudflare Web Analytics beacon. Lazy-injected when VITE_CF_ANALYTICS_TOKEN
// is set so dev / unconfigured deploys silently skip it. The `spa: true`
// option tells CWA to fire pageview events on History API changes — our
// hand-rolled router uses window.history.replaceState, so this picks up
// /welcome, /pricing, /waitlist/status, etc. without extra wiring.
(function injectCfAnalytics() {
  if (typeof document === 'undefined') return;
  const token = import.meta.env.VITE_CF_ANALYTICS_TOKEN;
  if (!token) return;
  const s = document.createElement('script');
  s.defer = true;
  s.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  s.setAttribute('data-cf-beacon', JSON.stringify({ token, spa: true }));
  document.head.appendChild(s);
})();

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

// /legal/<privacy|terms|cookies> = public legal documents. Like /share, these
// render before the AuthGate so they're reachable signed-out (footer links,
// ad-policy review, etc). SPA fallback in the Worker serves these deep links.
const legalMatch = window.location.pathname.match(/^\/legal\/(privacy|terms|cookies)\/?$/i);

// /pricing = public, crawlable pricing for SIGNED-OUT visitors (and search
// crawlers). Signed-in users skip this and fall through to AuthGate → the
// account-aware PricingPage in TierRouter (Manage Billing / current plan), so
// we only intercept here when there's no cached Supabase session.
const pricingMatch = window.location.pathname.match(/^\/pricing\/?$/i);
function hasCachedSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      // Default supabase storageKey is `sb-<ref>-auth-token`. Presence is a
      // heuristic — AuthGate still does the real validation downstream.
      if (k && k.startsWith('sb-') && k.includes('auth-token')) return true;
    }
  } catch (_) {}
  return false;
}
const showPublicPricing = !!pricingMatch && !hasCachedSession();

// Platform-wide time-in-app counter. Visibility-aware; runs even
// pre-auth so landing-page time also counts.
startHeartbeat();

// Capacitor native bootstrap (status bar, keyboard, splash, deep
// links, Android back button). No-ops in the web build — every
// plugin checks Capacitor.isNativePlatform() before doing work.
initCapacitor();

// Pre-load Google fonts the user has used recently so the corresponding
// <link> tags are in <head> before any note/doc renders — otherwise saved
// inline `font-family:'Inter',…` falls back to system-ui on cold load.
preloadRecentGoogleFonts(getRecentFonts());

// Dev-only doc QA harness (?docqa=1). The literal `import.meta.env.DEV` guard
// lets the bundler statically drop this whole branch — and the dynamic
// import('./local/DocQaHarness.jsx') chunk — from production builds. It
// short-circuits the normal app tree so tests get a clean, backend-free
// surface for the real doc components.
if (import.meta.env.DEV && isDocQaMode()) {
  import('./local/DocQaHarness.jsx').then(({ DocQaHarness }) => {
    createRoot(document.getElementById('root')).render(
      <StrictMode>
        <AppErrorBoundary>
          <FeedbackProvider>
            <DocQaHarness />
          </FeedbackProvider>
        </AppErrorBoundary>
      </StrictMode>
    );
  });
} else {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <AppErrorBoundary>
        <FeedbackProvider>
          <Suspense fallback={<SplashLoading />}>
            {legalMatch ? (
              <LegalPage doc={legalMatch[1].toLowerCase()} />
            ) : showPublicPricing ? (
              <PublicPricingPage />
            ) : shareMatch ? (
              <PublicBoardView token={shareMatch[1]} />
            ) : (
              <AuthGate>
                <AppShell />
              </AuthGate>
            )}
          </Suspense>
        </FeedbackProvider>
      </AppErrorBoundary>
    </StrictMode>
  );
}
