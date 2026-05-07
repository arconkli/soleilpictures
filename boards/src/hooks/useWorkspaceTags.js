// Workspace-wide tag list + per-board card/board tag associations, with
// realtime subscription so the right-click "Tag" picker shows up-to-date
// suggestions across peers. Returns { tags, byCard, byBoard, refresh }.

import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { listWorkspaceTags, listCardTags, listBoardTags } from '../lib/tagsApi.js';

export function useWorkspaceTags({ workspaceId, boardId }) {
  const [tags, setTags] = useState([]);
  const [cardTagRows, setCardTagRows] = useState([]);
  const [boardTagRows, setBoardTagRows] = useState([]);
  const reloadRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    if (reloadRef.current) return;
    reloadRef.current = true;
    try {
      const [t, c, b] = await Promise.all([
        listWorkspaceTags(workspaceId),
        boardId ? listCardTags(boardId) : Promise.resolve([]),
        boardId ? listBoardTags(boardId) : Promise.resolve([]),
      ]);
      setTags(t || []);
      setCardTagRows(c || []);
      setBoardTagRows(b || []);
    } catch (err) {
      console.warn('[tags] refresh failed', err);
    } finally {
      reloadRef.current = false;
    }
  }, [workspaceId, boardId]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (!workspaceId) return;
    const sfx = Math.random().toString(36).slice(2, 9);
    const chan = supabase.channel(`tags:${workspaceId}:${sfx}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'tags',
        filter: `workspace_id=eq.${workspaceId}`,
      }, () => refresh())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'card_tags',
        filter: `workspace_id=eq.${workspaceId}`,
      }, () => refresh())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'board_tags',
        filter: `workspace_id=eq.${workspaceId}`,
      }, () => refresh())
      .subscribe();
    return () => { try { supabase.removeChannel(chan); } catch (_) {} };
  }, [workspaceId, refresh]);

  // byCard: cardId -> [tag, ...]
  const tagById = new Map(tags.map(t => [t.id, t]));
  const byCard = new Map();
  for (const r of cardTagRows) {
    const tag = tagById.get(r.tag_id);
    if (!tag) continue;
    if (!byCard.has(r.card_id)) byCard.set(r.card_id, []);
    byCard.get(r.card_id).push({ ...tag, source: r.source });
  }
  const byBoard = new Map();
  for (const r of boardTagRows) {
    const tag = tagById.get(r.tag_id);
    if (!tag) continue;
    if (!byBoard.has(r.board_id)) byBoard.set(r.board_id, []);
    byBoard.get(r.board_id).push({ ...tag, source: r.source });
  }

  return { tags, byCard, byBoard, refresh };
}
