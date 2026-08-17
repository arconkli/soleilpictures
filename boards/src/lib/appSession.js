// appSession.js — a session is a stretch of use, not a browser.
//
// The original `soleil_session_id` (analytics.js) is a UUID minted once into
// localStorage and never rotated: no TTL, no idle window, no rotation on
// sign-in. Measured against 90 days of production data its p50 span is 13
// seconds — correct for a one-and-done visitor — but its max span is 81 days
// and 69 of them run past a week. In other words the "sessions" it gets wrong
// are exactly the returning users worth studying, and every
// `count(distinct session_id)` in the RPC layer is really a browser count.
//
// That id is deliberately left alone: it is the stitch that joins a visitor's
// pre-auth funnel to their account, and 90 days of history depend on its
// meaning. It is a DEVICE id and this module supplies the missing sibling —
// an app session that starts, ends, and can be counted.
//
// A session rotates when any of these is true:
//   • more than IDLE_ROTATE_MS has passed since the last recorded activity
//   • the UTC day changed (so "sessions per day" needs no windowing)
//   • the user signed in or signed out (identity changed → new session)
//
// `seq` is a per-browser monotonic counter, so a row can say "this was their
// 1st session" or "their 12th" without a self-join.
//
// The decision is a pure function (`decideSession`) over the stored record, so
// idle/day-boundary/auth rotation is unit-testable without faking timers or
// localStorage — the same split `interactionClassify.js` uses.

const STORE_KEY = 'soleil_app_session';

export const IDLE_ROTATE_MS = 30 * 60 * 1000;   // 30 min of no activity ends a session
const PERSIST_THROTTLE_MS = 10_000;             // don't touch localStorage on every event

function mintId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch (_) { /* fall through */ }
  // Same shape as the analytics fallback: a v4-looking uuid PostgREST accepts.
  const hex = () => Math.random().toString(16).slice(2, 14).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex()}`;
}

// UTC day number. UTC (not local) because every retention RPC groups on
// current_date server-side, and a local-midnight rotation would put a session
// on a different day than the rows it produced.
export function utcDay(now) {
  return Math.floor(now / 86_400_000);
}

/**
 * Pure rotation decision.
 *
 * @param prev  the stored record, or null/garbage on first run
 * @param now   epoch ms
 * @param opts  { authChanged?: boolean, mint?: () => string, idleMs?: number }
 * @returns { id, startedAt, lastSeenAt, seq, day, rotated, reason }
 */
export function decideSession(prev, now, opts = {}) {
  const mint = opts.mint || mintId;
  const idleMs = opts.idleMs == null ? IDLE_ROTATE_MS : opts.idleMs;
  const valid = prev
    && typeof prev.id === 'string' && prev.id
    && Number.isFinite(prev.lastSeenAt)
    && Number.isFinite(prev.seq);

  let reason = null;
  if (!valid) reason = 'new';
  else if (opts.authChanged) reason = 'auth';
  else if (now - prev.lastSeenAt > idleMs) reason = 'idle';
  else if (utcDay(now) !== prev.day) reason = 'day';

  // A clock that jumped backwards (NTP correction, a laptop waking with a stale
  // clock) must not be read as "no time has passed forever" — but it also must
  // not rotate, or a resumed laptop starts a phantom session. Just clamp.
  if (!reason) {
    return {
      ...prev,
      lastSeenAt: Math.max(prev.lastSeenAt, now),
      rotated: false,
      reason: null,
    };
  }

  return {
    id: mint(),
    startedAt: now,
    lastSeenAt: now,
    seq: valid ? prev.seq + 1 : 1,
    day: utcDay(now),
    rotated: true,
    reason,
  };
}

// ── Stateful wrapper ───────────────────────────────────────────────────
// In-memory is authoritative; localStorage is a durability mirror written on
// rotation and at most once per PERSIST_THROTTLE_MS. touch() runs on every
// event, so it must stay cheap.

let current = null;
let lastPersistAt = 0;
let onRotate = null;

function readStored() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function persist(rec) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORE_KEY, JSON.stringify({
      id: rec.id, startedAt: rec.startedAt, lastSeenAt: rec.lastSeenAt, seq: rec.seq, day: rec.day,
    }));
    lastPersistAt = rec.lastSeenAt;
  } catch (_) { /* private mode / quota — in-memory still works */ }
}

/**
 * Advance the session clock and return the live session. Call on every event.
 * `authChanged` forces a rotation (sign-in / sign-out).
 */
export function touchAppSession({ authChanged = false, now = Date.now() } = {}) {
  const prev = current || readStored();
  const next = decideSession(prev, now, { authChanged });
  current = next;
  if (next.rotated) {
    persist(next);
    if (onRotate) { try { onRotate(next); } catch (_) {} }
  } else if (next.lastSeenAt - lastPersistAt > PERSIST_THROTTLE_MS) {
    persist(next);
  }
  return next;
}

/** The live session without advancing the clock past an idle boundary. */
export function getAppSession() {
  return current || touchAppSession();
}

export function getAppSessionId() { return getAppSession().id; }
export function getAppSessionSeq() { return getAppSession().seq; }

/** Sign-in / sign-out changes identity, which ends the session. */
export function noteAuthChange() { return touchAppSession({ authChanged: true }); }

/** Notified on every rotation — used to close out usage slices for the old session. */
export function setSessionRotateHandler(fn) { onRotate = typeof fn === 'function' ? fn : null; }

/** Flush the in-memory record to storage (pagehide). */
export function persistAppSession() { if (current) persist(current); }

/** Test seam — reset module state between cases. */
export function __resetAppSessionForTest() { current = null; lastPersistAt = 0; onRotate = null; }
