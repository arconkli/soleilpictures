// Supabase client singleton.
// If env vars are missing we return null so the rest of the app can fall back
// to local-only dev mode instead of crashing — this keeps Phase 0 prototypes
// working before the user has provisioned a Supabase project.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
// Prefer the modern publishable key; fall back to legacy anon JWT.
const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
              || import.meta.env.VITE_SUPABASE_ANON_KEY;

// Round 22 — fix `AbortError: Lock broken by another request with the
// 'steal' option` cascading failure. Supabase's default auth lock uses
// navigator.locks with a hardcoded 5-second timeout — after 5s of waiting,
// the next request "steals" the lock, which aborts the original holder
// AND every other waiter. With our app's auth load on board open (board
// snapshot + workspaces + shared-boards + tags + conversations +
// members + share-notif + mention-notif + comments + restoreSignal
// + alert-banner all needing auth roughly simultaneously), 5 seconds was
// too tight and triggered a total cascade failure that prevented
// `loadBoardSnapshot` from succeeding — which is the actual reason
// thumbnails were blank in Round 21 (no card data → nothing to render).
//
// This is a simple in-memory FIFO lock that preserves the original
// invariant (one op per name at a time) without an artificial timeout.
// Multi-tab token-refresh coordination is given up; in practice that's
// fine because Supabase's token endpoints are idempotent (two tabs
// refreshing simultaneously each succeed; the worse outcome is one
// wasted network call, not data corruption).
function createSerialLock() {
  const tails = new Map(); // name -> Promise (the "settled" tail for this name)
  return async (name, _ignoredAcquireTimeout, fn) => {
    const prev = tails.get(name) || Promise.resolve();
    const current = prev.catch(() => undefined).then(fn);
    // Store a settled-shape promise so chaining never sees a rejection.
    const sink = current.catch(() => undefined);
    tails.set(name, sink);
    try {
      return await current;
    } finally {
      // Only clear if we're still the tail — otherwise another op queued
      // behind us and will manage cleanup when it finishes.
      if (tails.get(name) === sink) tails.delete(name);
    }
  };
}

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
        // Round 22: see createSerialLock comment above.
        lock: createSerialLock(),
        ...(altSessionId ? { storage: makeNamespacedStorage(altSessionId), storageKey: `sb-auth-as-${altSessionId}` } : {}),
      },
      realtime: {
        // Defaults `disconnectOnEmptyChannelsAfterMs` to 2x heartbeat = 50s,
        // and any transient drop in channels.length to 0 fires a socket-
        // wide disconnect at exactly that mark. We always have channels
        // mid-session; effectively disable so a brief empty window doesn't
        // kill collab. (Set to 24h instead of 0 — 0 means "disconnect
        // immediately when empty," the opposite of what we want.)
        disconnectOnEmptyChannelsAfterMs: 24 * 60 * 60 * 1000,
        // 15s heartbeat (was 25s default). Sends pings sooner and
        // detects/recovers genuine deaths in ~30s instead of ~50s.
        heartbeatIntervalMs: 15000,
        // Run heartbeat in a Web Worker so background-tab setTimeout
        // throttling can't break it.
        worker: true,
      },
    })
  : null;

export const isSupabaseConfigured = !!supabase;

// ── Realtime wake handling ─────────────────────────────────────────────
// Two layers of recovery:
//
// 1) Wake events (visibility/focus/online/pageshow) → refresh + setAuth ONLY.
//    Don't touch the transport. Phoenix channels stay JOINED, the new token
//    is pushed to them via realtime-js's `access_token` event, and the
//    socket's heartbeat (30s default) detects any genuine death and
//    auto-reconnects on its own. Aggressively bouncing the transport on
//    every wake event was causing rejoin pushes to time out, which made
//    Phoenix channels go to `closed` state — once that happens the channel
//    is REMOVED from the socket (channel.js:70 → socket.remove(this)) and
//    no future rejoin is possible, killing collab permanently.
//
// 2) Watchdog-detected dead socket (no inbound for 5 min while visible) →
//    full transport bounce as a last resort. This is rare and only fires
//    when something is truly wrong; the channel-thrash risk is acceptable
//    when the alternative is staying dead forever.

