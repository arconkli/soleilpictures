// Auto-apply a tag to a GROUP when enough of its member cards already
// carry that tag. The tag detail view groups items by board / group,
// so without this propagation, a board where most cards share a tag
// would show each card individually as an orphan instead of nested
// under the obvious group header.
//
// Threshold: ≥2 tagged cards AND ≥50% of the group's members. This
// covers two real cases:
//   - "Personal Pricing" group with 4 cards, 3 tagged (≥3, ratio 0.75)
//   - "Business Pricing" group with 2 cards, both tagged (2/2 = 1.0)
// And rejects noise like "tagged 2 of 20" where the group isn't
// really about that topic.
//
// Idempotent: existing group→tag entity_links rows are skipped.
// Source attribution: 'auto' (distinguished from card-level source
// 'auto' or 'auto-doc' so we can audit propagation later).

import { supabase } from './supabase.js';

const MIN_GROUP_MEMBERS_TAGGED = 2;
const MIN_GROUP_TAG_RATIO = 0.5;

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
  const taggedCounts = new Map(); // key = `${boardId}::${groupId}` → count
  for (const r of (idxRows || [])) {
    const gid = r?.meta?.groupId;
    if (!gid) continue;
    const k = `${r.board_id}::${gid}`;
    taggedCounts.set(k, (taggedCounts.get(k) || 0) + 1);
  }
  const candidateKeys = [...taggedCounts.entries()]
    .filter(([, n]) => n >= MIN_GROUP_MEMBERS_TAGGED)
    .map(([k]) => k);
  if (candidateKeys.length === 0) return { applied: 0 };

  // 3b. Pull total card counts per candidate group so we can apply
  //     the majority rule. One query, filtered by the candidate group
  //     ids — much cheaper than a workspace-wide group-by.
  const candidateGroupIds = candidateKeys.map(k => k.split('::')[1]);
  const candidateBoardIds = candidateKeys.map(k => k.split('::')[0]);
  const { data: totalRows, error: e3 } = await supabase
    .from('card_index')
    .select('board_id, meta')
    .in('board_id', candidateBoardIds)
    .eq('workspace_id', workspaceId);
  if (e3) { console.warn('[group-propagate] load group totals', e3.message); return { applied: 0 }; }
  const totalCounts = new Map(); // key → count of ALL cards in that group
  for (const r of (totalRows || [])) {
    const gid = r?.meta?.groupId;
    if (!gid || !candidateGroupIds.includes(gid)) continue;
    const k = `${r.board_id}::${gid}`;
    totalCounts.set(k, (totalCounts.get(k) || 0) + 1);
  }

  // Apply the threshold rule: ≥2 tagged AND ratio ≥ 0.5.
  const eligible = candidateKeys
    .map(k => [k, taggedCounts.get(k), totalCounts.get(k) || taggedCounts.get(k)])
    .filter(([, tagged, total]) => tagged / total >= MIN_GROUP_TAG_RATIO);
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
