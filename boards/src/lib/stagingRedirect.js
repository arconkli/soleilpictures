// stagingRedirect.js — auto-send eligible admins to the latest (preview) build.
//
// How it works: after each push to main, the current preview URL is stored in
// the DB (app_config.staging_url). get_staging_redirect() returns it ONLY to
// eligible users (admins or the internal_accounts allowlist) and only while
// fresh. On the prod domain we read it and redirect the admin to that preview
// URL with their Supabase session handed off in the URL hash — AuthGate's
// existing consumeAuthCallback() adopts it, so they land logged in on the latest
// build. Everyone else gets null and stays on prod.
//
// The preview lives on a different origin (…workers.dev), so this is a real
// navigation, not a pretty in-place swap — that's the deliberate trade for
// keeping it simple (no edge proxy, no second worker, no secrets).
import { supabase } from './supabase.js';

const PROD_HOST   = 'clusters.soleilpictures.com';
const STABLE_PREF = 'soleil.staging.stable';      // localStorage '1' = stay on prod
const REDIR_GUARD = 'soleil.staging.redirected';  // sessionStorage one-shot guard

export function onProdHost() {
  return typeof window !== 'undefined' && window.location.hostname === PROD_HOST;
}
export function onPreviewHost() {
  return typeof window !== 'undefined' && /\.workers\.dev$/i.test(window.location.hostname);
}
function stablePref() {
  try { return localStorage.getItem(STABLE_PREF) === '1'; } catch (_) { return false; }
}
function setStablePref(on) {
  try {
    if (on) localStorage.setItem(STABLE_PREF, '1');
    else localStorage.removeItem(STABLE_PREF);
  } catch (_) {}
}
export { stablePref };

// Memoized eligibility+target lookup so the auto-redirect and the indicator
// share a single RPC per load. Returns the preview URL string, or null.
let _targetPromise = null;
export function getStagingTarget() {
  if (_targetPromise) return _targetPromise;
  _targetPromise = (async () => {
    try {
      const { data, error } = await supabase.rpc('get_staging_redirect');
      if (error) return null;
      return typeof data === 'string' && data ? data : null;
    } catch (_) { return null; }
  })();
  return _targetPromise;
}

// Send the admin back to stable prod (used by the "exit" control + ?stable=1).
// localStorage is per-origin, so setting the pref on the preview origin would NOT
// stop the redirect back on the prod origin — we carry ?stable=1 so prod sets its
// own opt-out (handled in maybeRedirectToLatest) and the exit actually sticks.
export function exitToStable() {
  setStablePref(true);
  try { window.location.replace(`https://${PROD_HOST}/?stable=1`); } catch (_) {}
}
// Re-enable auto-routing to latest (used by the prod-side "switch to latest").
export function switchToLatest() {
  setStablePref(false);
  try { sessionStorage.removeItem(REDIR_GUARD); } catch (_) {}
  try { window.location.reload(); } catch (_) {}
}

// Called once on app mount (AppShell). On the prod domain, redirect an eligible,
// non-opted-out admin to the latest preview, carrying their session in the hash.
export async function maybeRedirectToLatest() {
  if (!onProdHost()) return; // only ever redirect FROM the prod domain

  // ?stable=1 = escape hatch (stay on prod, e.g. if a preview was broken);
  // ?stable=0 = re-enable. Works even if the in-app toggle is unreachable.
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.has('stable')) {
      if (sp.get('stable') === '1') setStablePref(true);
      if (sp.get('stable') === '0') { setStablePref(false); try { sessionStorage.removeItem(REDIR_GUARD); } catch (_) {} }
      sp.delete('stable');
      const qs = sp.toString();
      window.history.replaceState({}, document.title, window.location.pathname + (qs ? `?${qs}` : ''));
    }
  } catch (_) {}

  const target = await getStagingTarget(); // null ⇒ not eligible / none set / stale
  if (!target) return;
  if (stablePref()) return;                // eligible but opted out → stay (indicator offers switch)
  try { if (sessionStorage.getItem(REDIR_GUARD)) return; } catch (_) {} // already tried this session

  let targetUrl;
  try { targetUrl = new URL(target); } catch (_) { return; }
  if (targetUrl.origin === window.location.origin) return; // somehow already there

  const { data } = await supabase.auth.getSession();
  const sess = data?.session;
  if (!sess?.access_token || !sess?.refresh_token) return;

  try { sessionStorage.setItem(REDIR_GUARD, '1'); } catch (_) {}

  // Hand the session off in the same hash shape AuthGate.consumeAuthCallback()
  // already understands (#access_token=…&refresh_token=…&expires_at=…), and keep
  // the current path so they land where they were.
  const hash = new URLSearchParams({
    access_token:  sess.access_token,
    refresh_token: sess.refresh_token,
    expires_at:    String(sess.expires_at || ''),
  }).toString();
  const dest = targetUrl.origin + window.location.pathname + window.location.search + '#' + hash;
  window.location.replace(dest);
}
