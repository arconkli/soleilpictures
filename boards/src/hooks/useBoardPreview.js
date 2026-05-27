// Loads a board's persisted snapshot (board_state.doc) once and exposes the
// cards array for use in mini-thumbnails. Cached in module memory so the
// many BoardCards on a parent canvas don't all hammer the network.

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { loadBoardSnapshot } from '../lib/boardsApi.js';
import { b64ToBytes, readCards } from '../lib/yhelpers.js';
import { readDocSummary } from '../lib/docState.js';
import { resolveSrc } from '../lib/r2.js';
import * as perf from '../lib/perf.js';

const TTL = 60_000;
const cache = new Map(); // boardId -> { data, expiresAt, promise, listeners }

// ── localStorage persistence layer ───────────────────────────────────────
// The in-memory cache resets on every page load. Marketing-style parents
// (with N sub-board tiles) used to pay a ~600-900ms wall-clock Supabase
// round-trip on every cold load to fetch all the sub-boards' snapshots.
// Persisting decoded previews in localStorage means subsequent visits
// (and visits where the user just edited a sub-board — see yboard.js
// which writes this same key on snapshot save) hit a synchronous cache
// instead of the network.
const LS_PREFIX = 'soleil:preview:';
const LS_FRESH_MS = 5 * 60 * 1000;          // < 5 min → served without revalidate
const LS_MAX_PER_BOARD_BYTES = 200 * 1024;  // 200 KB cap per board

function _lsRead(boardId) {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_PREFIX + boardId) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.data) return null;
    return parsed; // { data, savedAt }
  } catch (_) { return null; }
}
function _lsWrite(boardId, data) {
  try {
    if (typeof localStorage === 'undefined') return;
    const json = JSON.stringify({ data, savedAt: Date.now() });
    if (json.length > LS_MAX_PER_BOARD_BYTES) return; // huge boards bail
    localStorage.setItem(LS_PREFIX + boardId, json);
  } catch (_) { /* quota hit or disabled — silent */ }
}
function _lsClear(boardId) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LS_PREFIX + boardId);
  } catch (_) {}
}

function notifyListeners(boardId, data) {
  const entry = cache.get(boardId);
  if (!entry) return;
  for (const fn of entry.listeners) fn(data);
}

// Module-level concurrency limiter. A parent board with many sub-board
// tiles previously fanned out unbounded parallel snapshot fetches +
// Y.Doc decodes on first paint; with 10 tiles × ~200 KB Y.Doc each that
// pinned the main thread. Capping at 3 in-flight serializes the rest
// without blocking the viewport — visible tiles still race to load.
const PREVIEW_CONCURRENCY = 3;
let _inflight = 0;
const _waiters = [];
function _acquireSlot() {
  if (_inflight < PREVIEW_CONCURRENCY) {
    _inflight++;
    perf.gauge('preview.inflight', _inflight);
    return Promise.resolve();
  }
  perf.gauge('preview.queued', _waiters.length + 1);
  return new Promise((resolve) => { _waiters.push(resolve); });
}
function _releaseSlot() {
  const next = _waiters.shift();
  if (next) next();
  else _inflight--;
  perf.gauge('preview.inflight', _inflight);
  perf.gauge('preview.queued', _waiters.length);
}

async function fetchPreview(boardId) {
  perf.bump('preview.fetch.start');
  if (perf.isEnabled()) console.log('[perf] preview fetch start', boardId);
  await _acquireSlot();
  try {
    const _tNet0 = perf.isEnabled() ? performance.now() : 0;
    const b64 = await loadBoardSnapshot(boardId);
    if (_tNet0) perf.mark('preview.net.ms', performance.now() - _tNet0);
    if (!b64) return { cards: [], arrows: [], strokes: [], docPages: [], docText: '' };
    const _tDec0 = perf.isEnabled() ? performance.now() : 0;
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, b64ToBytes(b64));
    // Doc-mode summary (cheap if there are no doc pages — bails immediately).
    const docSummary = readDocSummary(ydoc);
    const data = {
      cards: readCards(ydoc),
      arrows: ydoc.getArray('arrows').toArray().map(a => (a && a.toJSON) ? a.toJSON() : a),
      strokes: ydoc.getArray('strokes').toArray().map(s => (s && s.toJSON) ? s.toJSON() : s),
      docPages: docSummary.pages,
      docText: docSummary.firstText,
      docFirstPageName: docSummary.firstPageName,
    };
    ydoc.destroy();
    if (_tDec0) {
      const ms = performance.now() - _tDec0;
      perf.mark('preview.decode.ms', ms);
      if (perf.isEnabled()) console.log('[perf] preview decoded', boardId, ms.toFixed(1) + 'ms', data.cards.length + ' cards');
    }
    // Pre-warm the R2 presign cache for every image src in this preview.
    // Without this, each <ThumbImage> in BoardThumbnail mounts and fires
    // its own resolveSrc() in a separate microtask batch — for Marketing
    // (10 sub-tiles × 10-20 image cards each) that's 10+ parallel
    // presign batches hammering the worker. By firing them all in this
    // synchronous loop, r2.js's microtask batcher coalesces them into
    // a SINGLE request per board's preview decode. By the time
    // BoardThumbnail renders, cachedUrl() returns synchronously.
    try {
      let warmed = 0;
      for (const c of data.cards) {
        if (c?.kind === 'image' && typeof c.src === 'string' && c.src.startsWith('r2:')) {
          resolveSrc(c.src);
          warmed++;
        }
      }
      if (warmed && perf.isEnabled()) {
        console.log('[perf] preview prewarm', boardId, `${warmed} r2 srcs queued`);
      }
    } catch (_) { /* placeholder rects will fill in if this fails */ }
    // Persist to localStorage so future page loads can render this tile
    // instantly without a Supabase round-trip. See _lsWrite for size cap.
    _lsWrite(boardId, data);
    perf.bump('preview.fetch.done');
    return data;
  } catch (e) {
    console.warn('useBoardPreview fetch failed', e);
    return { cards: [], arrows: [], strokes: [], docPages: [], docText: '' };
  } finally {
    _releaseSlot();
  }
}

