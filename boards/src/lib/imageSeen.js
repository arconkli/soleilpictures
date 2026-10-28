// What each described picture on a cluster shows, for screen readers only:
// the owner (2026-10-28) keeps the AI's words off the screen, so a card
// carries its picture's description as visually hidden text beside it.
// image_seen_for_board (0596) once per cluster, when the browser is idle,
// again after ten minutes; each image card reads its own line.
//
// Never alt: a browser prints alt beside a picture that fails to load, and
// R2Image hands alt to downloadImage as the file's title.
//
// Signed-in only (the read is closed to anon): CanvasSurface primes it off
// public pages, and a card on a cluster nobody primed reads nothing.

import { useSyncExternalStore } from 'react';
import { supabase } from './supabase.js';

const TTL_MS = 10 * 60 * 1000;
const byBoard = new Map();   // boardId → { at, loading, map: Map<cardId, text> | null }
const listeners = new Set();

export function primeImageSeen(boardId) {
  if (!supabase || !boardId) return;
  const cur = byBoard.get(boardId);
  if (cur && (cur.loading || Date.now() - cur.at < TTL_MS)) return;
  byBoard.set(boardId, { at: Date.now(), loading: true, map: cur?.map || null });
  const run = async () => {
    const { data, error } = await supabase.rpc('image_seen_for_board', { p_board: boardId });
    const map = new Map();
    for (const r of (error ? null : data) || []) {
      if (r?.card_id && r?.description) map.set(String(r.card_id), String(r.description));
    }
    byBoard.set(boardId, { at: Date.now(), loading: false, map: error ? (cur?.map || null) : map });
    for (const fn of listeners) fn();
  };
  const fail = () => { const b = byBoard.get(boardId); if (b) b.loading = false; };
  const idle = typeof requestIdleCallback === 'function'
    ? (fn) => requestIdleCallback(fn, { timeout: 5000 })
    : (fn) => setTimeout(fn, 1500);
  idle(() => { run().catch(fail); });
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// The card's line, or null. A string snapshot, so a card re-renders only when
// its own line changes.
export function useImageSeen(boardId, cardId) {
  const read = () => (boardId && cardId ? byBoard.get(boardId)?.map?.get(String(cardId)) || null : null);
  return useSyncExternalStore(subscribe, read, () => null);
}
