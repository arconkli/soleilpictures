import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import * as userProfiles from '../lib/userProfiles.js';
import { pickPresenceColor } from '../lib/presenceColor.js';
import { maskEmail, maskName } from '../lib/captureIdentity.js';
import { itemFromIndexRow } from '../lib/indexRowCard.js';
import { railConversations, hereNow } from '../lib/homeRail.js';

// What the files sidebar's Home (ClustersHome) shows beside the clusters,
// shaped from what App already holds: the newest conversations, who is in the
// workspace now and where, and who is on each cluster. Off (empty) unless
// enabled, so the old Home pays nothing for it.
export function useHomeRail({ enabled, conversationList, selfId, wsPeers, boards }) {
  // Names arrive as the profile cache fills; redraw when it does.
  const [tick, setTick] = useState(0);
  useEffect(() => (enabled ? userProfiles.subscribe(() => setTick(n => (n + 1) | 0)) : undefined), [enabled]);

  // useConversationList hands back a new object every render; its parts are
  // stable (state and memos), so the rows are keyed on those.
  const { conversations: convRows, participantsByConv, myStateByConv, unreadByConv } = conversationList || {};
  const conversations = useMemo(() => {
    if (!enabled) return [];
    const label = (id) => userProfiles.get(id)?.name || userProfiles.get(id)?.email || '';
    return railConversations({ conversations: convRows, participantsByConv, myStateByConv, unreadByConv }, {
      selfId,
      nameOf: label,
      colorOf: (id) => userProfiles.get(id)?.color || pickPresenceColor(id || ''),
    });
    // tick: a name arrived in the cache, so the rows are read again.
  }, [enabled, convRows, participantsByConv, myStateByConv, unreadByConv, selfId, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ask once for the names of the people in the conversations shown — keyed
  // on who they are, not on the rows, which a name arriving rebuilds (a
  // failed profile read still notifies, and keying on the rows looped).
  const peopleKey = useMemo(() => {
    const ids = new Set();
    for (const row of conversations) {
      for (const p of participantsByConv?.get(row.id) || []) if (p.user_id !== selfId) ids.add(p.user_id);
    }
    return [...ids].sort().join(',');
  }, [conversations, participantsByConv, selfId]);
  useEffect(() => {
    if (!enabled || !peopleKey) return;
    for (const id of peopleKey.split(',')) userProfiles.resolve(id);
  }, [enabled, peopleKey]);

  const peerName = (p) => maskName(p?.user?.name, p?.user?.id) || maskEmail(p?.user?.email, p?.user?.id) || '';

  const herePeople = useMemo(() => (enabled
    ? hereNow(wsPeers, boards, { selfId, nameOf: peerName }).map(r => ({ ...r, color: pickPresenceColor(r.id) }))
    : []), [enabled, wsPeers, boards, selfId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Who is on each cluster now (others only), for the pick-up card.
  const hereByBoard = useMemo(() => {
    const map = new Map();
    if (!enabled) return map;
    for (const r of herePeople) {
      const bid = r.loc?.boardId;
      if (!bid) continue;
      if (!map.has(bid)) map.set(bid, []);
      map.get(bid).push(r);
    }
    return map;
  }, [enabled, herePeople]);

  return { conversations, herePeople, hereByBoard };
}

// A cluster's newest photos (its own, not its sub-clusters'), for the
// pick-up card's collage: at most three, as R2 keys. Nothing on any failure.
export async function loadClusterPhotos(boardId) {
  if (!supabase || !boardId) return [];
  try {
    const { data, error } = await supabase.rpc('sidebar_cluster_items', {
      p_board_id: boardId, p_shelf: 'photos', p_sort: 'newest', p_offset: 0, p_limit: 3,
    });
    if (error || !Array.isArray(data)) return [];
    return data
      .map((r) => itemFromIndexRow(r, boardId))
      .filter(Boolean)
      .map((it) => ({ id: it.cardId, src: it.meta?.src || null }))
      .filter((p) => p.src);
  } catch (_) {
    return [];
  }
}
