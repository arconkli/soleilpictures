// Loads a board's persisted snapshot (board_state.doc) once and exposes the
// cards array for use in mini-thumbnails. Cached in module memory so the
// many BoardCards on a parent canvas don't all hammer the network.

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { loadBoardSnapshot } from '../lib/boardsApi.js';
import { b64ToBytes, readCards } from '../lib/yhelpers.js';
import { readDocSummary } from '../lib/docState.js';

const TTL = 60_000;
const cache = new Map(); // boardId -> { data, expiresAt, promise, listeners }

function notifyListeners(boardId, data) {
  const entry = cache.get(boardId);
  if (!entry) return;
  for (const fn of entry.listeners) fn(data);
}

async function fetchPreview(boardId) {
  try {
    const b64 = await loadBoardSnapshot(boardId);
    if (!b64) return { cards: [], arrows: [], strokes: [], docPages: [], docText: '' };
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
    return data;
  } catch (e) {
    console.warn('useBoardPreview fetch failed', e);
    return { cards: [], arrows: [], strokes: [], docPages: [], docText: '' };
  }
}

export function useBoardPreview(boardId) {
  const [data, setData] = useState(() => cache.get(boardId)?.data || null);

  useEffect(() => {
    if (!boardId) { setData(null); return; }
    let entry = cache.get(boardId);

    // Sync existing cached data into local state immediately so we never
    // briefly render with stale `null` from useState's initializer.
    if (entry?.data) setData(entry.data);
    else setData(null);

    const stale = !entry || entry.expiresAt <= Date.now();
    if (stale && !entry?.promise) {
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
  }, [boardId]);

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