// `enabled` (default true) lets a caller defer the fetch until something
// happens — e.g. the consuming card scrolled into view. When false the
// hook is inert and returns null, no network or Y.Doc work happens.
//
// Cache layering (newest → oldest):
//   1. In-memory `cache` Map (60s TTL) — same-page, same-session.
//   2. localStorage `soleil:preview:<id>` — survives reloads, written
//      either by fetchPreview success here OR by yboard.js's snapshot
//      save (i.e. updates every time the user edits ANY board).
//   3. Supabase board_state via fetchPreview — the network round-trip.
//
// Stale-while-revalidate: if localStorage data is older than 5 min, we
// still SHOW it immediately, but ALSO kick off a fresh fetchPreview in
// the background. When the fresh data lands, listeners are notified and
// the UI updates seamlessly.
export function useBoardPreview(boardId, enabled = true) {
  const [data, setData] = useState(() => {
    if (!enabled) return null;
    const mem = cache.get(boardId)?.data;
    if (mem) return mem;
    return _lsRead(boardId)?.data ?? null;
  });

  useEffect(() => {
    if (!enabled) { setData(null); return; }
    if (!boardId) { setData(null); return; }
    let entry = cache.get(boardId);

    // Hydrate in-memory cache from localStorage on first sight of this
    // boardId in the session, so subsequent hooks for the same board
    // don't have to re-read localStorage.
    if (!entry?.data) {
      const ls = _lsRead(boardId);
      if (ls?.data) {
        entry = entry || { data: null, expiresAt: 0, promise: null, listeners: new Set() };
        entry.data = ls.data;
        entry.expiresAt = Date.now() + TTL;
        if (!cache.has(boardId)) cache.set(boardId, entry);
      }
    }

    // Sync existing cached data into local state immediately so we never
    // briefly render with stale `null` from useState's initializer.
    if (entry?.data) setData(entry.data);
    else setData(null);

    // Decide whether to fetch. With localStorage we have a richer truth:
    // fresh LS hit (< 5min) → skip network entirely. Stale LS hit → show
    // it AND revalidate in background. No data at all → fetch.
    const ls = _lsRead(boardId);
    const lsFresh = ls && (Date.now() - ls.savedAt) < LS_FRESH_MS;
    const memFresh = entry && entry.data && entry.expiresAt > Date.now();
    const needFetch = !memFresh && !lsFresh;
    if (needFetch && !entry?.promise) {
      const promise = fetchPreview(boardId);
      if (!entry) {
        entry = { data: null, expiresAt: Date.now() + TTL, promise, listeners: new Set() };
        cache.set(boardId, entry);
      } else {
        entry.expiresAt = Date.now() + TTL;
        entry.promise = promise;
      }
      promise.then(d => {
        const cur = cache.get(boardId);
        if (!cur || cur.promise !== promise) return; // superseded by invalidate
        cur.data = d;
        cur.expiresAt = Date.now() + TTL;
        cur.promise = null;
        notifyListeners(boardId, d);
      });
    }

    const listener = (d) => setData(d);
    entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  }, [boardId, enabled]);

  return data;
}

// Manually invalidate a board's cached preview — call after the user closes
// the board so its thumbnail picks up the latest snapshot.
//
// IMPORTANT: we KEEP the listener set attached and trigger a refetch in place.
// Deleting the cache entry would orphan every active listener (their owning
// component's useEffect already ran on mount and won't run again), so the
// thumbnail would just go blank and never come back.
export function invalidateBoardPreview(boardId) {
  _lsClear(boardId);
  const entry = cache.get(boardId);
  if (!entry) return;
  entry.data = null;
  entry.expiresAt = 0;
  // Optimistically clear so consumers can show a loading state.
  for (const fn of entry.listeners) fn(null);
  // Refetch and notify when it lands.
  const promise = fetchPreview(boardId);
  entry.promise = promise;
  promise.then(d => {
    const cur = cache.get(boardId);
    if (!cur || cur.promise !== promise) return; // superseded
    cur.data = d;
    cur.expiresAt = Date.now() + TTL;
    cur.promise = null;
    notifyListeners(boardId, d);
  });
}
