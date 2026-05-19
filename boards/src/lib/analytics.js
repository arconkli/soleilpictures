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

const SESSION_KEY  = 'soleil_session_id';
const SOURCE_KEY   = 'soleil_first_source';   // sessionStorage — first-touch acquisition

// First-touch acquisition: read UTM params + referrer once on the
// very first call this session, stash in sessionStorage, then merge
// into every event's props for the lifetime of the session. Stashed
// in SESSION storage (not localStorage) so it doesn't follow the
// user forever — first-touch resets when they open a new browser.
let cachedSource = null;
function getFirstSource() {
  if (cachedSource !== null) return cachedSource;
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    cachedSource = {};
    return cachedSource;
  }
  try {
    const cached = sessionStorage.getItem(SOURCE_KEY);
    if (cached) { cachedSource = JSON.parse(cached); return cachedSource; }
    const params = new URLSearchParams(window.location.search);
    const source = {};
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const v = params.get(k);
      if (v) source[k] = v.slice(0, 120);  // trim absurdly long values
    }
    if (document?.referrer) {
      try {
        const ref = new URL(document.referrer);
        // Only capture external referrers — internal navigation is noise.
        if (ref.hostname && ref.hostname !== window.location.hostname) {
          source.referrer = ref.hostname;
        }
      } catch (_) {}
    }
    sessionStorage.setItem(SOURCE_KEY, JSON.stringify(source));
    cachedSource = source;
  } catch (_) { cachedSource = {}; }
  return cachedSource;
}

// Stamp the caller's profile.first_source the first time they
// authenticate (server-side first-touch wins). One-shot per
// auth-state-change → 'SIGNED_IN'.
let firstSourceStamped = false;
async function stampFirstSourceIfNeeded() {
  if (firstSourceStamped || !supabase) return;
  const src = getFirstSource();
  if (!src || Object.keys(src).length === 0) { firstSourceStamped = true; return; }
  const { data } = await supabase.auth.getSession();
  if (!data?.session?.user?.id) return;
  try { await supabase.rpc('set_first_source', { p_source: src }); } catch (_) {}
  firstSourceStamped = true;
}

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
// attributing post-signin events to null. Also stamps the first-touch
// acquisition source onto profiles the first time a user signs in.
if (supabase) {
  try {
    supabase.auth.onAuthStateChange((_event, session) => {
      cachedUserId = session?.user?.id ?? null;
      userIdResolved = true;
      if (session?.user?.id) stampFirstSourceIfNeeded();
    });
  } catch (_) {}
}

export async function logEvent(name, props = {}) {
  if (!supabase || !name) return;
  try {
    const userId = await getCurrentUserId();
    const source = getFirstSource();
    const merged = (props && typeof props === 'object') ? { ...props } : {};
    // Merge first-touch source into every event's props. Cheap and
    // makes funnel queries trivial ("what % of pricing_view came from
    // utm_source=reddit").
    for (const k in source) if (merged[k] === undefined) merged[k] = source[k];
    await supabase.from('analytics_events').insert({
      session_id: getSessionId(),
      user_id:    userId,
      event:      name,
      props:      merged,
      path:       typeof window !== 'undefined' ? window.location.pathname : null,
    });
  } catch (_) {
    // Analytics never throws into the UI.
  }
}
