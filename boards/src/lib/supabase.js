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
