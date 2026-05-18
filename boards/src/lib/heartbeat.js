// Platform-wide "total time in app" heartbeat.
//
// Calls the bump_seconds_in_app RPC every ~60s while the tab is
// VISIBLE. Pauses when the tab is hidden so background tabs don't
// inflate the counter. Partial windows around visibility toggles
// are credited proportionally.
//
// Anon-callable RPC, so this also fires on the landing page before
// the user signs in — "total time on the platform" really means
// total, not just authenticated time.

import { supabase } from './supabase.js';

const HEARTBEAT_MS = 60_000;
const MAX_TICK_SECONDS = 60;

let started = false;
let lastVisibleAt = 0;

function flush() {
  if (lastVisibleAt === 0 || !supabase) return;
  const elapsed = Math.min(MAX_TICK_SECONDS, Math.round((Date.now() - lastVisibleAt) / 1000));
  if (elapsed > 0) {
    supabase.rpc('bump_seconds_in_app', { p_seconds: elapsed }).then(() => {}, () => {});
  }
  lastVisibleAt = (typeof document !== 'undefined' && document.visibilityState === 'visible') ? Date.now() : 0;
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
