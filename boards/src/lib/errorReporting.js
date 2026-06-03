// errorReporting.js — FIRST-PARTY client error logging into Supabase
// (public.client_errors). No third-party SDK, no DSN, no quota — it reuses the
// exact keepalive-beacon pattern as analytics.js: anon-insertable + admin-read
// via RLS, fire-and-forget, redirect-safe so a crash that triggers a reload
// still lands. Bundle cost is ~nothing (no SDK), so it's safe on the landing.
//
//   import { logClientError } from './lib/errorReporting.js';
//   logClientError(err, { kind: 'render', componentStack });
//
// Wired from: main.jsx (window 'error' / 'unhandledrejection') and
// AppErrorBoundary.componentDidCatch (React render crashes). setErrorUser() is
// called from analytics.js's single onAuthStateChange so rows attribute to the
// signed-in user (id only — no email/PII).

const REST_URL   = (import.meta.env.VITE_SUPABASE_URL || '') + '/rest/v1/client_errors';
const PUBLIC_KEY  = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
                 || import.meta.env.VITE_SUPABASE_ANON_KEY;
const SESSION_KEY = 'soleil_session_id';   // shared with analytics.js → stitch errors to the funnel
const RELEASE     = import.meta.env.VITE_RELEASE || null;

let cachedUserId = null;
const _seen = new Set();   // collapse identical errors within a page load (avoid floods)

// Called from analytics.js's auth-state handler. Id only, never email.
export function setErrorUser(userId) {
  cachedUserId = userId ?? null;
}

function sessionId() {
  try { return localStorage.getItem(SESSION_KEY); } catch (_) { return null; }
}
function trim(s, n) { return typeof s === 'string' ? s.slice(0, n) : null; }

export function logClientError(error, { kind = 'error', componentStack = null } = {}) {
  if (!error || !PUBLIC_KEY || typeof fetch === 'undefined') return;
  try {
    const message = trim(error.message || String(error), 2000);
    const stack   = trim(error.stack, 8000);
    // Dedupe on kind + message + the first real stack frame, capped per page load.
    const key = `${kind}:${message}:${(stack || '').split('\n')[1] || ''}`;
    if (_seen.has(key)) return;
    if (_seen.size < 200) _seen.add(key);

    const row = {
      session_id:      sessionId(),
      user_id:         cachedUserId,
      kind,
      name:            trim(error.name, 200),
      message,
      stack,
      component_stack: trim(componentStack, 8000),
      path:            typeof window !== 'undefined' ? window.location.pathname : null,
      release:         RELEASE,
      user_agent:      typeof navigator !== 'undefined' ? trim(navigator.userAgent, 500) : null,
    };
    const body = JSON.stringify([row]);   // PostgREST bulk-inserts a JSON array

    // keepalive fetch survives a crash-triggered reload/navigation and can set
    // the apikey header PostgREST needs; sendBeacon (apikey in URL) is fallback.
    fetch(REST_URL, {
      method: 'POST',
      keepalive: true,
      headers: {
        apikey: PUBLIC_KEY,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body,
    }).catch(() => {
      try {
        navigator.sendBeacon(
          `${REST_URL}?apikey=${encodeURIComponent(PUBLIC_KEY)}`,
          new Blob([body], { type: 'application/json' }),
        );
      } catch (_) {}
    });
  } catch (_) { /* never let the reporter throw into the app */ }
}
