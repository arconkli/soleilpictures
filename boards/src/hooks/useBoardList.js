// All boards in the workspace, keyed by id. Refreshes on demand AND
// auto-refreshes when Postgres broadcasts a change on the boards
// table for this workspace — without that, a peer creating a new
// board makes everyone else see a "No access" lock card until they
// manually reload, because the local boards map doesn't know the
// new row exists.

import { useCallback, useEffect, useRef, useState } from 'react';
import { listBoards } from '../lib/boardsApi.js';
import { supabase } from '../lib/supabase.js';
import { applyBoardEvents } from '../lib/boardListPatch.js';

export function useBoardList(workspaceId) {
  const [boards, setBoards] = useState({});
  const [loading, setLoading] = useState(true);
  // The map the realtime flush patches against (state is a render behind).
  const boardsRef = useRef(boards);
  boardsRef.current = boards;

  // listBoards() throws on any RLS or network error. Letting that escape left
  // `loading` true forever, and every stale-id cleanup in App.jsx early-returns
  // on boardsLoading — so one failed fetch quietly froze the whole board map.
  // Always clear the flag, the way useSharedBoards already does.
  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    console.log('[boards] refresh start', { workspaceId });
    try {
      const arr = await listBoards(workspaceId);
      const map = {};
      for (const b of arr) map[b.id] = b;
      console.log('[boards] refresh done', { workspaceId, count: arr.length });
      boardsRef.current = map;
      setBoards(map);
    } catch (e) {
      console.error('[boards] refresh failed', e);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Realtime: when boards.* fires for this workspace, update the
  // local map so peers see new boards (and renames / deletes)
  // without a manual reload. Coalesce rapid bursts (e.g. cascaded
  // deletes) into one trailing flush. An UPDATE of a board we hold is
  // patched in place from the event's row — most of them are thumbnail
  // stamps, and refetching every board for each one re-rendered the whole
  // app (PERF-03); anything else still refetches.
  const debounceRef = useRef(null);
  const pendingRef = useRef([]);
  useEffect(() => {
    if (!supabase || !workspaceId) return;
    const flush = () => {
      debounceRef.current = null;
      const batch = pendingRef.current;
      pendingRef.current = [];
      const { next, refresh: needsRefresh } = applyBoardEvents(boardsRef.current, batch, workspaceId);
      if (needsRefresh) { refresh(); return; }
      if (next !== boardsRef.current) { boardsRef.current = next; setBoards(next); }
    };
    const schedule = (payload) => {
      console.log('[boards] realtime event', {
        event: payload?.eventType,
        new: payload?.new && { id: payload.new.id, name: payload.new.name },
        old: payload?.old && { id: payload.old.id },
      });
      pendingRef.current.push(payload);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flush, 350);
    };
    // Per-mount channel name suffix so re-mounts don't collide with a
    // previously-subscribed channel of the same name (Supabase v2
    // dedupes channels by name and `.on()` after subscribe throws).
    const sfx = Math.random().toString(36).slice(2, 9);
    const chanName = `boards-list:${workspaceId}:${sfx}`;
    console.log('[boards] subscribing realtime', { chanName });
    const ch = supabase.channel(chanName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boards', filter: `workspace_id=eq.${workspaceId}` }, schedule)
      .subscribe((status, err) => {
        console.log('[boards] subscribe status', { chanName, status, err });
      });
    return () => {
      console.log('[boards] unsubscribing realtime', { chanName });
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = null;
      pendingRef.current = [];
      try { supabase.removeChannel(ch); } catch (_) {}
    };
  }, [workspaceId, refresh]);

  return { boards, loading, refresh };
}
