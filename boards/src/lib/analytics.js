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
import { getDeviceInfo } from './device.js';

const SESSION_KEY     = 'soleil_session_id';
const SOURCE_KEY      = 'soleil_first_source';   // sessionStorage — first-touch acquisition
const LAST_SOURCE_KEY = 'soleil_last_source';    // localStorage  — last-touch (latest click)

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

// Paid/ad click identifiers, one per ad network. Captured alongside utm_* so the
// SQL channel normalizer (public.derive_acquisition_channel) can brand each
// signup by the network that referred it. KEEP IN SYNC with that function's
// precedence ladder — adding a key here without teaching the SQL means the signal
// is stored but never branded.
const CLICK_ID_KEYS = [
  'gclid', 'wbraid', 'gbraid',   // Google Ads (incl. iOS privacy variants)
  'msclkid',                     // Microsoft / Bing Ads
  'ttclid',                      // TikTok
  'rdt_cid', 'rdt_uuid',         // Reddit
  'twclid',                      // X / Twitter
  'li_fat_id',                   // LinkedIn
  'epik',                        // Pinterest
  'sccid',                       // Snapchat
];

// Pull the campaign signals present in a URL's query string: utm_* + every ad
// click-id we recognize, plus the share/public deep-link params the public-page
// CTAs append (so a "open in new tab" still attributes — sessionStorage can't
// survive that, the URL can). Shared by first-touch capture + last-touch refresh.
function readUrlCampaignSignals(params) {
  const out = {};
  for (const k of UTM_KEYS)      { const v = params.get(k); if (v) out[k] = v.slice(0, 120); }
  for (const k of CLICK_ID_KEYS) { const v = params.get(k); if (v) out[k] = v.slice(0, 200); }
  const shareToken = params.get('share_token');
  if (shareToken) out.share_token = shareToken.slice(0, 40);
  const publicSlug = params.get('public_slug');
  if (publicSlug) out.public_slug = publicSlug.slice(0, 80);
  return out;
}

// External referrer as host + path (query/hash dropped to bound length + PII)
// plus the bare host for cheap brand-matching in SQL. Returns {} for internal or
// missing referrers — internal navigation is not an acquisition channel.
function readReferrer() {
  const out = {};
  try {
    if (!document?.referrer) return out;
    const ref = new URL(document.referrer);
    if (ref.hostname && ref.hostname !== window.location.hostname) {
      out.referrer      = (ref.hostname + ref.pathname).slice(0, 200);
      out.referrer_host = ref.hostname.slice(0, 120);
    }
  } catch (_) {}
  return out;
}

// First-touch acquisition: read UTM params + click-ids + referrer once on the
// very first call this session, stash in sessionStorage, then merge into every
// event's props for the lifetime of the session. Stashed in SESSION storage (not
// localStorage) so it doesn't follow the user forever — first-touch resets when
// they open a new browser. The server backstop (signup-trigger) covers the
// cross-device magic-link case where sessionStorage can't follow them.
let cachedSource = null;
export function getFirstSource() {
  if (cachedSource !== null) return cachedSource;
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') {
    cachedSource = {};
    return cachedSource;
  }
  try {
    const cached = sessionStorage.getItem(SOURCE_KEY);
    if (cached) { cachedSource = JSON.parse(cached); return cachedSource; }
    const params = new URLSearchParams(window.location.search);
    const source = { ...readUrlCampaignSignals(params), ...readReferrer() };
    // First-touch fbclid: ONLY one actually present in the landing URL. The
    // persisted _fbc fallback is LAST-touch (latest ad click) and would
    // contaminate first-touch, so it's routed to the last-source bag instead.
    const fbclid = params.get('fbclid');
    if (fbclid) source.fbclid = String(fbclid).slice(0, 200);
    // Entry path — useful context even with no external referrer, so same-host /
    // in-app arrivals carry where they landed instead of vanishing into 'direct'.
    try { source.landing_path = window.location.pathname.slice(0, 200); } catch (_) {}
    sessionStorage.setItem(SOURCE_KEY, JSON.stringify(source));
    cachedSource = source;
  } catch (_) { cachedSource = {}; }
  return cachedSource;
}

