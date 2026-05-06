// Supabase client singleton.
// If env vars are missing we return null so the rest of the app can fall back
// to local-only dev mode instead of crashing — this keeps Phase 0 prototypes
// working before the user has provisioned a Supabase project.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
// Prefer the modern publishable key; fall back to legacy anon JWT.
const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
              || import.meta.env.VITE_SUPABASE_ANON_KEY;

// Solo-collab testing: `?as=<id>` namespaces auth + session storage so a
// second window can be signed in as a different user. Used for testing
// realtime / sharing without a second device.
function readAsParam() {
  if (typeof window === 'undefined') return null;
  try {
    const v = new URLSearchParams(window.location.search).get('as');
    return v && /^[a-zA-Z0-9_-]{1,16}$/.test(v) ? v : null;
  } catch (_) { return null; }
}

export const altSessionId = readAsParam();

function makeNamespacedStorage(suffix) {
  // Wrap localStorage so every key gets the suffix appended, isolating this
  // window's auth/session data from other windows on the same origin.
  const ls = typeof localStorage === 'undefined' ? null : localStorage;
  if (!ls) return undefined; // let supabase fall back to its default
  const wrap = (k) => `${k}::${suffix}`;
  return {
    getItem:    (k) => ls.getItem(wrap(k)),
    setItem:    (k, v) => ls.setItem(wrap(k), v),
    removeItem: (k) => ls.removeItem(wrap(k)),
  };
}

export const supabase = (url && publicKey)
  ? createClient(url, publicKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        ...(altSessionId ? { storage: makeNamespacedStorage(altSessionId), storageKey: `sb-auth-as-${altSessionId}` } : {}),
      },
    })
  : null;

export const isSupabaseConfigured = !!supabase;

// ── Realtime transport reset on wake events ────────────────────────────
// When the OS / browser kills our websocket while the tab is backgrounded,
// realtime-js's cached state still says "connected." Worse, supabase-js's
// auto-refresh ticker is paused while hidden — after 1+ hours idle the
// cached JWT is expired, so even a forced reconnect uses a dead token and
// the server silently rejects channel joins. The only reliable recovery:
//   1. Force `auth.refreshSession()` to mint a fresh JWT.
//   2. Push it to realtime via `setAuth()` (belt-and-suspenders for the
//      `onAuthStateChange → TOKEN_REFRESHED` hook in supabase-js itself).
//   3. AWAIT `realtime.disconnect()` (it's async — calling connect() too
//      early hits the `isDisconnecting()` guard and silently no-ops).
//   4. `realtime.connect()` to open a new socket; channels resubscribe
//      via their own CLOSED handlers.

const BOUNCE_THROTTLE_MS = 80;
let bouncePromise = null;
let lastBounceAt = 0;

async function refreshAndBounce(_reason) {
  if (!supabase) return;
  if (bouncePromise) return bouncePromise;             // coalesce concurrent calls
  if (Date.now() - lastBounceAt < BOUNCE_THROTTLE_MS) return;

  bouncePromise = (async () => {
    try {
      // 1. Force a session refresh. If the refresh token itself is dead
      //    (>30d idle, rotated, revoked elsewhere), log and proceed —
      //    the channel will fail to join, the auth UI handles re-auth.
      let token = null;
      try {
        const { data, error } = await supabase.auth.refreshSession();
        if (error) console.warn('[realtime] refreshSession failed; bouncing with stale token', error.message);
        token = data?.session?.access_token ?? null;
      } catch (e) { console.warn('[realtime] refreshSession threw', e); }

      // 2. Explicit setAuth — supabase-js usually does this on
      //    TOKEN_REFRESHED, but being explicit avoids races with the
      //    bounce we're about to do.
      if (token) {
        try { supabase.realtime.setAuth(token); } catch (e) { console.warn('[realtime] setAuth failed', e); }
      }

      // 3. Await the disconnect. Without await, connect() below short-
      //    circuits because the client is still in `disconnecting` state.
      try { await supabase.realtime.disconnect(); } catch (e) { console.warn('[realtime] disconnect failed', e); }

      // 4. Reconnect. Channels' onSubscribeStatus CLOSED handlers in
      //    ySupabase.js / workspaceRealtime.js will re-subscribe.
      try { supabase.realtime.connect(); } catch (e) { console.warn('[realtime] connect failed', e); }

      lastBounceAt = Date.now();
    } finally {
      bouncePromise = null;
    }
  })();
  return bouncePromise;
}

if (supabase && typeof document !== 'undefined') {
  const onVisibility = () => { if (document.visibilityState === 'visible') refreshAndBounce('visibility'); };
  // pageshow with persisted=true = bfcache restore on iOS Safari (where
  // visibilitychange may not fire). visibilityState gate keeps normal
  // navigation from triggering an extra bounce.
  const onPageShow = (e) => { if (e.persisted || document.visibilityState === 'visible') refreshAndBounce('pageshow'); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus',    () => refreshAndBounce('focus'));
  window.addEventListener('online',   () => refreshAndBounce('online'));
  window.addEventListener('pageshow', onPageShow);

  // Any token refresh (periodic from auto-refresh, or our forced one) →
  // push to realtime explicitly. supabase-js does this internally but
  // INITIAL_SESSION also fires here during boot — skip to avoid noise.
  try {
    supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session?.access_token) {
        try { supabase.realtime.setAuth(session.access_token); } catch (_) {}
      }
    });
  } catch (_) {}
}

// Exposed so per-channel watchdogs can request a refresh+bounce when
// they detect a dead socket (no inbound for 5 min while visible).
export async function bounceRealtime() {
  return refreshAndBounce('manual');
}
