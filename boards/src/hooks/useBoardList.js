// All boards in the workspace, keyed by id. Refreshes on demand AND
// auto-refreshes when Postgres broadcasts a change on the boards
// table for this workspace — without that, a peer creating a new
// board makes everyone else see a "No access" lock card until they
// manually reload, because the local boards map doesn't know the
// new row exists.

import { useCallback, useEffect, useRef, useState } from 'react';
import { listBoards } from '../lib/boardsApi.js';
import { supabase } from '../lib/supabase.js';

export function useBoardList(workspaceId) {
  const [boards, setBoards] = useState({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    console.log('[boards] refresh start', { workspaceId });
    const arr = await listBoards(workspaceId);
    const map = {};
    for (const b of arr) map[b.id] = b;
    console.log('[boards] refresh done', { workspaceId, count: arr.length, ids: arr.map(b => b.id) });
    setBoards(map);
    setLoading(false);
  }, [workspaceId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Realtime: when boards.* fires for this workspace, refresh the
  // local map so peers see new boards (and renames / deletes)
  // without a manual reload. Coalesce rapid bursts (e.g. cascaded
  // deletes) into one trailing refresh.
  const debounceRef = useRef(null);
  useEffect(() => {
    if (!supabase || !workspaceId) return;
    const schedule = (payload) => {
      console.log('[boards] realtime event', {
        event: payload?.eventType,
        new: payload?.new && { id: payload.new.id, name: payload.new.name },
        old: payload?.old && { id: payload.old.id },
      });
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => { debounceRef.current = null; refresh(); }, 350);
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
      try { supabase.removeChannel(ch); } catch (_) {}
    };
  }, [workspaceId, refresh]);

  return { boards, loading, refresh };
}
