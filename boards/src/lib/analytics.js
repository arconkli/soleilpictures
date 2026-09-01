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
import { isAnyQaMode } from './localMode.js';
import { touchAppSession, noteAuthChange, persistAppSession,
         getAppSession, setSessionRotateHandler } from './appSession.js';
import { createSummary, noteEvent, summaryProps, worthEmitting } from './sessionSummary.js';
import { BUILD_SHA } from './buildInfo.js';
// Safe to import: analyticsEvents.js is a leaf module with no imports of its
// own, so there is no cycle back into this file. (An older comment here claimed
// otherwise and used a raw literal to avoid one that doesn't exist.)
import { EV, WORK_EVENTS } from './analyticsEvents.js';
import { noteWorkOp } from './workSignal.js';
import {
  FLUSH_INTERVAL_MS, MAX_QUEUE, MAX_BATCH, MAX_BEACON_BYTES, MAX_ROW_AGE_MS,
  beaconChunks, backoffFor, pruneStale, capQueue, partitionRetries, wireRow,
} from './analyticsQueue.js';

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
  // Lifecycle campaign marker (?lc=<email_type>.<version>), appended by the
  // email CTAs alongside their utm_*. Carried here as well as in the dedicated
  // lifecycle_land event so a lifecycle arrival brands last-touch like any other
  // click — without it the only record of the campaign is the event itself.
  const lc = params.get('lc');
  if (lc) out.lc = lc.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
  // Referral code (?ref=<code>): a friend's personal invite link. Normalized to
  // the mint alphabet so it round-trips cleanly into signup metadata, where the
  // signup trigger resolves it to the referrer and grants both sides bonus cards.
  const ref = params.get('ref');
  if (ref) { const c = ref.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16).toUpperCase(); if (c) out.ref = c; }
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
      try { logEvent(EV.ONBOARDING_FIRST_SOURCE_FAILED, { reason: String(e?.message || e || 'error').slice(0, 120) }); } catch (_) {}
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

// The DEVICE id. Named "session" for historical reasons and deliberately left
// that way: it is minted once and never rotates, which is exactly what makes it
// a durable stitch between a visitor's pre-auth funnel and the account they
// later create, and 90 days of RPCs read it with that meaning. It is not a
// session — see appSession.js for the one that is. Rows now carry both.
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
// Identity changing ends a session — but this callback also fires for token
// refreshes and for the initial restore of an already-signed-in user, and
// rotating on either would mean a new "session" on every page load and every
// hour. So rotate only on a genuine change of user id, and never on the first
// callback, which is the app learning who was already here.
let authSettled = false;
if (supabase) {
  try {
    supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user?.id ?? null;
      const identityChanged = authSettled && nextUserId !== cachedUserId;
      authSettled = true;
      cachedUserId = nextUserId;
      cachedAccessToken = session?.access_token ?? null;
      userIdResolved = true;
      // Attribute first-party error logs to the signed-in user by id (no PII).
      setErrorUser(cachedUserId);
      if (identityChanged) {
        // Beacon what the outgoing identity produced before the id rotates,
        // otherwise those rows inherit the new session and the sign-in boundary
        // is lost.
        try { flushBeacon(); } catch (_) {}
        try { noteAuthChange(); } catch (_) {}
      }
      if (session?.user?.id) { stampFirstSourceIfNeeded(); primeEnrolledExperiments(); }
    });
  } catch (_) {}
}

// Refresh last-touch acquisition on every page-load (persists to localStorage),
// independent of auth so anon landings still record their latest click.
if (typeof window !== 'undefined') { try { getLastSource(); } catch (_) {} }

// ── Ambient context ────────────────────────────────────────────────────
// Where the user is and who they are, merged into every event the same way
// device class and experiment arms already are.
//
// Without this, dimensions have to be threaded through each call site by hand,
// and they mostly aren't: search_run carries only {has_results}, card_edit only
// {kind, board_id}. That makes "which surface do people abandon" or "do paid
// users behave differently" unanswerable without editing hundreds of files.
// One setter, updated by App.jsx on board open and route change, fixes it for
// every event at once — including ones that already exist.
//
// Caller-supplied props always win, so a call site that knows better still does.

