// Workspace-wide tag list + per-board card/board tag associations, with
// realtime subscription so the right-click "Tag" picker shows up-to-date
// suggestions across peers. Returns { tags, byCard, byBoard, refresh }.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { listWorkspaceTags, listCardTags, listBoardTags } from '../lib/tagsApi.js';
import { resolveTagColor } from '../lib/tagColor.js';

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
    // After unification (migration 0036), tag applications live in
    // entity_links. We still listen to `tags` itself for definition
    // changes (rename / recolor / new tag), and to entity_links
    // for application changes. The publication-level filter is
    // workspace-scoped via source_workspace.
    const chan = supabase.channel(`tags:${workspaceId}:${sfx}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'tags',
        filter: `workspace_id=eq.${workspaceId}`,
      }, () => refresh())
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'entity_links',
        filter: `source_workspace=eq.${workspaceId}`,
      }, (payload) => {
        // Only re-fetch when the change touches an applied tag — most
        // entity_links activity is mention-flavored and irrelevant
        // to the chip rendering. Realtime payloads include both
        // old + new, so check both.
        const n = payload?.new || {};
        const o = payload?.old || {};
        if ((n.target_kind === 'tag' && n.link_kind === 'applied')
         || (o.target_kind === 'tag' && o.link_kind === 'applied')) {
          refresh();
        }
      })
      .subscribe();
    return () => { try { supabase.removeChannel(chan); } catch (_) {} };
  }, [workspaceId, refresh]);

  // Memoize the derived Maps. Without this, byCard / byBoard get
  // re-instantiated on every render — and any consumer effect with
  // them in its dep array re-runs continuously, blowing away
  // setTimeout-based debounces (notably the autotag scoring loop in
  // CanvasSurface). Was the actual root cause of "I made a tag but
  // nothing got auto-tagged."
  const byCard = useMemo(() => {
    const tagById = new Map(tags.map(t => [t.id, t]));
    const m = new Map();
    for (const r of cardTagRows) {
      const tag = tagById.get(r.tag_id);
      if (!tag) continue;
      if (!m.has(r.card_id)) m.set(r.card_id, []);
      // Resolve the display color HERE so canvas chips (which render
      // {tag}.color directly) match the deterministic hue every other
      // surface uses — uncolored tags were falling back to a hardcoded blue.
      m.get(r.card_id).push({ ...tag, source: r.source, color: resolveTagColor(tag) });
    }
    return m;
  }, [tags, cardTagRows]);

  const byBoard = useMemo(() => {
    const tagById = new Map(tags.map(t => [t.id, t]));
    const m = new Map();
    for (const r of boardTagRows) {
      const tag = tagById.get(r.tag_id);
      if (!tag) continue;
      if (!m.has(r.board_id)) m.set(r.board_id, []);
      m.get(r.board_id).push({ ...tag, source: r.source, color: resolveTagColor(tag) });
    }
    return m;
  }, [tags, boardTagRows]);

  return { tags, byCard, byBoard, refresh };
}
