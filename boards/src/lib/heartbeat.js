// Platform-wide "active time in app" heartbeat.
//
// Credits time only while the user is ACTIVELY using the app — visible tab AND
// a real interaction (pointer / key / scroll / touch) within the idle window.
// Leaving a tab open but walking away no longer inflates the counter: after
// IDLE_MS with no interaction the clock pauses, and resumes on the next input.
//
// Mechanics: a lightweight sampler accumulates active milliseconds in slices;
// flush() converts them to whole seconds and calls bump_seconds_in_app on a
// cadence. A stable session_id (UUID v4 in localStorage) lets the server cap
// each session to 60s per 60s window. On tab close we can't await an async RPC,
// so we fire a keepalive fetch (sendBeacon can't set the apikey header).
//
// Anon-callable RPC, so this also fires on the landing page before sign-in —
// "total time on the platform" really means total, not just authenticated time;
// the per-user seconds_in_app column only accrues when a user_id is present.

import { supabase } from './supabase.js';

const SAMPLE_MS = 5_000;            // accumulate active time in ~5s slices
const FLUSH_MS = 60_000;            // send accumulated seconds ~once a minute
const IDLE_MS = 60_000;            // no interaction for this long → idle (no credit)
const MAX_SLICE_MS = SAMPLE_MS * 3; // cap a slice so a throttled timer can't over-credit
const ACTIVITY_THROTTLE_MS = 1_000; // updating lastActivityAt at most ~1/s is plenty
const SESSION_STORAGE_KEY = 'sb_heartbeat_session_id';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const PUBLIC_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
                || import.meta.env.VITE_SUPABASE_ANON_KEY;

let started = false;
let sessionId = null;
let lastActivityAt = 0;   // ms — last real interaction
let lastSampleAt = 0;     // ms — last sampler tick
let activeMs = 0;         // accumulated, not-yet-flushed active milliseconds
let lastActivityWrite = 0;// throttle guard for the activity listeners
let cachedToken = null;   // most recent access token (for the unload keepalive flush)
let cachedUid = null;     // most recent user id

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

function markActivity() {
  const now = Date.now();
  if (now - lastActivityWrite < ACTIVITY_THROTTLE_MS) return;
  lastActivityWrite = now;
  lastActivityAt = now;
}

// Fold the elapsed slice into the accumulator — but only the portion during
// which the tab was visible AND the user was active (interaction within IDLE_MS).
function sample() {
  const now = Date.now();
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
    lastSampleAt = now;            // hidden: credit nothing, don't bank the gap
    return;
  }
  const delta = Math.min(now - lastSampleAt, MAX_SLICE_MS);
  lastSampleAt = now;
  if (delta > 0 && (now - lastActivityAt) <= IDLE_MS) {
    activeMs += delta;
  }
}

async function refreshAuth() {
  try {
    const { data } = await supabase.auth.getSession();
    cachedToken = data?.session?.access_token || null;
    cachedUid = data?.session?.user?.id || null;
  } catch (_) { /* keep last cached */ }
}

// Normal cadence + visibility-hidden: async RPC (the page is still alive).
async function flush() {
  if (!supabase) return;
  sample();
  const secs = Math.floor(activeMs / 1000);
  await refreshAuth();
  if (secs <= 0) return;
  activeMs -= secs * 1000;         // keep the sub-second remainder
  const sid = ensureSessionId();
  try {
    await supabase.rpc('bump_seconds_in_app', { p_seconds: secs, p_session_id: sid, p_user_id: cachedUid });
  } catch (_) { /* fire-and-forget */ }
}

// Tab close: can't await — use a keepalive fetch with the cached creds so the
// final active seconds aren't lost. sendBeacon can't set the apikey header.
function flushBeacon() {
  sample();
  const secs = Math.floor(activeMs / 1000);
  if (secs <= 0 || !SUPABASE_URL || !PUBLIC_KEY) return;
  activeMs = 0;
  const sid = ensureSessionId();
  try {
    fetch(`${SUPABASE_URL}/rest/v1/rpc/bump_seconds_in_app`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLIC_KEY,
        Authorization: `Bearer ${cachedToken || PUBLIC_KEY}`,
      },
      body: JSON.stringify({ p_seconds: secs, p_session_id: sid, p_user_id: cachedUid }),
    }).catch(() => {});
  } catch (_) { /* best effort */ }
}

export function startHeartbeat() {
  if (started || typeof document === 'undefined' || !supabase) return;
  started = true;

  const now = Date.now();
  lastActivityAt = now;            // assume active on load
  lastSampleAt = now;
  refreshAuth();                   // prime the cached token for an early close

  const opts = { passive: true };
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll', 'touchstart']) {
    window.addEventListener(ev, markActivity, opts);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Returning to the tab counts as activity; don't bank the away gap.
      lastSampleAt = Date.now();
      lastActivityAt = Date.now();
    } else {
      flush();
    }
  });
  window.addEventListener('pagehide', flushBeacon);

  setInterval(sample, SAMPLE_MS);
  setInterval(flush, FLUSH_MS);
}