// Last-touch acquisition: unlike first-touch (sessionStorage, set once), this is
// REFRESHED on every page-load that carries a campaign/referral signal, and
// persisted in localStorage so it survives across sessions. Rides every event as
// lt_* (below) and feeds the per-user "Latest click" detail next to first-touch.
let cachedLastSource = null;
function getLastSource() {
  if (cachedLastSource !== null) return cachedLastSource;
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    cachedLastSource = {};
    return cachedLastSource;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const fresh = { ...readUrlCampaignSignals(params), ...readReferrer() };
    // Last-touch fbclid: URL first, else the freshest persisted _fbc.
    let fbclid = params.get('fbclid');
    if (!fbclid) {
      try {
        const fbc = localStorage.getItem('soleil.meta.fbc');
        if (fbc) { const parts = fbc.split('.'); if (parts.length >= 4) fbclid = parts.slice(3).join('.'); }
      } catch (_) {}
    }
    if (fbclid) fresh.fbclid = String(fbclid).slice(0, 200);
    if (Object.keys(fresh).length > 0) {
      fresh.last_touch_at = new Date().toISOString();
      try { localStorage.setItem(LAST_SOURCE_KEY, JSON.stringify(fresh)); } catch (_) {}
      cachedLastSource = fresh;
    } else {
      // No fresh signal this load — keep the previously stored last-touch.
      try { const raw = localStorage.getItem(LAST_SOURCE_KEY); cachedLastSource = raw ? JSON.parse(raw) : {}; }
      catch (_) { cachedLastSource = {}; }
    }
  } catch (_) { cachedLastSource = {}; }
  return cachedLastSource;
}

// Merge share-link first-touch fields into the session source. Called by the
// public /share viewer on mount, BEFORE its first logEvent. First-touch wins:
// existing utm_* / referrer keys are preserved; share_token is added only if
// absent (an earlier share link this session keeps the credit). Persists to
// sessionStorage so it survives the /share → / full-page navigation in the
// same tab, where stampFirstSourceIfNeeded() lands it in profiles.first_source
// at first sign-in. Lives here because SOURCE_KEY + cachedSource are private
// to this module — mutating sessionStorage from outside would be ignored once
// the cache is warm.
export function seedShareFirstSource(token) {
  if (!token || typeof window === 'undefined') return;
  const src = { ...getFirstSource() };
  if (src.share_token) return;
  src.share_token = String(token).slice(0, 40);
  // Make share traffic visible in every utm-sliced funnel query — but never
  // clobber a real campaign tag (a shared link inside a paid ad keeps its ad
  // attribution and merely gains the share_token).
  if (!src.utm_source) { src.utm_source = 'share_link'; src.utm_medium = 'share_page'; }
  try { sessionStorage.setItem(SOURCE_KEY, JSON.stringify(src)); } catch (_) {}
  cachedSource = src;
}

// Same first-touch seeding for admin-curated public marketing boards
// (/c/<slug>, migration 0136). Attributes to public_board/<slug> instead of
// share_link/<token> so signups from a discoverable board are sliceable in the
// funnel. First-touch wins; never clobbers a real campaign tag.
export function seedPublicBoardFirstSource(slug) {
  if (!slug || typeof window === 'undefined') return;
  const src = { ...getFirstSource() };
  if (src.public_slug) return;
  src.public_slug = String(slug).slice(0, 80);
  if (!src.utm_source) { src.utm_source = 'public_board'; src.utm_medium = 'public_page'; }
  try { sessionStorage.setItem(SOURCE_KEY, JSON.stringify(src)); } catch (_) {}
  cachedSource = src;
}

// Stamp the caller's profile.first_source the first time they authenticate
// (server-side first-touch wins). DURABLE: the "done" flag is a per-user
// localStorage key set ONLY after the RPC confirms. A failed stamp (network
// blip) leaves it unset, so the next page-load's SIGNED_IN retries instead of
// silently leaving the user 'direct'/'organic' forever — the historical bug.
// Per-user keying means account-switching on a shared browser still stamps each
// user. The server signup-trigger backstop covers the case where this never runs
// at all (cross-device magic link). One in-session retry on transient failure.
const STAMP_DONE_PREFIX = 'soleil_first_source_stamped:';
let firstSourceStamping = false;
function stampDone(key) { try { return localStorage.getItem(key) === '1'; } catch (_) { return false; } }
async function stampFirstSourceIfNeeded() {
  if (firstSourceStamping || !supabase) return;
  const src = getFirstSource();
  if (!src || Object.keys(src).length === 0) return;
  const { data } = await supabase.auth.getSession();
  const uid = data?.session?.user?.id;
  if (!uid) return;                                  // no session yet — retry on next SIGNED_IN
  const doneKey = STAMP_DONE_PREFIX + uid;
  if (stampDone(doneKey)) return;
  firstSourceStamping = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await supabase.rpc('set_first_source', { p_source: src });
      try { localStorage.setItem(doneKey, '1'); } catch (_) {}   // mark done only on confirmed success
      firstSourceStamping = false;
      return;
    } catch (e) {
      if (attempt === 0) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      // Final failure: record it; leave the done-flag UNSET so a later page-load retries.
      try { logEvent('onboarding_first_source_failed', { reason: String(e?.message || e || 'error').slice(0, 120) }); } catch (_) {}
    }
  }
  firstSourceStamping = false;
}

