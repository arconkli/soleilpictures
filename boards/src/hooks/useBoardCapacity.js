// useBoardCapacity — owner-keyed capacity for boards the caller does NOT own.
//
// Owner-pays (migration 0187): the card cap's subject is the board's WORKSPACE
// OWNER, no matter who is editing. useMyTier covers boards the caller owns;
// this hook covers shared boards via the get_board_capacity RPC, which returns
// the owner's live count + effective cap (and is_capped=false for paid/admin
// owners) without leaking the owner's tier string.
//
// The returned api object is REF-STABLE — { get, prime, refetch } never changes
// identity — so it is safe to close over inside the memoized board mutators in
// App.jsx (same reasoning as myTierRef there): a stale closure still reads the
// freshest fetched snapshot through the shared cache.
//
// get(boardId) → { isCapped, used, cap } or null while unknown. Callers treat
// null as uncapped: blocking the add would be worse than letting the server
// card-cap trigger reject the sync (which it does — it is the authority).

import { useCallback, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase.js';

export function useBoardCapacity({ boardIds, isOwned }) {
  const cacheRef = useRef(new Map());    // boardId -> { isCapped, used, cap }
  const inflightRef = useRef(new Set());
  const isOwnedRef = useRef(isOwned);
  isOwnedRef.current = isOwned;

  const fetchCapacity = useCallback(async (boardId, { force = false } = {}) => {
    if (!boardId || !supabase) return;
    if (isOwnedRef.current?.(boardId)) return;   // myTier covers owned boards
    if (!force && (cacheRef.current.has(boardId) || inflightRef.current.has(boardId))) return;
    inflightRef.current.add(boardId);
    try {
      const { data, error } = await supabase.rpc('get_board_capacity', { p_board_id: boardId });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        cacheRef.current.set(boardId, {
          isCapped: Boolean(row.is_capped),
          used: Number(row.used ?? 0),
          cap: Number(row.cap ?? 0),
        });
      }
    } catch (_) {
      // Leave unknown — callers fall back to uncapped; the server trigger
      // is the backstop.
    } finally {
      inflightRef.current.delete(boardId);
    }
  }, []);

  const apiRef = useRef(null);
  if (!apiRef.current) {
    apiRef.current = {
      get: (boardId) => cacheRef.current.get(boardId) || null,
      prime: (boardId) => fetchCapacity(boardId),
      refetch: (boardId) => fetchCapacity(boardId, { force: true }),
    };
  }

  // Prime capacity for the active board(s) whenever they change.
  const key = (boardIds || []).filter(Boolean).join('|');
  useEffect(() => {
    for (const id of (boardIds || [])) if (id) fetchCapacity(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fetchCapacity]);

  // Refetch on focus — the owner may have upgraded or cleared space, same
  // cadence as useMyTier's focus refetch.
  useEffect(() => {
    const onFocus = () => {
      for (const id of (boardIds || [])) {
        if (id && cacheRef.current.has(id)) fetchCapacity(id, { force: true });
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fetchCapacity]);

  return apiRef.current;
}
