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
// realtime-js's cached state still says "connected." Both `realtime.connect()`
// and `channel.subscribe()` short-circuit on that cache, so a normal
// "reconnect" call is a silent no-op. Force the transport to disconnect
// (which moves the client to `disconnected`), then connect, so all
// channels re-handshake via their normal Phoenix join cycle. One listener
// for the whole app — every channel benefits.
if (supabase && typeof document !== 'undefined') {
  let resetTimer = null;
  const bounceTransport = () => {
    if (resetTimer) return;        // throttle bursts of wake events
    resetTimer = setTimeout(() => {
      resetTimer = null;
      try {
        supabase.realtime.disconnect();
        supabase.realtime.connect();
      } catch (e) { console.warn('[realtime] transport bounce failed', e); }
    }, 80);
  };
  const onVisibility = () => { if (document.visibilityState === 'visible') bounceTransport(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus',  bounceTransport);
  window.addEventListener('online', bounceTransport);
}

// Exposed so per-channel watchdogs can request a transport bounce when
// they detect a dead socket (no inbound 20s while visible).
export function bounceRealtime() {
  if (!supabase) return;
  try {
    supabase.realtime.disconnect();
    supabase.realtime.connect();
  } catch (e) { console.warn('[realtime] bounceRealtime failed', e); }
}
