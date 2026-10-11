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
  // True once the first fetch has settled (either way). App prunes its
  // navigation stack of ids it can't find; before this, a reload inside a
  // shared cluster could prune it in the gap between the workspace's own list
  // arriving and this one, and land the user on their root.
  const [loaded, setLoaded] = useState(!userId);

  const refresh = useCallback(async () => {
    if (!userId) { setShared([]); setLoaded(true); return; }
    setLoading(true);
    try {
      const rows = await listSharedBoards();
      setShared(rows);
    } catch (e) {
      // Keep the last good list. A failed refetch (one of the realtime-driven
      // ones, mid-session) used to clear it, so a network blip dropped every
      // shared cluster from the boards map and ejected anyone inside one.
      console.warn('[shared-boards] fetch failed', e);
    } finally {
      setLoading(false);
      setLoaded(true);
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

  return { shared, loading, loaded, refresh };
}
