// Image metadata cache — blur hash + preview availability, keyed by R2
// storage_path. Mirrors lib/r2.js (module-level cache + a public-viewer
// resolver override) but for the progressive-loading metadata rather than
// signed URLs.
//
// Why a separate cache (not the Y.Doc, not sign-reads):
//   - NOT the Y.Doc: blur/preview is DERIVED metadata that changes when a
//     backfill runs. Writing it into cards would bloat every snapshot and emit
//     collaborative Y.Doc updates (undo entries, realtime fan-out, history
//     churn) for a pure background optimization.
//   - NOT folded into sign-reads: sign-reads is the hot, viewport-gated,
//     ~4-min-refreshing presign path. Metadata is needed once, earlier (the
//     moment cards render, so the Tier-0 blur can paint), and never expires.
//
// On board open, useYBoard primes this with the snapshot's image keys in one
// RLS-protected query. R2Image (progressive mode) reads it synchronously via
// getMeta() and subscribes for the value arriving after a cold open.

import { supabase } from './supabase.js';
import * as perf from './perf.js';

const cache = new Map();        // storage_path → { blur, previewKey, previewW, previewH, w, h }
const inflight = new Set();     // storage_path currently being fetched (dedupe)
const subscribers = new Map();  // storage_path → Set<cb>

// Public-viewer override (mirrors r2.setReadUrlResolver). The /share bundle
// carries metadata for an anon viewer that has no Supabase session, so getMeta
// resolves against the bundle instead of querying.
let _resolver = null;
export function setMetaResolver(fn) {
  _resolver = typeof fn === 'function' ? fn : null;
  // A late-installed resolver (bundle arrived) should wake any waiting cards.
  notifyAll();
}
export function clearMetaResolver() { _resolver = null; }

function notify(key) {
  const subs = subscribers.get(key);
  if (subs) for (const cb of subs) { try { cb(); } catch (_) {} }
}
function notifyAll() {
  for (const key of subscribers.keys()) notify(key);
}

function rowToMeta(row) {
  return {
    blur:       row.blur_hash || null,
    previewKey: row.preview_path || null,
    previewW:   row.preview_w ?? null,
    previewH:   row.preview_h ?? null,
    w:          row.width ?? null,
    h:          row.height ?? null,
  };
}

// Prime metadata for a list of original storage_path keys. Dedupes against
// already-cached and in-flight keys, chunks into ≤200 (PostgREST IN-list cap,
// matching sign-reads), and stores each row. Fire-and-forget; getMeta returns
// null until it lands, then subscribers are notified.
export async function primeImageMeta(keys) {
  if (_resolver) return;  // public viewer: metadata comes from the bundle
  if (!Array.isArray(keys) || keys.length === 0) return;

  // Synchronously reserve uncached/not-in-flight keys so concurrent primes
  // (board-open bulk + per-card safety net) don't double-query.
  const todo = [];
  for (const k of keys) {
    if (!k || typeof k !== 'string') continue;
    if (cache.has(k) || inflight.has(k)) continue;
    inflight.add(k);
    todo.push(k);
  }
  if (todo.length === 0) return;

  const _t0 = perf.isEnabled() ? performance.now() : 0;
  const CHUNK = 200;
  const chunks = [];
  for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK));
  try {
    // Run every 200-key chunk in parallel — a 500-image board primes in one
    // round-trip's worth of wall time instead of three serialized ones, so the
    // Tier-0 blur can paint sooner.
    await Promise.all(chunks.map(async (chunk) => {
      const { data, error } = await supabase
        .from('images')
        .select('storage_path,blur_hash,preview_path,preview_w,preview_h,width,height')
        .in('storage_path', chunk);
      if (error) { for (const k of chunk) inflight.delete(k); return; }
      const seen = new Set();
      for (const row of (data || [])) {
        cache.set(row.storage_path, rowToMeta(row));
        seen.add(row.storage_path);
      }
      // Keys with no row (RLS-hidden or not yet inserted) get a null-meta
      // entry so we don't re-query them every render; a later setMetaLocal
      // (e.g. after the upload's variant generation) overwrites it.
      for (const k of chunk) {
        if (!seen.has(k)) cache.set(k, { blur: null, previewKey: null, previewW: null, previewH: null, w: null, h: null });
        inflight.delete(k);
        notify(k);
      }
      for (const k of seen) notify(k);
    }));
  } finally {
    for (const k of todo) inflight.delete(k);
    if (_t0) {
      perf.mark('imageMeta.prime.ms', performance.now() - _t0);
      perf.gauge('imageMeta.cacheSize', cache.size);
    }
  }
}

// Synchronous accessor for R2Image. Returns the meta object or null.
export function getMeta(key) {
  if (!key || typeof key !== 'string') return null;
  if (_resolver) return _resolver(key) || null;
  return cache.get(key) || null;
}

// Optimistic local update (after a backfill or fresh upload generates a
// variant) so the live session switches to the preview without a refetch.
export function setMetaLocal(key, patch) {
  if (!key || typeof key !== 'string' || !patch) return;
  const prev = cache.get(key) || {};
  cache.set(key, { ...prev, ...patch });
  notify(key);
}

// Subscribe to meta arriving/changing for a key. Returns an unsubscribe fn.
export function subscribeMeta(key, cb) {
  if (!key || typeof cb !== 'function') return () => {};
  let set = subscribers.get(key);
  if (!set) { set = new Set(); subscribers.set(key, set); }
  set.add(cb);
  return () => {
    const s = subscribers.get(key);
    if (s) { s.delete(cb); if (s.size === 0) subscribers.delete(key); }
  };
}
