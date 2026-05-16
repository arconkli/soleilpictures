// AI-discovered tag suggestions: reads named-pending clusters from the
// pending_clusters table and surfaces them in the same { term, items }
// shape that the legacy useSuggestedTags hook used, so the existing
// SidebarTags renderer wires up without changes.
//
// Two clusters of related cards can independently be named the same (or
// near-same) thing by the LLM. We collapse them at read time so the user
// sees one row per concept; accepting that row promotes every underlying
// cluster, dismissing dismisses every underlying cluster. Each suggestion
// therefore carries a `clusterIds: string[]` (not a single `clusterId`).
//
// We also filter out any cluster whose name matches an existing workspace
// tag — the AI shouldn't be suggesting a tag the user already has.
//
// On accept: creates the tag, applies it to every cluster's member cards,
// marks all underlying clusters 'promoted'.
//
// On dismiss: marks every underlying cluster 'dismissed' so we don't
// surface them again. The rows stay in the table so re-discovery doesn't
// re-fire them.

import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { ensureTag, tagCard } from '../lib/tagsApi.js';
import { namesAreSimilar, normalizeName } from '../lib/stringSim.js';

export function useDiscoveredTags({ workspaceId, userId, existingTagSlugs = [], onWorkspaceTagsChanged }) {
  const [clusters, setClusters] = useState([]); // [{id, member_card_ids, proposed_name, named_at}]

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

  // Memoize to keep the existing-name set stable across renders (callers
  // pass a fresh array each render even when the contents are the same).
  const existingNormalized = useMemo(() => {
    const out = [];
    for (const s of existingTagSlugs || []) {
      const n = normalizeName(s);
      if (n) out.push(n);
    }
    return out;
  }, [existingTagSlugs]);

  // Suggestion shape matches the legacy useSuggestedTags output so the
  // existing SidebarTags renderer can iterate either source.
  const suggestions = useMemo(() => {
    // Step 1: drop clusters whose name collides with an existing tag.
    const eligible = [];
    for (const c of clusters) {
      const name = (c.proposed_name || '').trim();
      if (!name) continue;
      let collides = false;
      for (const e of existingNormalized) {
        if (namesAreSimilar(name, e)) { collides = true; break; }
      }
      if (!collides) eligible.push(c);
    }

    // Step 2: stronger clusters win — they keep their name when a weaker
    // sibling folds in. Sort by member count desc, then by name length asc
    // (shorter / more general names preferred for ties), then by named_at desc.
    const ordered = [...eligible].sort((a, b) => {
      const ac = (a.member_card_ids || []).length;
      const bc = (b.member_card_ids || []).length;
      if (bc !== ac) return bc - ac;
      const al = (a.proposed_name || '').length;
      const bl = (b.proposed_name || '').length;
      if (al !== bl) return al - bl;
      return new Date(b.named_at || 0) - new Date(a.named_at || 0);
    });

    // Step 3: walk in order, folding similar names into the existing group.
    const groups = []; // { term, items: Set<cardId>, clusterIds: [] }
    for (const c of ordered) {
      const name = c.proposed_name;
      const memberIds = c.member_card_ids || [];
      let folded = false;
      for (const g of groups) {
        const kind = namesAreSimilar(g.term, name);
        if (!kind) continue;
        for (const id of memberIds) g.items.add(id);
        g.clusterIds.push(c.id);
        // If the new cluster has a shorter name that's a substring of the
        // rep, swap the rep to the more general label.
        if (kind === 'substring' && name.length < g.term.length) {
          g.term = name;
        }
        folded = true;
        break;
      }
      if (!folded) {
        groups.push({
          term: name,
          items: new Set(memberIds),
          clusterIds: [c.id],
        });
      }
    }

    return groups.map(g => ({
      term: g.term,
      items: g.items.size,
      boards: 1,
      clusterIds: g.clusterIds,
      memberCardIds: Array.from(g.items),
    }));
  }, [clusters, existingNormalized]);

  // Accept: create the tag, apply to every member card across all underlying
  // clusters, mark every underlying cluster promoted.
  const promoteCluster = useCallback(async (clusterIds) => {
    if (!workspaceId || !supabase) return;
    const ids = Array.isArray(clusterIds) ? clusterIds : [clusterIds];
    if (ids.length === 0) return;
    const rows = clusters.filter(c => ids.includes(c.id));
    if (rows.length === 0) return;
    // Prefer the rep we showed the user; fall back to the first row's name.
    const name = rows[0]?.proposed_name;
    if (!name) return;

    // 1. Create the tag.
    let tag;
    try {
      tag = await ensureTag({
        workspaceId,
        name,
        kind: 'user',
        createdBy: userId,
      });
    } catch (e) {
      console.warn('[discovered-tags] ensureTag failed', e?.message || e);
      return;
    }
    if (!tag?.id) return;

    // 2. Apply to every member card across all underlying clusters.
    const allCardIds = Array.from(new Set(rows.flatMap(r => r.member_card_ids || [])));
    if (allCardIds.length > 0) {
      const { data: idx } = await supabase.from('card_index')
        .select('card_id, board_id')
        .eq('workspace_id', workspaceId)
        .in('card_id', allCardIds);
      const boardByCard = new Map((idx || []).map(r => [r.card_id, r.board_id]));
      for (const cardId of allCardIds) {
        const boardId = boardByCard.get(cardId);
        if (!boardId) continue;
        try {
          await tagCard({ workspaceId, boardId, cardId, tagId: tag.id, source: 'auto' });
        } catch (e) {
          console.warn('[discovered-tags] tagCard failed', e?.message || e);
        }
      }
    }

    // 3. Mark every underlying cluster promoted.
    await supabase.from('pending_clusters')
      .update({ status: 'promoted' })
      .in('id', ids);

    // 4. Refresh the sidebar list + the workspace tags index.
    refresh();
    onWorkspaceTagsChanged?.();
  }, [workspaceId, userId, clusters, refresh, onWorkspaceTagsChanged]);

  // Dismiss: mark every underlying cluster dismissed.
  const dismissCluster = useCallback(async (clusterIds) => {
    if (!supabase) return;
    const ids = Array.isArray(clusterIds) ? clusterIds : [clusterIds];
    if (ids.length === 0) return;
    await supabase.from('pending_clusters')
      .update({ status: 'dismissed' })
      .in('id', ids);
    refresh();
  }, [refresh]);

  return { suggestions, promoteCluster, dismissCluster };
}
