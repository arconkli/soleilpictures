// Auto-apply a tag to a GROUP when enough of its member cards already
// carry that tag. The tag detail view groups items by board / group,
// so without this propagation, a board where most cards share a tag
// would show each card individually as an orphan instead of nested
// under the obvious group header.
//
// Threshold: ≥3 tagged cards in a group → tag the group.
// (Mirrors MIN_CLUSTER_SIZE — the same "this is a real theme, not a
// coincidence" guardrail used in cluster discovery.)
//
// Idempotent: existing group→tag entity_links rows are skipped.
// Source attribution: 'auto' (distinguished from card-level source
// 'auto' or 'auto-doc' so we can audit propagation later).

import { supabase } from './supabase.js';

const MIN_GROUP_MEMBERS_TAGGED = 3;

// Scoped propagation: scan all groups in the workspace where this tag
// is applied to enough card members, and apply the tag at the group
// level. Pass `boardId` to narrow the scan to one board (cheaper when
// a per-card edit just triggered an apply and we only need to revisit
// that card's neighborhood).
export async function propagateTagToGroups({ workspaceId, tagId, boardId = null }) {
  if (!supabase || !workspaceId || !tagId) return { applied: 0 };

  // 1. Pull every card-level applied row for this tag in the workspace.
  let q = supabase.from('entity_links')
    .select('source_id, source_board_id')
    .eq('target_kind', 'tag')
    .eq('target_id', tagId)
    .eq('link_kind', 'applied')
    .eq('source_kind', 'card')
    .eq('source_workspace', workspaceId);
  if (boardId) q = q.eq('source_board_id', boardId);
  const { data: appliedCards, error: e1 } = await q;
  if (e1) { console.warn('[group-propagate] load applied cards', e1.message); return { applied: 0 }; }
  if (!appliedCards?.length) return { applied: 0 };

  // 2. Look up groupIds for these cards via card_index.meta.groupId.
  const cardIds = appliedCards.map(c => c.source_id);
  const { data: idxRows, error: e2 } = await supabase
    .from('card_index')
    .select('card_id, board_id, meta')
    .in('card_id', cardIds)
    .eq('workspace_id', workspaceId);
  if (e2) { console.warn('[group-propagate] load card_index', e2.message); return { applied: 0 }; }

  // 3. Count tagged cards per (boardId, groupId).
  const counts = new Map(); // key = `${boardId}::${groupId}` → count
  for (const r of (idxRows || [])) {
    const gid = r?.meta?.groupId;
    if (!gid) continue;
    const k = `${r.board_id}::${gid}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const eligible = [...counts.entries()].filter(([, n]) => n >= MIN_GROUP_MEMBERS_TAGGED);
  if (eligible.length === 0) return { applied: 0 };

  // 4. Dedupe against existing group→tag rows.
  const eligibleGroupIds = eligible.map(([k]) => k.split('::')[1]);
  const { data: existing } = await supabase.from('entity_links')
    .select('source_board_id, source_id')
    .eq('source_kind', 'group')
    .eq('target_kind', 'tag')
    .eq('target_id', tagId)
    .eq('source_workspace', workspaceId)
    .in('source_id', eligibleGroupIds);
  const existingKeys = new Set((existing || []).map(r => `${r.source_board_id}::${r.source_id}`));

  // 5. Build + insert the missing rows.
  const newRows = [];
  for (const [key] of eligible) {
    if (existingKeys.has(key)) continue;
    const [boardIdK, groupIdK] = key.split('::');
    newRows.push({
      source_kind: 'group',
      source_id: groupIdK,
      source_workspace: workspaceId,
      source_board_id: boardIdK,
      target_kind: 'tag',
      target_id: tagId,
      link_kind: 'applied',
      source: 'auto',
    });
  }
  if (newRows.length === 0) return { applied: 0 };

  const { error: insErr } = await supabase.from('entity_links').insert(newRows);
  if (insErr && insErr.code !== '23505') {
    console.warn('[group-propagate] insert', insErr.message);
    return { applied: 0 };
  }
  return { applied: newRows.length };
}