const ctx = { board_id: null, surface: null, tier: null };

/**
 * Merge fields into the ambient context. Pass null to clear one.
 * Unknown keys are ignored so a typo can't quietly widen the envelope.
 */
export function setAnalyticsContext(next) {
  if (!next || typeof next !== 'object') return;
  for (const k of ['board_id', 'surface', 'tier']) {
    if (k in next) ctx[k] = next[k] == null ? null : String(next[k]).slice(0, 64);
  }
}

export function getAnalyticsContext() { return { ...ctx }; }

// The build this event came from, so a regression can be pinned to a release —
// the same stamp the Worker serves at /api/build-info and the SEO drift check
// compares against. 'dev' means an unstamped local build; it is dropped rather
// than stored so the column stays meaningful.
const BUILD = BUILD_SHA && BUILD_SHA !== 'dev' && BUILD_SHA !== 'unknown' ? BUILD_SHA : null;

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
// Delivery rules (batching, backoff, chunking, ageing) live in analyticsQueue.js
// so they can be unit-tested without a bundler — this file can't be imported in
// plain node because the supabase client reads import.meta.env.

// Persisted per TAB, not per origin. A single shared key would have concurrent
// tabs overwriting each other's queues on every save; sessionStorage gives each
// tab a stable id that survives its own reloads, and orphaned keys left by a
// tab that never came back are adopted by the next one (see adoptOrphans).
const QUEUE_PREFIX = 'soleil_analytics_q:';
const TAB_KEY = 'soleil_analytics_tab';

let queue = [];
let flushTimer = null;
let failures = 0;        // consecutive flush failures, drives the backoff
let dropped = 0;         // rows lost since the last successful report
let reportingDrop = false;

function tabId() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    let id = sessionStorage.getItem(TAB_KEY);
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(TAB_KEY, id);
    }
    return id;
  } catch (_) { return null; }
}

function saveQueue() {
  const id = tabId();
  if (!id || typeof localStorage === 'undefined') return;
  try {
    if (queue.length === 0) { localStorage.removeItem(QUEUE_PREFIX + id); return; }
    localStorage.setItem(QUEUE_PREFIX + id, JSON.stringify({ savedAt: Date.now(), rows: queue }));
  } catch (_) {
    // Quota or private mode. In-memory delivery still works; we just lose the
    // crash-survival guarantee, which is strictly better than throwing.
  }
}

function freshRows(rows) {
  const { kept, dropped: n } = pruneStale(rows, Date.now(), MAX_ROW_AGE_MS);
  dropped += n;
  return kept;
}

// Reclaim this tab's own queue (a reload or a crash-restore), then adopt any
// left behind by tabs that are gone. Without the sweep, a browser crash with
// three tabs open would strand two queues forever.
function restoreQueue() {
  if (typeof localStorage === 'undefined') return;
  const id = tabId();
  const orphanCutoff = Date.now() - 10 * 60 * 1000;
  const takeable = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(QUEUE_PREFIX)) continue;
      const mine = id && key === QUEUE_PREFIX + id;
      let parsed = null;
      try { parsed = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { /* corrupt */ }
      // Unparseable and not ours: nothing to adopt, but it would otherwise sit
      // in storage forever. Claim it so it gets removed below.
      const stranded = !parsed;
      const staleOrphan = parsed && parsed.savedAt < orphanCutoff;
      if (!mine && !staleOrphan && !stranded) continue;   // a live sibling tab — leave it alone
      takeable.push(key);
      if (parsed) queue.push(...freshRows(parsed.rows));
    }
    for (const key of takeable) localStorage.removeItem(key);
  } catch (_) { /* enumeration is best-effort */ }
  applyCap();
  if (queue.length && !flushTimer) flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

