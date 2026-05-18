// analytics.js — minimal client-side event emitter for the admin
// Analytics dashboard.
//
//   import { logEvent } from '../lib/analytics.js';
//   logEvent('pricing_view', { surface: 'page' });
//
// • Generates a session UUID lazily and persists it in localStorage so
//   anon visitors are tracked across pageloads (and even after they sign
//   in, so we can stitch their pre-auth funnel to their account).
// • Reads the current auth user best-effort; null is fine.
// • Inserts directly into public.analytics_events via the existing
//   supabase client. RLS allows anon + authenticated INSERTs; reads are
//   admin-gated.
// • Fire-and-forget — wrapped in try/catch so a network blip never blocks
//   the UI call site.

import { supabase } from './supabase.js';

const SESSION_KEY = 'soleil_session_id';

function getSessionId() {
  if (typeof localStorage === 'undefined') return null;
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch (_) { return null; }
}

let cachedUserId = null;
let userIdResolved = false;
async function getCurrentUserId() {
  if (userIdResolved) return cachedUserId;
  try {
    const { data } = await supabase.auth.getSession();
    cachedUserId = data?.session?.user?.id ?? null;
  } catch (_) { cachedUserId = null; }
  userIdResolved = true;
  return cachedUserId;
}

// Keep cachedUserId in sync with sign-in / sign-out so we don't keep
// attributing post-signin events to null.
if (supabase) {
  try {
    supabase.auth.onAuthStateChange((_event, session) => {
      cachedUserId = session?.user?.id ?? null;
      userIdResolved = true;
    });
  } catch (_) {}
}

export async function logEvent(name, props = {}) {
  if (!supabase || !name) return;
  try {
    const userId = await getCurrentUserId();
    await supabase.from('analytics_events').insert({
      session_id: getSessionId(),
      user_id:    userId,
      event:      name,
      props:      props && typeof props === 'object' ? props : {},
      path:       typeof window !== 'undefined' ? window.location.pathname : null,
    });
  } catch (_) {
    // Analytics never throws into the UI.
  }
}
