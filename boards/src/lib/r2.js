// R2 read-URL cache + microtask-batched fetcher.
//
// Cards / doc embeds store image references as `r2:<key>` sentinels.
// At render time, components ask for a fresh signed URL via
// `getSignedUrl(key)`. We:
//   1. Return cached URL immediately if not near expiry.
//   2. Otherwise, queue the key for batch fetch; flush the queue on
//      the next microtask. All requests within the same render tick
//      coalesce into a single network call.
//   3. Worker returns URLs valid for 5 min; we cache them for 4 min,
//      so a refresh always lands before the URL expires.

import { supabase } from './supabase.js';

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999';
const PARTYKIT_PROTOCOL = PARTYKIT_HOST.startsWith('localhost') ? 'http' : 'https';

// The upload party signs read URLs valid for 7 days; we cache them for 6 so a
// refresh always lands before expiry. Long-lived + persisted (below) is what
// lets a repeat board open reuse the SAME signed URL string and hit the browser
// disk cache instead of re-signing + re-downloading every image.
export const CACHE_TTL_MS = 6 * 24 * 60 * 60 * 1000;   // 6 days (1-day headroom under the 7-day URL)
const cache = new Map();              // key → { url, expiresAt }

// ── Persistence ───────────────────────────────────────────────────────────
// Persist the signed-URL cache to localStorage so a reload reuses identical URL
// strings (→ browser disk-cache hits). Keyed by the signed-in user's id and
// cleared on sign-out: a signed URL grants 7-day read access to specific keys,
// so a different user on a shared device must never inherit them.
const LS_KEY = 'soleil.r2urls';
const LS_MAX_ENTRIES = 1500;          // cap so we never blow the ~5MB localStorage quota
let _ownerUid = null;                 // uid the in-memory cache currently belongs to
let _persistTimer = null;

function schedulePersist() {
  if (_persistTimer || typeof localStorage === 'undefined' || !_ownerUid) return;
  _persistTimer = setTimeout(persist, 1500);
}
function persist() {
  _persistTimer = null;
  try {
    if (!_ownerUid) return;
    const now = Date.now();
    const rows = [];
    for (const [k, v] of cache) if (v.expiresAt > now) rows.push([k, v.url, v.expiresAt]);
    rows.sort((a, b) => b[2] - a[2]);                 // keep the most-recently-valid
    localStorage.setItem(LS_KEY, JSON.stringify({ uid: _ownerUid, v: rows.slice(0, LS_MAX_ENTRIES) }));
  } catch (_) { /* quota / disabled storage — caching just stays in-memory */ }
}
function hydrate(uid) {
  _ownerUid = uid;
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.uid !== uid) { localStorage.removeItem(LS_KEY); return; }
    const now = Date.now();
    for (const [k, url, expiresAt] of (parsed.v || [])) {
      if (expiresAt > now && !cache.has(k)) cache.set(k, { url, expiresAt });
    }
  } catch (_) { /* malformed — ignore */ }
}
function clearPersisted() {
  cache.clear();
  _ownerUid = null;
  if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
  try { if (typeof localStorage !== 'undefined') localStorage.removeItem(LS_KEY); } catch (_) {}
}

// Hydrate once we know who's signed in; clear on sign-out or user switch.
try {
  supabase.auth.getSession().then(({ data }) => {
    const uid = data?.session?.user?.id || null;
    if (uid && !_ownerUid) hydrate(uid);
  });
  supabase.auth.onAuthStateChange((event, session) => {
    const uid = session?.user?.id || null;
    if (event === 'SIGNED_OUT' || !uid) { clearPersisted(); return; }
    if (_ownerUid && _ownerUid !== uid) clearPersisted();
    if (!_ownerUid) hydrate(uid);
  });
} catch (_) { /* no auth available (e.g. public viewer) — in-memory only */ }

// Optional resolver override. When set, EVERY read-URL request (r2:<key>)
// resolves through this function instead of the authenticated sign-reads
// path. Used by the public /share viewer, which has no Supabase session
// but receives a presigned {key → URL} map in its share bundle. Returns a
// URL string or null/undefined for unknown keys.
let _override = null;
export function setReadUrlResolver(fn) { _override = typeof fn === 'function' ? fn : null; }
export function clearReadUrlResolver() { _override = null; }

