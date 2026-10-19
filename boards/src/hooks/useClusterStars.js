import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { STARS_CHANGED, announceStars } from '../lib/starsChanged.js';

// Which clusters are starred, and a toggle, for the card of a cluster picked
// on Home (the files sidebar's Home, preview only). Read from the RPC the
// sidebar's Starred list reads (0420's sidebar_starred: a cluster's star is a
// row of kind 'cluster'), written the way the sidebar writes it, and the two
// keep each other current through STARS_CHANGED. Reads nothing unless enabled.
export function useClusterStars(workspaceId, { enabled = false } = {}) {
  const [ids, setIds] = useState(() => new Set());
  // What's starred as of the last change, for a toggle that comes before the
  // re-render (two quick presses must not both insert).
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const load = useCallback(async () => {
    if (!enabled || !supabase || !workspaceId) return;
    const { data, error } = await supabase.rpc('sidebar_starred', { p_workspace_id: workspaceId });
    if (error || !Array.isArray(data)) return;
    setIds(new Set(data.filter((r) => r.kind === 'cluster').map((r) => r.board_id)));
  }, [enabled, workspaceId]);

  useEffect(() => { setIds(new Set()); load(); }, [load]);
  useEffect(() => {
    if (!enabled) return undefined;
    const onChanged = (e) => { if (e?.detail?.from !== 'home') load(); };
    window.addEventListener(STARS_CHANGED, onChanged);
    return () => window.removeEventListener(STARS_CHANGED, onChanged);
  }, [enabled, load]);

  const isStarred = useCallback((boardId) => ids.has(boardId), [ids]);
  const toggle = useCallback(async (boardId) => {
    if (!supabase || !workspaceId || !boardId) return;
    const on = !idsRef.current.has(boardId);
    const next = new Set(idsRef.current);
    if (on) next.add(boardId); else next.delete(boardId);
    idsRef.current = next;
    setIds(next);
    const { error } = on
      ? await supabase.from('starred_items').insert({ workspace_id: workspaceId, board_id: boardId, card_id: '' })
      : await supabase.from('starred_items').delete().eq('workspace_id', workspaceId).eq('board_id', boardId).eq('card_id', '');
    if (error) {
      console.warn('[home] star', error.message || error);
      load();
      return;
    }
    announceStars('home');
  }, [workspaceId, load]);

  return { isStarred, toggle };
}
