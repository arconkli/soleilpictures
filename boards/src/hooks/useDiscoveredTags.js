// AI-discovered tag suggestions: reads named-pending clusters from the
// pending_clusters table and surfaces them in the same { term, items }
// shape that the legacy useSuggestedTags hook used, so the existing
// SidebarTags renderer wires up without changes.
//
// On accept: creates the tag, applies it to the cluster's member cards,
// marks the cluster 'promoted'.
//
// On dismiss: marks the cluster 'dismissed' so we don't surface it again.
// The cluster row stays in the table so re-discovery doesn't re-fire it.

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { ensureTag, tagCard } from '../lib/tagsApi.js';

export function useDiscoveredTags({ workspaceId, userId, onWorkspaceTagsChanged }) {
  const [clusters, setClusters] = useState([]); // [{id, member_card_ids, proposed_name, description, centroid}]

  const refresh = useCallback(async () => {
    if (!workspaceId || !supabase) return;
    const { data, error } = await supabase
      .from('pending_clusters')
      .select('id, member_card_ids, proposed_name, status, named_at')
      .eq('workspace_id', workspaceId)
      .eq('status', 'named')
      .order('named_at', { ascending: false })
      .limit(20);
    if (error) {
      console.warn('[discovered-tags] load failed', error.message);
      return;
    }
    setClusters(data || []);
  }, [workspaceId]);

  // Initial load + subscribe to pending_clusters changes so newly-named
  // clusters show up automatically without a reload.
  useEffect(() => {
    if (!workspaceId || !supabase) return;
    refresh();
    const chId = `discovered-tags-${workspaceId}-${Math.random().toString(36).slice(2, 8)}`;
    const ch = supabase.channel(chId)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'pending_clusters', filter: `workspace_id=eq.${workspaceId}` },
          () => refresh());
    ch.subscribe();
    return () => { try { supabase.removeChannel(ch); } catch {} };
  }, [workspaceId, refresh]);

  // Suggestion shape matches the legacy useSuggestedTags output so the
  // existing SidebarTags renderer can iterate either source.
  const suggestions = clusters.map(c => ({
    term: c.proposed_name,
    items: (c.member_card_ids || []).length,
    boards: 1,
    clusterId: c.id,
    memberCardIds: c.member_card_ids || [],
  }));

  // Accept: create the tag, apply to all member cards, mark cluster promoted.
  const promoteCluster = useCallback(async (clusterId) => {
    if (!workspaceId || !clusterId || !supabase) return;
    const cluster = clusters.find(c => c.id === clusterId);
    if (!cluster || !cluster.proposed_name) return;
    // 1. Create the tag.
    let tag;
    try {
      tag = await ensureTag({
        workspaceId,
        name: cluster.proposed_name,
        kind: 'user',
        createdBy: userId,
      });
    } catch (e) {
      console.warn('[discovered-tags] ensureTag failed', e?.message || e);
      return;
    }
    if (!tag?.id) return;

    // 2. Apply to every member card. We need board_id per card; pull from card_index.
    const cardIds = cluster.member_card_ids || [];
    if (cardIds.length > 0) {
      const { data: idx } = await supabase.from('card_index')
        .select('card_id, board_id')
        .eq('workspace_id', workspaceId)
        .in('card_id', cardIds);
      const boardByCard = new Map((idx || []).map(r => [r.card_id, r.board_id]));
      for (const cardId of cardIds) {
        const boardId = boardByCard.get(cardId);
        if (!boardId) continue;
        try {
          await tagCard({ workspaceId, boardId, cardId, tagId: tag.id, source: 'auto' });
        } catch (e) {
          // 23505 is swallowed inside tagCard; anything else gets logged.
          console.warn('[discovered-tags] tagCard failed', e?.message || e);
        }
      }
    }

    // 3. Mark cluster promoted.
    await supabase.from('pending_clusters')
      .update({ status: 'promoted' })
      .eq('id', clusterId);

    // 4. Refresh the sidebar list + the workspace tags index.
    refresh();
    onWorkspaceTagsChanged?.();
  }, [workspaceId, userId, clusters, refresh, onWorkspaceTagsChanged]);

  // Dismiss: mark the cluster dismissed so we don't keep showing it.
  const dismissCluster = useCallback(async (clusterId) => {
    if (!supabase || !clusterId) return;
    await supabase.from('pending_clusters')
      .update({ status: 'dismissed' })
      .eq('id', clusterId);
    refresh();
  }, [refresh]);

  return { suggestions, promoteCluster, dismissCluster };
}
