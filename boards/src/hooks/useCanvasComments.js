// Live comments for a single board: list + realtime add/update/delete.
// Mirrors the boards-list / card-index hooks — Supabase v2 dedupe gotcha
// is handled with a per-mount random suffix on the channel name.
//
// Returns { comments, loading, loaded, failed, removeLocally, upsertLocally, viewsByRootId, markViewed }
// so callers can drop a comment from local state immediately on delete
// (the realtime DELETE event ALSO fires and refetches, but doing both
// gives instant feedback regardless of channel lag), and so the canvas
// can render an unread-reply dot per top-level comment.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { listComments, listMyCommentViews, markCommentViewed } from '../lib/commentsApi.js';
import { createRefetchQueue } from '../lib/refetchQueue.js';
import { mergeViews, viewedStamp } from '../lib/commentCanvas.js';

const FIRST_LOAD_RETRY_MS = [2000, 5000, 15000];

// `enabled: false` skips the list fetches and the realtime channel entirely.
// The signed-out public viewer can't read comments (RLS returns nothing), so
// for it the queries and the socket were pure overhead on every /c/ view.
export function useCanvasComments(rawBoardId, { enabled = true } = {}) {
  const boardId = enabled ? rawBoardId : null;
  const [comments, setComments] = useState([]);
  const [loading, setLoading]   = useState(false);
  // The cluster whose first list has come back (a comment link waits for it).
  const [loadedFor, setLoadedFor] = useState(null);
  // The cluster whose first list could not be had after every try.
  const [failedFor, setFailedFor] = useState(null);
  const firstLoadRef = useRef(null);
  const [viewsByRootId, setViewsByRootId] = useState(new Map());
  // The cluster whose "when I last looked" times have come back. Until they
  // have, nothing is called unread: an empty answer-in-waiting would mark
  // every conversation someone else wrote in. A fetch that fails leaves it
  // so (no dots), as before.
  const [viewsFor, setViewsFor] = useState(null);

  useEffect(() => {
    // Clear on every boardId change — not just the falsy case. Otherwise
    // switching board A → board B keeps A's comments rendered until
    // listComments(B) resolves, which is the "comments flash for a sec
    // before disappearing" bug on board navigation.
    setComments([]);
    setViewsByRootId(new Map());
    setViewsFor(null);
    firstLoadRef.current = null;
    if (!boardId) return;
    let cancelled = false;
    setLoading(true);
    // The first list, once it has really come back: only then is the cluster
    // `loaded`. A fetch that failed leaves it not loaded, and hands this to
    // the refetch below (back online, the tab looked at again, the socket
    // back), whose first answer finishes the load.
    const finish = (rows) => {
        if (cancelled) return;
        setComments(rows);
        setLoadedFor(boardId);
        setFailedFor(null);
        // Pull view-state for the roots we just loaded. Fire-and-forget
        // — if it fails we just render no dots (graceful degrade).
        const rootIds = rows.filter(r => !r.reply_to).map(r => r.id);
        if (rootIds.length === 0) {
          setViewsFor(boardId);
          return;
        }
        listMyCommentViews(rootIds)
          .then(m => {
            if (cancelled) return;
            // A conversation opened before this answer (a comment link, a
            // quick press) keeps its mark: the later time per conversation.
            setViewsByRootId(prev => mergeViews(m, prev));
            setViewsFor(boardId);
          })
          .catch(err => console.warn('[comments] views load failed', err));
    };
    // A first list that fails for a reason those never fix (a server error)
    // is asked for again after 2, 5 and 15 seconds; after the last one the
    // comments are `failed`, which the island's list says in a quiet line.
    let tries = 0;
    let timer = null;
    const load = () => listComments(boardId)
      .then(finish, err => {
        console.warn('[comments] list failed', err);
        if (cancelled) return;
        firstLoadRef.current = finish;
        if (tries < FIRST_LOAD_RETRY_MS.length) {
          timer = setTimeout(() => { if (!cancelled && firstLoadRef.current === finish) load(); }, FIRST_LOAD_RETRY_MS[tries]);
          tries += 1;
        } else setFailedFor(boardId);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    load();
    return () => { cancelled = true; clearTimeout(timer); firstLoadRef.current = null; };
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
      (rows) => {
        // a first load that failed is finished by this answer
        const first = firstLoadRef.current;
        firstLoadRef.current = null;
        if (first) first(rows); else setComments(rows);
      },
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
        // covered by the initial load above, unless that load failed.
        if (status !== 'SUBSCRIBED') return;
        if (subscribedOnce || firstLoadRef.current) queue.request();
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
  //
  // `newestMs`: the newest row in the thread. The look is dated now, and
  // never before that row (viewedStamp): this device's clock may run behind
  // the server's, and a reply read while the thread is open must stay read.
  const markViewed = useCallback((rootCommentId, newestMs = null) => {
    if (!rootCommentId) return;
    const atIso = new Date(viewedStamp(Date.now(), newestMs)).toISOString();
    setViewsByRootId(prev => mergeViews(prev, new Map([[rootCommentId, atIso]])));
    markCommentViewed(rootCommentId, atIso).catch(err => {
      console.warn('[comments] markViewed failed', err);
    });
  }, []);

  return {
    comments, loading, loaded: !!boardId && loadedFor === boardId,
    failed: !!boardId && failedFor === boardId && loadedFor !== boardId,
    removeLocally, removeByAnchorIds, upsertLocally,
    // null until the views are in: nothing reads as unread before then
    viewsByRootId: boardId && viewsFor === boardId ? viewsByRootId : null,
    markViewed,
  };
}
