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
import { setErrorUser } from './errorReporting.js';

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
let cachedAccessToken = null;   // kept fresh for the keepalive-fetch beacon's Bearer header
let userIdResolved = false;
async function getCurrentUserId() {
  if (userIdResolved) return cachedUserId;
  try {
    const { data } = await supabase.auth.getSession();
    cachedUserId = data?.session?.user?.id ?? null;
    cachedAccessToken = data?.session?.access_token ?? null;
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
      cachedAccessToken = session?.access_token ?? null;
      userIdResolved = true;
      // Attribute first-party error logs to the signed-in user by id (no PII).
      setErrorUser(cachedUserId);
      if (session?.user?.id) stampFirstSourceIfNeeded();
    });
  } catch (_) {}
}

// ── Batched, redirect-safe delivery ────────────────────────────────────
// Maximal instrumentation means many small events (scroll/field/dwell), and
// some fire microseconds before a navigation. One insert-per-event would flood
// the table and lose redirect-adjacent events. So we coalesce into a queue that
// flushes (a) on a 5s interval via a supabase-js ARRAY insert while the page is
// alive, and (b) on tab-hide/unload via a keepalive-fetch BEACON that survives
// navigation. logEvent() keeps its old signature (now enqueues instead of
// inserting), so all existing call sites are unchanged.

const REST_URL   = (import.meta.env.VITE_SUPABASE_URL || '') + '/rest/v1/analytics_events';
const PUBLIC_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
                || import.meta.env.VITE_SUPABASE_ANON_KEY;
const FLUSH_INTERVAL_MS = 5000;
const MAX_QUEUE = 100;   // hard cap — drop oldest beyond this (never grow unbounded)
const MAX_BATCH = 50;    // rows per array insert

let queue = [];
let flushTimer = null;

function buildRow(name, props) {
  const source = getFirstSource();
  const merged = (props && typeof props === 'object') ? { ...props } : {};
  // First-touch source merged into every event so funnel queries are trivial
  // ("what % of pricing_view came from utm_source=reddit").
  for (const k in source) if (merged[k] === undefined) merged[k] = source[k];
  return {
    session_id:  getSessionId(),
    user_id:     cachedUserId,   // best-effort; backfilled at flush if it resolves late
    event:       name,
    props:       merged,
    path:        typeof window !== 'undefined' ? window.location.pathname : null,
    // Client-stamped so a batched/beaconed row keeps its TRUE event time (the
    // column defaults to now() = insert time, which can be seconds later).
    occurred_at: new Date().toISOString(),
  };
}

function enqueue(row) {
  queue.push(row);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);  // drop oldest
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

async function flush() {
  flushTimer = null;
  if (!supabase || queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  if (cachedUserId) for (const r of batch) if (r.user_id == null) r.user_id = cachedUserId;
  try {
    await supabase.from('analytics_events').insert(batch);   // one round-trip per batch
  } catch (_) {
    // Re-queue (front) on failure, capped — a blip shouldn't lose data, but
    // volume safety wins over completeness. Never throws into the UI.
    queue = [...batch, ...queue].slice(0, MAX_QUEUE);
  }
  if (queue.length > 0 && !flushTimer) flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

// Unload/redirect-safe flush. keepalive fetch survives navigation AND can set
// the apikey/authorization headers PostgREST needs; sendBeacon (header-less,
// ?apikey= in the URL, anon-only) is the last-ditch fallback.
function flushBeacon() {
  if (!supabase || queue.length === 0) return;
  const batch = queue.splice(0, MAX_QUEUE);
  if (cachedUserId) for (const r of batch) if (r.user_id == null) r.user_id = cachedUserId;
  const body = JSON.stringify(batch);   // PostgREST bulk-inserts a JSON array
  try {
    fetch(REST_URL, {
      method: 'POST',
      keepalive: true,
      headers: {
        apikey: PUBLIC_KEY,
        ...(cachedAccessToken ? { authorization: `Bearer ${cachedAccessToken}` } : {}),
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body,
    }).catch(() => {});
  } catch (_) {
    try {
      navigator.sendBeacon(
        `${REST_URL}?apikey=${encodeURIComponent(PUBLIC_KEY)}`,
        new Blob([body], { type: 'application/json' }),
      );
    } catch (_) {}
  }
}

// Unchanged signature — now enqueues. Never throws into the UI.
export function logEvent(name, props = {}) {
  if (!supabase || !name) return;
  try { enqueue(buildRow(name, props)); } catch (_) {}
}

// Fire once per page-load for a given key — StrictMode-safe view/once events.
const _onceFired = new Set();
export function logEventOnce(key, name, props = {}) {
  if (!key || _onceFired.has(key)) return;
  _onceFired.add(key);
  logEvent(name, props);
}

// Must-land-before-redirect: enqueue + beacon the queue NOW. Use immediately
// before window.location.assign(...). The keepalive flag means the request
// survives the navigation even though we don't await it.
export function logEventNow(name, props = {}) {
  if (!supabase || !name) return;
  try { enqueue(buildRow(name, props)); flushBeacon(); } catch (_) {}
}

// Manual flush escape hatch (tests / explicit teardown).
export function flushNow() { try { flushBeacon(); } catch (_) {} }

// Beacon the queue when the page is hidden or unloading. visibilitychange→hidden
// is the reliable mobile signal; pagehide/beforeunload back it up on desktop.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushBeacon();
  });
  window.addEventListener('pagehide', flushBeacon);
  window.addEventListener('beforeunload', flushBeacon);
}

// Prime the user-id / access-token cache so early (pre-interaction) events
// attribute to the signed-in user instead of waiting for the first flush.
if (supabase) { try { getCurrentUserId(); } catch (_) {} }
