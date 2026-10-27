// Workspace-wide tag list + per-board card/board tag associations, with
// realtime subscription so the right-click "Tag" picker shows up-to-date
// suggestions across peers. Returns { tags, loaded, byCard, byBoard, refresh }.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { listWorkspaceTags, listCardTags, listBoardTags, listGroupTags, TAG_LINKS_CHANGED } from '../lib/tagsApi.js';
import { resolveTagColor } from '../lib/tagColor.js';
import { coalesce, touchesAppliedTag } from '../lib/tagSurface.js';

export function useWorkspaceTags({ workspaceId, boardId }) {
  const [tags, setTags] = useState([]);
  const [cardTagRows, setCardTagRows] = useState([]);
  const [boardTagRows, setBoardTagRows] = useState([]);
  const [groupTagRows, setGroupTagRows] = useState([]);
  // True once a fetch has landed, so "this tag isn't in the list" can be
  // told apart from "the list hasn't loaded yet" (App closes the profile of
  // a tag that was deleted or merged away).
  const [loaded, setLoaded] = useState(false);

  // The params the NEXT fetch should use. Read at run time (not closed over)
  // so a fetch that started on the board you just left can tell its rows are
  // stale and drop them instead of painting the old board's chips.
  const paramsRef = useRef({ workspaceId, boardId });
  paramsRef.current = { workspaceId, boardId };

  // One coalesced runner per hook instance. The old boolean guard RETURNED
  // when a fetch was in flight, so the refresh for a board you had just
  // switched to (CanvasSurface isn't keyed by board) or the explicit refresh
  // after removing a chip was simply lost. Now it runs once more afterwards.
  const runnerRef = useRef(null);
  if (!runnerRef.current) {
    runnerRef.current = coalesce(async () => {
      const { workspaceId: ws, boardId: bid } = paramsRef.current;
      if (!ws) return;
      try {
        const [t, c, b, g] = await Promise.all([
          listWorkspaceTags(ws),
          bid ? listCardTags(bid) : Promise.resolve([]),
          bid ? listBoardTags(bid) : Promise.resolve([]),
          bid ? listGroupTags(bid) : Promise.resolve([]),
        ]);
        const now = paramsRef.current;
        // Switched mid-fetch: these rows describe the board we left. The
        // switch's own refresh is already queued behind this run.
        if (now.workspaceId !== ws || now.boardId !== bid) return;
        setTags(t || []);
        setCardTagRows(c || []);
        setBoardTagRows(b || []);
        setGroupTagRows(g || []);
        setLoaded(true);
      } catch (err) {
        console.warn('[tags] refresh failed', err);
      }
    });
  }

  // Identity still changes with the workspace/board so the mount effect below
  // re-fetches on a switch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const refresh = useCallback(() => runnerRef.current(), [workspaceId, boardId]);

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
        // entity_links activity is mention-flavored and irrelevant to the
        // chip rendering. A filtered channel never receives a DELETE (its
        // `old` is only the row id, so it can't match source_workspace):
        // removals come through TAG_LINKS_CHANGED below.
        if (touchesAppliedTag(payload)) refresh();
      })
      .subscribe();
    // This tab's own removals, independent of what realtime delivers.
    document.addEventListener(TAG_LINKS_CHANGED, refresh);
    return () => {
      document.removeEventListener(TAG_LINKS_CHANGED, refresh);
      try { supabase.removeChannel(chan); } catch (_) {}
    };
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

  const byGroup = useMemo(() => {
    const tagById = new Map(tags.map(t => [t.id, t]));
    const m = new Map();
    for (const r of groupTagRows) {
      const tag = tagById.get(r.tag_id);
      if (!tag) continue;
      if (!m.has(r.group_id)) m.set(r.group_id, []);
      m.get(r.group_id).push({ ...tag, source: r.source, color: resolveTagColor(tag) });
    }
    return m;
  }, [tags, groupTagRows]);
  return { tags, loaded, byCard, byBoard, byGroup, refresh };
}
