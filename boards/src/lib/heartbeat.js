// Platform-wide "total time in app" heartbeat.
//
// Calls the bump_seconds_in_app RPC every ~60s while the tab is
// VISIBLE. Pauses when the tab is hidden so background tabs don't
// inflate the counter. Partial windows around visibility toggles
// are credited proportionally. A stable session_id (UUID v4, persisted
// in localStorage) goes with every call so the server can enforce
// a per-session 60s/minute cap.
//
// Anon-callable RPC, so this also fires on the landing page before
// the user signs in — "total time on the platform" really means
// total, not just authenticated time.

import { supabase } from './supabase.js';

const HEARTBEAT_MS = 60_000;
const MAX_TICK_SECONDS = 60;
const SESSION_STORAGE_KEY = 'sb_heartbeat_session_id';

let started = false;
let lastVisibleAt = 0;
let sessionId = null;

function ensureSessionId() {
  if (sessionId) return sessionId;
  if (typeof localStorage === 'undefined') return null;
  try {
    let id = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : ('00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padStart(12, '0'));
      try { localStorage.setItem(SESSION_STORAGE_KEY, id); } catch (_) {}
    }
    sessionId = id;
    return id;
  } catch (_) {
    return null;
  }
}

async function flush() {
  if (lastVisibleAt === 0 || !supabase) return;
  const elapsed = Math.min(MAX_TICK_SECONDS, Math.round((Date.now() - lastVisibleAt) / 1000));
  lastVisibleAt = (typeof document !== 'undefined' && document.visibilityState === 'visible') ? Date.now() : 0;
  if (elapsed <= 0) return;
  const sid = ensureSessionId();
  // Pass user_id when signed in so the per-user seconds_in_app
  // column accumulates too (admin Users tab reads this).
  let uid = null;
  try {
    const { data } = await supabase.auth.getSession();
    uid = data?.session?.user?.id || null;
  } catch (_) {}
  try {
    await supabase.rpc('bump_seconds_in_app', { p_seconds: elapsed, p_session_id: sid, p_user_id: uid });
  } catch (_) { /* fire-and-forget */ }
}

export function startHeartbeat() {
  if (started || typeof document === 'undefined' || !supabase) return;
  started = true;

  lastVisibleAt = document.visibilityState === 'visible' ? Date.now() : 0;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      lastVisibleAt = Date.now();
    } else {
      flush();
    }
  });
  window.addEventListener('pagehide', flush);
  setInterval(flush, HEARTBEAT_MS);
}