const REFRESH_THROTTLE_MS = 1000;
let refreshPromise = null;
let lastRefreshAt = 0;

async function refreshAndSetAuth(_reason) {
  if (!supabase) return;
  if (refreshPromise) return refreshPromise;
  if (Date.now() - lastRefreshAt < REFRESH_THROTTLE_MS) return;

  refreshPromise = (async () => {
    try {
      let token = null;
      try {
        const { data, error } = await supabase.auth.refreshSession();
        if (error) console.warn('[realtime] refreshSession failed', error.message);
        token = data?.session?.access_token ?? null;
      } catch (e) { console.warn('[realtime] refreshSession threw', e); }

      if (token) {
        // setAuth on a connected client pushes an `access_token` event
        // to every joined channel — server accepts the new JWT without
        // any reconnect. On a disconnected client it just caches the
        // token for the next connect.
        try { supabase.realtime.setAuth(token); } catch (e) { console.warn('[realtime] setAuth failed', e); }
      }
      lastRefreshAt = Date.now();
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

if (supabase && typeof document !== 'undefined') {
  const onVisibility = () => { if (document.visibilityState === 'visible') refreshAndSetAuth('visibility'); };
  const onPageShow = (e) => { if (e.persisted || document.visibilityState === 'visible') refreshAndSetAuth('pageshow'); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus',    () => refreshAndSetAuth('focus'));
  window.addEventListener('online',   () => refreshAndSetAuth('online'));
  window.addEventListener('pageshow', onPageShow);

  // Belt-and-suspenders: any token refresh (auto or manual) → push to
  // realtime. supabase-js does this internally on TOKEN_REFRESHED;
  // explicit avoids races. Skip INITIAL_SESSION (boot noise).
  try {
    supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session?.access_token) {
        try { supabase.realtime.setAuth(session.access_token); } catch (_) {}
      }
    });
  } catch (_) {}

  // Diagnostic: log socket lifecycle so we can correlate channel CLOSED
  // events with transport-level activity. The hooks live on
  // realtime.socketAdapter, not realtime itself in v2.105.
  try {
    const sa = supabase.realtime.socketAdapter;
    sa?.onOpen?.(() => console.log('[realtime] SOCKET open'));
    sa?.onClose?.((e) => console.log('[realtime] SOCKET close', e?.code, e?.reason || ''));
    sa?.onError?.((e) => console.log('[realtime] SOCKET error', e?.message || e));
  } catch (_) {}

  // Diagnostic: warn if we ever see channels.length === 0 — the
  // empty-channels auto-disconnect arms 50s after this happens (with
  // default config; we override it to 24h above as a safety net).
  setInterval(() => {
    const n = supabase.realtime?.channels?.length ?? -1;
    if (n === 0) console.log('[realtime] CHANNELS EMPTY (auto-disconnect would arm with default config)');
  }, 10000);
}

// Exposed for the per-channel watchdogs (5-min no-inbound guard) — true
// last resort. Refreshes auth, then bounces the transport so every
// channel re-handshakes via Phoenix. WILL cause the CHANNEL_ERROR →
// rejoin cycle, accept that risk only when the socket is genuinely dead.
let bouncePromise = null;
export async function bounceRealtime() {
  if (!supabase) return;
  if (bouncePromise) return bouncePromise;
  bouncePromise = (async () => {
    try {
      await refreshAndSetAuth('bounce');
      try { await supabase.realtime.disconnect(); } catch (e) { console.warn('[realtime] disconnect failed', e); }
      try { supabase.realtime.connect(); } catch (e) { console.warn('[realtime] connect failed', e); }
    } finally {
      bouncePromise = null;
    }
  })();
  return bouncePromise;
}
