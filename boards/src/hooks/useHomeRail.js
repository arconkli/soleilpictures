import { useMemo } from 'react';
import { supabase } from '../lib/supabase.js';
import { pickPresenceColor } from '../lib/presenceColor.js';
import { maskEmail, maskName } from '../lib/captureIdentity.js';
import { itemFromIndexRow } from '../lib/indexRowCard.js';
import { hereNow } from '../lib/homeRail.js';

// Who is on each cluster now (others only, a tab in the background left out),
// for the card of a cluster picked on the files sidebar's Home
// (ClustersHome), shaped from the workspace presence App already holds. Empty
// unless enabled, so the old Home pays nothing for it.
export function useHomeRail({ enabled, selfId, wsPeers, boards }) {
  const hereByBoard = useMemo(() => {
    const map = new Map();
    if (!enabled) return map;
    const peerName = (p) => maskName(p?.user?.name, p?.user?.id) || maskEmail(p?.user?.email, p?.user?.id) || '';
    for (const r of hereNow(wsPeers, boards, { selfId, nameOf: peerName })) {
      const bid = r.loc?.boardId;
      if (!bid) continue;
      if (!map.has(bid)) map.set(bid, []);
      map.get(bid).push({ ...r, color: pickPresenceColor(r.id) });
    }
    return map;
  }, [enabled, wsPeers, boards, selfId]);

  return { hereByBoard };
}

// A cluster's newest photos (its own, not its sub-clusters'), for a picked
// cluster's card: at most three, as R2 keys. Nothing on any failure.
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