let pendingResolvers = new Map();     // key → array of resolve fns
let pendingTimer = null;

// Batch queue gets flushed on the next animation frame so every card painting
// in the same frame produces a single network round trip (setTimeout(0) could
// fragment across React commits). Falls back to setTimeout where rAF is absent
// (tests / non-DOM).
function scheduleFlush() {
  if (pendingTimer) return;
  pendingTimer = (typeof requestAnimationFrame === 'function')
    ? requestAnimationFrame(flush)
    : setTimeout(flush, 0);
}

async function flush() {
  pendingTimer = null;
  if (pendingResolvers.size === 0) return;
  const resolvers = pendingResolvers;
  pendingResolvers = new Map();
  const keys = Array.from(resolvers.keys());

  let urls = {};
  let ttlMs = CACHE_TTL_MS;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token || '';
    if (!token) {
      // Not signed in — can't presign anything. Resolve with null.
      for (const cbs of resolvers.values()) for (const cb of cbs) cb(null);
      return;
    }

    // Use the user's first workspace as the room id; the room name
    // doesn't affect routing logic for HTTP-only parties, but PartyKit
    // requires one. Any string works.
    const room = 'default';
    const url = `${PARTYKIT_PROTOCOL}://${PARTYKIT_HOST}/parties/upload/${encodeURIComponent(room)}/sign-reads`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ keys }),
    });
    if (!res.ok) {
      console.warn('[r2] sign-reads failed', res.status);
      for (const cbs of resolvers.values()) for (const cb of cbs) cb(null);
      return;
    }
    const body = await res.json();
    urls = body.urls || {};
    // Honor the party's actual TTL so the client cache adapts automatically
    // (incl. the brief deploy window where an old party still signs 5-min URLs)
    // instead of trusting the 6-day default for a short-lived URL.
    if (typeof body.ttl === 'number' && body.ttl > 0) ttlMs = body.ttl * 1000;
  } catch (e) {
    console.warn('[r2] sign-reads error', e);
    for (const cbs of resolvers.values()) for (const cb of cbs) cb(null);
    return;
  }

  const now = Date.now();
  for (const [key, cbs] of resolvers) {
    const url = urls[key] || null;
    if (url) cache.set(key, { url, expiresAt: now + Math.floor(ttlMs * 0.95) });
    for (const cb of cbs) cb(url);
  }
  schedulePersist();
}

// Public: resolve a key to a signed URL (cached). Returns null if
// the user isn't permitted to read this key, isn't signed in, or
// network failed.
export function getSignedUrl(key) {
  if (!key || typeof key !== 'string') return Promise.resolve(null);
  // Public viewer: resolve against the bundle's presigned map, never
  // touch the auth-gated sign-reads endpoint.
  if (_override) return Promise.resolve(_override(key) || null);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.url);

  return new Promise((resolve) => {
    if (!pendingResolvers.has(key)) pendingResolvers.set(key, []);
    pendingResolvers.get(key).push(resolve);
    scheduleFlush();
  });
}

// Public: take any image reference and resolve it to a renderable URL.
//   "r2:<key>"  → signed R2 URL (async)
//   any other   → returned as-is (legacy https URLs, externals, data: URIs)
export async function resolveSrc(src) {
  if (typeof src !== 'string' || !src) return null;
  if (!src.startsWith('r2:')) return src;
  return getSignedUrl(src.slice(3));
}

// Sync helper for renderers: returns the URL if cached, else null
// (caller should subscribe and re-render when resolveSrc resolves).
export function cachedUrl(src) {
  if (typeof src !== 'string' || !src.startsWith('r2:')) return src || null;
  const key = src.slice(3);
  // Public viewer: the presigned URL is known synchronously, so the
  // first paint can show the image with no shimmer.
  if (_override) return _override(key) || null;
  const cached = cache.get(key);
  return cached && cached.expiresAt > Date.now() ? cached.url : null;
}
