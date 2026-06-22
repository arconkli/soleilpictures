// Live vote cards for a single board: list (with derived counts + my_value)
// + realtime. Mirrors useCanvasComments, but subscribes to TWO tables —
// vote_cards (the cards themselves) and vote_card_ballots (individual
// up/down votes) — because a vote/un-vote changes counts without touching
// the vote_cards row. Both tables carry board_id so the channel can filter
// by it; any change triggers the same cheap full-refetch (votes are
// O(dozens) per board, so refetch beats optimistic count reconciliation).
//
// Returns { voteCards, loading, removeLocally } so callers can drop a card
// from local state immediately on delete (the realtime DELETE also fires).

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { listVoteCards } from '../lib/voteCardsApi.js';

export function useVoteCards(boardId) {
  const [voteCards, setVoteCards] = useState([]);
  const [loading, setLoading]     = useState(false);
  const reloadingRef = useRef(false);

  useEffect(() => {
    // Clear on every boardId change so board A's votes don't linger while
    // board B loads (same rationale as useCanvasComments).
    setVoteCards([]);
    if (!boardId) return;
    let cancelled = false;
    setLoading(true);
    listVoteCards(boardId)
      .then(rows => { if (!cancelled) setVoteCards(rows); })
      .catch(err => { console.warn('[votes] list failed', err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [boardId]);

  useEffect(() => {
    if (!boardId) return;
    const refetch = () => {
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      listVoteCards(boardId)
        .then(rows => setVoteCards(rows))
        .catch(() => {})
        .finally(() => { reloadingRef.current = false; });
    };
    // Per-mount suffix avoids "cannot add postgres_changes callbacks after
    // subscribe()" on remount. One channel, two table subscriptions.
    const sfx = Math.random().toString(36).slice(2, 9);
    const chan = supabase.channel(`votes:${boardId}:${sfx}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'vote_cards',
        filter: `board_id=eq.${boardId}`,
      }, refetch)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'vote_card_ballots',
        filter: `board_id=eq.${boardId}`,
      }, refetch)
      .subscribe();
    return () => { try { supabase.removeChannel(chan); } catch (_) {} };
  }, [boardId]);

  // Drop a vote card from local state immediately after a successful delete,
  // without waiting for the realtime round-trip.
  const removeLocally = useCallback((id) => {
    if (!id) return;
    setVoteCards(rows => rows.filter(r => r.id !== id));
  }, []);

  return { voteCards, loading, removeLocally };
}
