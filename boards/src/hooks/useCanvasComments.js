// Live comments for a single board: list + realtime add/update/delete.
// Mirrors the boards-list / card-index hooks — Supabase v2 dedupe gotcha
// is handled with a per-mount random suffix on the channel name.
//
// Returns { comments, loading, removeLocally } so callers can drop a
// comment from local state immediately on delete (the realtime DELETE
// event ALSO fires and refetches, but doing both gives instant feedback
// regardless of channel lag).

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { listComments } from '../lib/commentsApi.js';

export function useCanvasComments(boardId) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading]   = useState(false);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (!boardId) { setComments([]); return; }
    let cancelled = false;
    setLoading(true);
    listComments(boardId)
      .then(rows => { if (!cancelled) setComments(rows); })
      .catch(err => { console.warn('[comments] list failed', err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [boardId]);

  useEffect(() => {
    if (!boardId) return;
    // Per-mount suffix avoids "cannot add postgres_changes callbacks
    // after subscribe()" on remount.
    const sfx = Math.random().toString(36).slice(2, 9);
    const chan = supabase.channel(`comments:${boardId}:${sfx}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'comments',
        filter: `board_id=eq.${boardId}`,
      }, (payload) => {
        // Cheap path: refetch the whole list. Comments are O(dozens) per
        // board, so a refetch is fine and avoids the eventual-consistency
        // bugs that show up with optimistic in-place edits.
        if (reloadingRef.current) return;
        reloadingRef.current = true;
        listComments(boardId)
          .then(rows => setComments(rows))
          .catch(() => {})
          .finally(() => { reloadingRef.current = false; });
      })
      .subscribe();
    return () => { try { supabase.removeChannel(chan); } catch (_) {} };
  }, [boardId]);

  // Drop a comment (and any of its replies) from local state immediately.
  // Used right after a successful deleteComment() call so the bubble
  // disappears without waiting for the realtime round-trip.
  const removeLocally = useCallback((commentId) => {
    if (!commentId) return;
    setComments(rows => rows.filter(r => r.id !== commentId && r.reply_to !== commentId));
  }, []);

  return { comments, loading, removeLocally };
}
