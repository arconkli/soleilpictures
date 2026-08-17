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
import { getAppSessionId } from './appSession.js';
import { getAnalyticsContext } from './analytics.js';
import { takeWorkOps } from './workSignal.js';

const SAMPLE_MS = 5_000;            // accumulate active time in ~5s slices
const FLUSH_MS = 60_000;            // send accumulated seconds ~once a minute
const IDLE_MS = 60_000;            // no interaction for this long → idle (no credit)
const MAX_SLICE_MS = SAMPLE_MS * 3; // cap a slice so a throttled timer can't over-credit
const ACTIVITY_THROTTLE_MS = 1_000; // updating lastActivityAt at most ~1/s is plenty

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const PUBLIC_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
                || import.meta.env.VITE_SUPABASE_ANON_KEY;

let started = false;
let lastActivityAt = 0;   // ms — last real interaction
let lastSampleAt = 0;     // ms — last sampler tick
let activeMs = 0;         // accumulated, not-yet-flushed active milliseconds
let lastActivityWrite = 0;// throttle guard for the activity listeners
let cachedToken = null;   // most recent access token (for the unload keepalive flush)
let cachedUid = null;     // most recent user id

// The heartbeat used to mint its OWN never-rotating id
// ('sb_heartbeat_session_id'), unrelated to the one analytics_events carried.
// That meant time-in-app and events could not be joined: neither id identified
// a session, and they weren't even the same id. Both now come from
// appSession.js, so "this session lasted 12 minutes and produced these events"
// is a single query.
//
// A rotation also resets the server's 60s-per-60s rate window, which is right:
// a new session should get its own budget, and the cap was never a security
// boundary — a client could always mint a fresh uuid.
function ensureSessionId() {
  try { return getAppSessionId(); } catch (_) { return null; }
}

function markActivity() {
  const now = Date.now();
  if (now - lastActivityWrite < ACTIVITY_THROTTLE_MS) return;
  lastActivityWrite = now;
  lastActivityAt = now;
}

// Fold the elapsed slice into the accumulator — but only the portion during
// which the tab was visible AND the user was active (interaction within IDLE_MS).
//
// The same slice is also banked against the surface that was on screen FOR it.
// Attributing a whole minute to whichever surface happened to be open at flush
// time would silently mis-credit every navigation, and someone who moves
// between the canvas and the universe view every few seconds is exactly the
// engaged user the per-surface numbers exist to describe.
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
    bankSurface(delta);
  }
}

// active ms per "<surface>|<boardId>" since the last flush.
const bySurface = new Map();

function bankSurface(deltaMs) {
  let surface = null;
  let boardId = null;
  try {
    const ctx = getAnalyticsContext();
    surface = ctx.surface || null;
    boardId = ctx.board_id || null;
  } catch (_) { return; }
  // No surface yet (pre-mount) or a public page: not app usage. Public time is
  // the landing funnel's to measure, and lp_dwell already does.
  if (!surface || surface === 'public') return;
  const key = `${surface}|${boardId || ''}`;
  bySurface.set(key, (bySurface.get(key) || 0) + deltaMs);
}

// Drain whole seconds per surface, keeping sub-second remainders so a long
// session doesn't shed a fraction on every flush.
function drainSurfaceSlices() {
  const out = [];
  for (const [key, ms] of bySurface) {
    const secs = Math.floor(ms / 1000);
    if (secs <= 0) continue;
    bySurface.set(key, ms - secs * 1000);
    const sep = key.indexOf('|');
    out.push({ surface: key.slice(0, sep), boardId: key.slice(sep + 1) || null, secs });
  }
  return out;
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

  // Taken only now that we know we're sending: a flush that returns early must
  // not consume the evidence that this day contained work at all.
  const ops = takeWorkOps();

  try {
    await supabase.rpc('bump_seconds_in_app', {
      p_seconds: secs, p_session_id: sid, p_user_id: cachedUid,
      p_did_work: ops > 0,
    });
  } catch (_) { /* fire-and-forget */ }

  // Dimensional slices are signed-in only — record_usage_slice no-ops for anon,
  // so sending them would be pure noise.
  if (!cachedUid) { bySurface.clear(); return; }
  const slices = drainSurfaceSlices();
  // Work ops are attributed to the surface with the most time this window. It's
  // an approximation, and labelled as one: the exact per-op surface would mean
  // instrumenting every mutation site, and the ranking is what gets read.
  let busiest = 0;
  for (let i = 1; i < slices.length; i++) if (slices[i].secs > slices[busiest].secs) busiest = i;
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    try {
      await supabase.rpc('record_usage_slice', {
        p_app_session_id: sid, p_surface: s.surface, p_seconds: s.secs,
        p_board_id: s.boardId, p_ops: i === busiest ? ops : 0,
      });
    } catch (_) { /* fire-and-forget */ }
  }
}

// Tab close: can't await — use a keepalive fetch with the cached creds so the
// final active seconds aren't lost. sendBeacon can't set the apikey header.
function rpcBeacon(fn, body) {
  try {
    fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLIC_KEY,
        Authorization: `Bearer ${cachedToken || PUBLIC_KEY}`,
      },
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch (_) { /* best effort */ }
}

function flushBeacon() {
  sample();
  const secs = Math.floor(activeMs / 1000);
  if (secs <= 0 || !SUPABASE_URL || !PUBLIC_KEY) return;
  activeMs = 0;
  const sid = ensureSessionId();
  const ops = takeWorkOps();
  rpcBeacon('bump_seconds_in_app', {
    p_seconds: secs, p_session_id: sid, p_user_id: cachedUid, p_did_work: ops > 0,
  });
  if (!cachedUid) { bySurface.clear(); return; }
  const slices = drainSurfaceSlices();
  let busiest = 0;
  for (let i = 1; i < slices.length; i++) if (slices[i].secs > slices[busiest].secs) busiest = i;
  slices.forEach((s, i) => rpcBeacon('record_usage_slice', {
    p_app_session_id: sid, p_surface: s.surface, p_seconds: s.secs,
    p_board_id: s.boardId, p_ops: i === busiest ? ops : 0,
  }));
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
