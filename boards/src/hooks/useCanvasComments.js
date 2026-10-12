// Live comments for a single board: list + realtime add/update/delete.
// Mirrors the boards-list / card-index hooks — Supabase v2 dedupe gotcha
// is handled with a per-mount random suffix on the channel name.
//
// Returns { comments, loading, removeLocally, upsertLocally, viewsByRootId, markViewed }
// so callers can drop a comment from local state immediately on delete
// (the realtime DELETE event ALSO fires and refetches, but doing both
// gives instant feedback regardless of channel lag), and so the canvas
// can render an unread-reply dot per top-level comment.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { listComments, listMyCommentViews, markCommentViewed } from '../lib/commentsApi.js';
import { createRefetchQueue } from '../lib/refetchQueue.js';

// `enabled: false` skips the list fetches and the realtime channel entirely.
// The signed-out public viewer can't read comments (RLS returns nothing), so
// for it the queries and the socket were pure overhead on every /c/ view.
export function useCanvasComments(rawBoardId, { enabled = true } = {}) {
  const boardId = enabled ? rawBoardId : null;
  const [comments, setComments] = useState([]);
  const [loading, setLoading]   = useState(false);
  const [viewsByRootId, setViewsByRootId] = useState(new Map());

  useEffect(() => {
    // Clear on every boardId change — not just the falsy case. Otherwise
    // switching board A → board B keeps A's comments rendered until
    // listComments(B) resolves, which is the "comments flash for a sec
    // before disappearing" bug on board navigation.
    setComments([]);
    setViewsByRootId(new Map());
    if (!boardId) return;
    let cancelled = false;
    setLoading(true);
    listComments(boardId)
      .then(rows => {
        if (cancelled) return;
        setComments(rows);
        // Pull view-state for the roots we just loaded. Fire-and-forget
        // — if it fails we just render no dots (graceful degrade).
        const rootIds = rows.filter(r => !r.reply_to).map(r => r.id);
        if (rootIds.length === 0) {
          setViewsByRootId(new Map());
          return;
        }
        listMyCommentViews(rootIds)
          .then(m => { if (!cancelled) setViewsByRootId(m); })
          .catch(err => console.warn('[comments] views load failed', err));
      })
      .catch(err => { console.warn('[comments] list failed', err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [boardId]);

  useEffect(() => {
    if (!boardId) return;
    // Cheap path: refetch the whole list. Comments are O(dozens) per
    // board, so a refetch is fine and avoids the eventual-consistency
    // bugs that show up with optimistic in-place edits.
    //
    // One queue per board (per effect run): an event that lands mid-refetch
    // gets a trailing refetch instead of being dropped, and a result that
    // arrives after the board changed is never applied (lib/refetchQueue.js).
    const queue = createRefetchQueue(
      () => listComments(boardId),
      (rows) => setComments(rows),
      (err) => console.warn('[comments] refetch failed', err),
    );
    // Per-mount suffix avoids "cannot add postgres_changes callbacks
    // after subscribe()" on remount.
    const sfx = Math.random().toString(36).slice(2, 9);
    let subscribedOnce = false;
    const chan = supabase.channel(`comments:${boardId}:${sfx}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'comments',
        filter: `board_id=eq.${boardId}`,
      }, () => queue.request())
      .subscribe((status) => {
        // Events missed while the socket was down are gone for good, so a
        // re-subscribe catches up with one refetch. The first SUBSCRIBED is
        // covered by the initial load above.
        if (status !== 'SUBSCRIBED') return;
        if (subscribedOnce) queue.request();
        subscribedOnce = true;
      });
    // Same for a tab that slept or a laptop that went offline.
    const onVisible = () => { if (document.visibilityState === 'visible') queue.request(); };
    const onOnline = () => queue.request();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      queue.stop();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      try { supabase.removeChannel(chan); } catch (_) {}
    };
  }, [boardId]);

  // Put a row this client just wrote into the list without waiting for the
  // realtime round trip, which is the only other way a new comment appears.
  // The next refetch replaces it with the server's copy.
  const upsertLocally = useCallback((row) => {
    if (!row?.id) return;
    setComments(rows => (rows.some(r => r.id === row.id)
      ? rows.map(r => (r.id === row.id ? { ...r, ...row } : r))
      : [...rows, row]));
  }, []);

  // Drop a comment (and any of its replies) from local state immediately.
  // Used right after a successful deleteComment() call so the bubble
  // disappears without waiting for the realtime round-trip.
  const removeLocally = useCallback((commentId) => {
    if (!commentId) return;
    setComments(rows => rows.filter(r => r.id !== commentId && r.reply_to !== commentId));
  }, []);

  // Drop every comment (and replies) anchored to one of the given
  // ids. Used by the cross-board-move flow: when cards leave for a
  // new board, we want their comments to disappear from THIS board's
  // canvas immediately, not wait for the supabase realtime push to
  // catch up — otherwise the bubbles ghost-render against the empty
  // space the cards left behind.
  const removeByAnchorIds = useCallback((anchorIds) => {
    if (!anchorIds?.length) return;
    const set = new Set(anchorIds);
    setComments(rows => rows.filter(r => !set.has(r.anchor_id)));
  }, []);

  // Mark a thread viewed: optimistically advance the local map (so the
  // dot disappears the moment the user clicks the bubble) and fire the
  // upsert in the background. No rollback on failure — this is a
  // "seen" flag, not load-bearing state; the next page load just
  // shows the dot again, which is fine.
  const markViewed = useCallback((rootCommentId) => {
    if (!rootCommentId) return;
    const nowIso = new Date().toISOString();
    setViewsByRootId(prev => {
      const next = new Map(prev);
      next.set(rootCommentId, nowIso);
      return next;
    });
    markCommentViewed(rootCommentId).catch(err => {
      console.warn('[comments] markViewed failed', err);
    });
  }, []);

  return {
    comments, loading,
    removeLocally, removeByAnchorIds, upsertLocally,
    viewsByRootId, markViewed,
  };
}
