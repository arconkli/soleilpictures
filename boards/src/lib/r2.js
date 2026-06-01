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

const CACHE_TTL_MS = 4 * 60 * 1000;   // 4 min — leaves 1 min headroom under worker's 5 min
const cache = new Map();              // key → { url, expiresAt }

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

// Batch queue gets flushed at the next microtask boundary so multiple
// components rendering at once produce one network round trip.
function scheduleFlush() {
  if (pendingTimer) return;
  pendingTimer = setTimeout(flush, 0);
}

async function flush() {
  pendingTimer = null;
  if (pendingResolvers.size === 0) return;
  const resolvers = pendingResolvers;
  pendingResolvers = new Map();
  const keys = Array.from(resolvers.keys());

  let urls = {};
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
  } catch (e) {
    console.warn('[r2] sign-reads error', e);
    for (const cbs of resolvers.values()) for (const cb of cbs) cb(null);
    return;
  }

  const now = Date.now();
  for (const [key, cbs] of resolvers) {
    const url = urls[key] || null;
    if (url) cache.set(key, { url, expiresAt: now + CACHE_TTL_MS });
    for (const cb of cbs) cb(url);
  }
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