// Enforce the ceiling, counting whatever it discards so the loss can surface as
// telemetry_drop rather than vanishing.
function applyCap() {
  const capped = capQueue(queue, MAX_QUEUE);
  dropped += capped.dropped;
  queue = capped.kept;
}

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
  // Rows produced by a dev-only QA harness (the e2e suite driving the real app
  // through ?local=1 & friends) are labelled at the source, because they can and
  // do reach the production table — see isAnyQaMode. Reads filter on this, so a
  // test run can never again be mistaken for demand. Always false in a
  // production build.
  if (isAnyQaMode()) merged.synthetic = true;
  // Ambient context: where they are, what they're paying, which build. Merged
  // last and never over caller props, so an explicit board_id at the call site
  // still wins over the one the app happens to have open.
  if (merged.board_id === undefined && ctx.board_id) merged.board_id = ctx.board_id;
  if (merged.surface  === undefined && ctx.surface)  merged.surface  = ctx.surface;
  if (merged.tier     === undefined && ctx.tier)     merged.tier     = ctx.tier;
  if (merged.build    === undefined && BUILD)        merged.build    = BUILD;
  // Advancing the session clock here means every event keeps it alive, so the
  // 30-minute idle window measures real inactivity rather than time since load.
  const sess = touchAppSession();
  if (merged.session_seq === undefined) merged.session_seq = sess.seq;
  return {
    session_id:  getSessionId(),
    // The real session, beside the device id above. Rotates on idle, on
    // sign-in/out, and at the UTC day boundary — see appSession.js.
    app_session_id: sess.id,
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
  applyCap();
  saveQueue();
  if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

// Loss used to be invisible: the queue silently dropped its oldest rows and a
// rejected batch vanished, so an instrumentation outage looked exactly like a
// quiet week. Report it as an event of its own, once the pipe is healthy again.
function reportDropped() {
  if (dropped <= 0 || reportingDrop) return;
  const n = dropped;
  dropped = 0;
  reportingDrop = true;
  try { enqueue(buildRow('telemetry_drop', { n })); } catch (_) {}
  reportingDrop = false;
}

async function flush() {
  flushTimer = null;
  if (!supabase || queue.length === 0) return;
  const batch = queue.splice(0, MAX_BATCH);
  if (cachedUserId) for (const r of batch) if (r.user_id == null) r.user_id = cachedUserId;

  let failed = false;
  try {
    // supabase-js RESOLVES with { error } on an HTTP failure rather than
    // throwing, so the old bare catch never fired and every rejected batch was
    // lost without a trace. Check the returned error, not just exceptions.
    const { error } = await supabase.from('analytics_events').insert(batch.map(wireRow));
    failed = !!error;
  } catch (_) {
    failed = true;
  }

  if (failed) {
    const { retry, exhausted } = partitionRetries(batch);
    dropped += exhausted;
    queue = [...retry, ...queue];   // failed rows go back to the front, in order
    applyCap();
    failures++;
  } else {
    failures = 0;
    reportDropped();
  }

  saveQueue();
  if (queue.length > 0 && !flushTimer) {
    flushTimer = setTimeout(flush, backoffFor(failures));
  }
}

// Unload/redirect-safe flush. keepalive fetch survives navigation AND can set
// the apikey/authorization headers PostgREST needs; sendBeacon (header-less,
// ?apikey= in the URL, anon-only) is the last-ditch fallback.
function postBeacon(rows) {
  const body = JSON.stringify(rows.map(wireRow));   // PostgREST bulk-inserts a JSON array
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

function flushBeacon() {
  // The session record is in memory between throttled writes; unload is the
  // last chance to make it durable, or a reload starts a phantom new session.
  try { persistAppSession(); } catch (_) {}
  if (!supabase || queue.length === 0) return;
  const batch = queue.splice(0, MAX_QUEUE);
  if (cachedUserId) for (const r of batch) if (r.user_id == null) r.user_id = cachedUserId;

  // Chunk under the keepalive body cap. One oversized POST is dropped whole and
  // without warning, which is how a trace-heavy session loses everything it
  // recorded at exactly the moment it has the most to say.
  for (const chunk of beaconChunks(batch, MAX_BEACON_BYTES)) postBeacon(chunk);

  saveQueue();   // the queue is empty now — clears this tab's persisted copy
}

// Unchanged signature — now enqueues. Never throws into the UI.
export function logEvent(name, props = {}) {
  if (!supabase || !name) return;
  // Noting work here rather than at each mutation site means the day's
  // work/presence distinction stays correct as events are added, instead of
  // depending on someone remembering a second call. WORK_EVENTS is the
  // definition; see analyticsEvents.js for where the bar is drawn.
  try { if (WORK_EVENTS.has(name)) noteWorkOp(); } catch (_) {}
  try { enqueue(buildRow(name, props)); } catch (_) {}
  // AFTER buildRow, never inside it: buildRow advances the session clock and can
  // therefore rotate, which fires the summary handler. Folding the event in
  // beforehand would attribute it to the session that just ended.
  try { noteEvent(ensureSummary(), name, props); } catch (_) {}
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
  try { if (WORK_EVENTS.has(name)) noteWorkOp(); } catch (_) {}
  try { enqueue(buildRow(name, props)); } catch (_) {}
  try { noteEvent(ensureSummary(), name, props); } catch (_) {}
  try { flushBeacon(); } catch (_) {}
}

// Manual flush escape hatch (tests / explicit teardown).
export function flushNow() { try { flushBeacon(); } catch (_) {} }

// ── The per-session terminal row ────────────────────────────────────────────
//
// One dense summary when a session ends. See sessionSummary.js for why it
// exists: ps_* covers only a new user's first session and app_trace is
// deliberately sparse, so the session preceding visit two — the transition
// where this product actually loses people — summarises to nothing today.
//
// Emitted on the first of a rotation (idle / day boundary / sign-in) and the
// page going away. A session that is hidden and then RESUMED without rotating
// emits a second, later row for the same of_session; the reader takes the last
// one per of_session, which is strictly the more complete. That is preferred to
// emitting once and under-reporting long sessions, because session length is
// the sharpest thing separating the two populations.
let summaryAcc = null;

function ensureSummary(now) {
  const sess = getAppSession();
  if (!summaryAcc || summaryAcc.id !== sess.id) summaryAcc = createSummary(sess, now);
  return summaryAcc;
}

function emitSessionSummary(ended) {
  try {
    const acc = summaryAcc;
    if (!worthEmitting(acc)) return;
    const props = summaryProps(acc, ended);
    // Straight to the queue: going through logEvent would fold this row into
    // the very accumulator it is reporting on.
    enqueue(buildRow(EV.SESSION_SUMMARY, props));
  } catch (_) { /* a summary must never break a page teardown */ }
}

// The rotate hook is a SINGLE slot on appSession — claiming it here means a
// future second consumer would silently replace this one. It was declared for
// closing out usage slices and had never been claimed by anything.
try {
  setSessionRotateHandler((next) => {
    // `next` is the session that just STARTED; summaryAcc still describes the
    // one that ended, which is why of_session rides in props.
    emitSessionSummary('rotate');
    summaryAcc = createSummary(next);
  });
} catch (_) { /* non-browser import */ }

// Beacon the queue when the page is hidden or unloading. visibilitychange→hidden
// is the reliable mobile signal; pagehide/beforeunload back it up on desktop.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { emitSessionSummary('hide'); flushBeacon(); }
  });
  window.addEventListener('pagehide', () => { emitSessionSummary('pagehide'); flushBeacon(); });
  window.addEventListener('beforeunload', flushBeacon);
}

// Prime the user-id / access-token cache so early (pre-interaction) events
// attribute to the signed-in user instead of waiting for the first flush.
if (supabase) { try { getCurrentUserId(); } catch (_) {} }

// Reclaim anything a previous load (or a crashed sibling tab) left behind.
// Runs last so the flush timer it may start finds the module fully built.
if (typeof window !== 'undefined') { try { restoreQueue(); } catch (_) {} }