// Experiment arms ride every event as exp_<key>, exactly like first_source. The
// enrolled map is written by App's seed effect (new users only) via
// setEnrolledExperiments and cached in localStorage so it survives reloads in the
// same browser. Existing users (no seed) have no map → no exp_* on their events,
// keeping the event-level cohort aligned with the server-stamped one.
const EXPERIMENTS_KEY = 'soleil_experiments';
let cachedExperiments = null;
function getExperiments() {
  if (cachedExperiments !== null) return cachedExperiments;
  if (typeof localStorage === 'undefined') { cachedExperiments = {}; return cachedExperiments; }
  try { const raw = localStorage.getItem(EXPERIMENTS_KEY); cachedExperiments = raw ? JSON.parse(raw) : {}; }
  catch (_) { cachedExperiments = {}; }
  return cachedExperiments;
}
// Called once at enrollment (App seed effect) with { exp_<key>: arm }.
export function setEnrolledExperiments(map) {
  if (!map || typeof map !== 'object') return;
  cachedExperiments = { ...map };
  try { localStorage.setItem(EXPERIMENTS_KEY, JSON.stringify(cachedExperiments)); } catch (_) {}
}

// Synchronous read of the caller's stamped arm for one experiment. Consumers use
// this (NOT assignArm) because bandit assignment is randomized — the arm is only
// knowable from the stamp/cache, never recomputable from the user id.
export function getEnrolledArm(key) {
  return getExperiments()[`exp_${key}`] || null;
}

// Cross-browser backfill: a returning user on a fresh device has no cache, but the
// server has their stamped arms. Best-effort, once per page-load, never blocks
// render. Only seeds the cache when it's EMPTY (a seed-written map always wins).
let experimentsPrimed = false;
async function primeEnrolledExperiments() {
  if (experimentsPrimed || !supabase) return;
  experimentsPrimed = true;
  try {
    if (Object.keys(getExperiments()).length > 0) return;   // cache already warm
    const { data } = await supabase.rpc('get_my_experiments');
    if (data && typeof data === 'object' && Object.keys(data).length) {
      const map = {};
      for (const k in data) map[`exp_${k}`] = data[k];
      if (Object.keys(getExperiments()).length === 0) setEnrolledExperiments(map);
    }
  } catch (_) {}
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
      if (session?.user?.id) { stampFirstSourceIfNeeded(); primeEnrolledExperiments(); }
    });
  } catch (_) {}
}

// Refresh last-touch acquisition on every page-load (persists to localStorage),
// independent of auth so anon landings still record their latest click.
if (typeof window !== 'undefined') { try { getLastSource(); } catch (_) {} }

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
  const device = getDeviceInfo();
  const merged = (props && typeof props === 'object') ? { ...props } : {};
  // First-touch source merged into every event so funnel queries are trivial
  // ("what % of pricing_view came from utm_source=reddit").
  for (const k in source) if (merged[k] === undefined) merged[k] = source[k];
  // Last-touch source (latest click), namespaced lt_* so it never collides with
  // the first-touch keys — lets the per-user detail show first vs latest click.
  const last = getLastSource();
  for (const k in last) { const lk = 'lt_' + k; if (merged[lk] === undefined) merged[lk] = last[k]; }
  // Device class (type/os/browser) merged into every event so the admin device
  // breakdown + per-user device read straight from props. Categories only —
  // never the raw user-agent.
  if (merged.device_type === undefined) merged.device_type = device.device_type;
  if (merged.os === undefined)          merged.os          = device.os;
  if (merged.browser === undefined)     merged.browser     = device.browser;
  // A/B arm(s) the user is enrolled in, so any event can be sliced by treatment.
  const exp = getExperiments();
  for (const k in exp) if (merged[k] === undefined) merged[k] = exp[k];
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
