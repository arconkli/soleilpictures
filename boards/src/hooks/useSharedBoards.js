// Boards the caller has access to via a per-board share but is NOT a
// workspace member of — PLUS every descendant of those boards (0244), so a
// shared production carries its shoot-day clusters with it. Powers the sidebar
// "Shared with me" section (roots only) and the boards map (everything).
//
// Refetches when the caller's user.id changes (login/logout). Consumers
// can call refresh() after sharing/unsharing to update immediately.

import { useEffect, useState, useCallback, useRef } from 'react';
import { listSharedBoards } from '../lib/boardsApi.js';
import { supabase } from '../lib/supabase.js';

export function useSharedBoards(userId) {
  const [shared, setShared] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) { setShared([]); return; }
    setLoading(true);
    try {
      const rows = await listSharedBoards();
      setShared(rows);
    } catch (e) {
      console.warn('[shared-boards] fetch failed', e);
      setShared([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Until now this hook had NO subscription at all — it fetched on mount and
  // then went quiet, so anything the owner changed was invisible to a
  // share-based collaborator until they reloaded. That was survivable when the
  // rows were just board names; it is not once a shared production's calendar
  // is drawn from these rows and a shoot date can move under you.
  //
  // No workspace filter is possible here (shared boards span workspaces by
  // definition), so this listens broadly and leans on Realtime applying RLS
  // per row: the only board events that arrive are ones this user may read.
  // Debounced at 350ms to match useBoardList, since a single move can arrive
  // as several row events.
  const timerRef = useRef(null);
  useEffect(() => {
    if (!supabase || !userId) return undefined;
    const schedule = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { refresh(); }, 350);
    };
    const ch = supabase
      .channel(`shared-boards:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boards' }, schedule)
      .subscribe();
    return () => {
      clearTimeout(timerRef.current);
      try { supabase.removeChannel(ch); } catch (_) {}
    };
  }, [userId, refresh]);

  return { shared, loading, refresh };
}
