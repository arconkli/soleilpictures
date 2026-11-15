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
//
// The same read's keywords are kept too, for the day-one welcome back's news
// (App.jsx, lib/placeHeld.js searchNews), which reads them now, not when idle.

import { useSyncExternalStore } from 'react';
import { supabase } from './supabase.js';

const TTL_MS = 10 * 60 * 1000;
const byBoard = new Map();   // boardId → { at, loading, map: Map<cardId, text> | null, rows }
const listeners = new Set();

// One read's rows into the cache: each card's line, and its keywords as rows.
function keep(boardId, data) {
  const map = new Map();
  const rows = [];
  for (const r of data || []) {
    if (!r?.card_id) continue;
    rows.push({ card_id: String(r.card_id), keywords: Array.isArray(r.keywords) ? r.keywords : [] });
    if (r.description) map.set(String(r.card_id), String(r.description));
  }
  byBoard.set(boardId, { at: Date.now(), loading: false, map, rows });
  for (const fn of listeners) fn();
  return rows;
}

export function primeImageSeen(boardId) {
  if (!supabase || !boardId) return;
  const cur = byBoard.get(boardId);
  if (cur && (cur.loading || Date.now() - cur.at < TTL_MS)) return;
  byBoard.set(boardId, { at: Date.now(), loading: true, map: cur?.map || null });
  const run = async () => {
    const { data, error } = await supabase.rpc('image_seen_for_board', { p_board: boardId });
    if (!error) { keep(boardId, data); return; }
    byBoard.set(boardId, { at: Date.now(), loading: false, map: cur?.map || null, rows: cur?.rows || null });
    for (const fn of listeners) fn();
  };
  const fail = () => { const b = byBoard.get(boardId); if (b) b.loading = false; };
  const idle = typeof requestIdleCallback === 'function'
    ? (fn) => requestIdleCallback(fn, { timeout: 5000 })
    : (fn) => setTimeout(fn, 1500);
  idle(() => { run().catch(fail); });
}

// The cluster's rows ([{ card_id, keywords }]) now: from the cache while it is
// fresh, else read at once. Null on any failure; never throws.
export async function readImageSeenNow(boardId) {
  if (!supabase || !boardId) return null;
  const cur = byBoard.get(boardId);
  if (cur?.rows && Date.now() - cur.at < TTL_MS) return cur.rows;
  try {
    const { data, error } = await supabase.rpc('image_seen_for_board', { p_board: boardId });
    return error ? null : keep(boardId, data);
  } catch (_) {
    return null;
  }
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// The card's line, or null. A string snapshot, so a card re-renders only when
// its own line changes.
export function useImageSeen(boardId, cardId) {
  const read = () => (boardId && cardId ? byBoard.get(boardId)?.map?.get(String(cardId)) || null : null);
  return useSyncExternalStore(subscribe, read, () => null);
}
