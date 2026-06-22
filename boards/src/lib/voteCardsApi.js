// CRUD over public.vote_cards + public.vote_card_ballots (vote cards —
// a little up/down poll anchored to a card, group, point in empty space,
// or the board, just like comments). Realtime subscription happens in
// useVoteCards; this file is the REST/RPC surface.
//
// list_vote_cards / cast_vote / soft_delete_vote_card are SECURITY DEFINER
// RPCs (migration 0160). Listing returns derived up_count / down_count and
// the caller's own my_value so the client never aggregates ballots itself.

import { supabase } from './supabase.js';

// List vote cards visible on a board, each with up/down counts + my_value.
// Excludes soft-deleted rows (the RPC filters on deleted_at is null).
export async function listVoteCards(boardId) {
  if (!boardId) return [];
  const { data, error } = await supabase.rpc('list_vote_cards', { p_board_id: boardId });
  if (error) throw error;
  return data || [];
}

// Insert a new vote card. Caller must have can_read_board() on the target.
// `anchor` mirrors addComment:
//   { kind: 'card',  id: '<cardId>' }
//   { kind: 'group', id: '<groupId>' }
//   { kind: 'point', x: <num>, y: <num> }
//   { kind: 'board' }
export async function addVoteCard({ workspaceId, boardId, author, anchor, label = null,
                                    offsetX = 0, offsetY = 0 }) {
  if (!workspaceId || !boardId || !author || !anchor) {
    throw new Error('addVoteCard: missing required fields');
  }
  const row = {
    workspace_id: workspaceId,
    board_id: boardId,
    author,
    label: label != null ? label.toString() : null,
    anchor_kind: anchor.kind,
    anchor_id: null,
    anchor_x: null,
    anchor_y: null,
    offset_x: Math.round(offsetX || 0),
    offset_y: Math.round(offsetY || 0),
  };
  if (anchor.kind === 'card' || anchor.kind === 'group') row.anchor_id = anchor.id;
  if (anchor.kind === 'point') {
    row.anchor_x = Math.round(anchor.x);
    row.anchor_y = Math.round(anchor.y);
  }
  const { data, error } = await supabase
    .from('vote_cards').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

// Patch a vote card. label is author-editable; offset_x/y come from drag;
// anchor_x/y reposition point-anchored cards (card/group keep anchor_id).
export async function updateVoteCard(id, patch) {
  const allowed = ['label', 'hidden', 'resolved', 'offset_x', 'offset_y', 'anchor_x', 'anchor_y'];
  const row = {};
  for (const k of allowed) if (k in patch) row[k] = patch[k];
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase
    .from('vote_cards').update(row).eq('id', id);
  if (error) throw error;
}

// Soft-delete (recoverable). RPC enforces author-or-editor; falls back to a
// direct UPDATE (still RLS-gated) if the RPC is unavailable.
export async function deleteVoteCard(id) {
  const { error } = await supabase.rpc('soft_delete_vote_card', { p_id: id });
  if (error) {
    console.warn('[deleteVoteCard] RPC failed, falling back to UPDATE', error);
    const upd = await supabase
      .from('vote_cards')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null);
    if (upd.error) throw upd.error;
  }
}

// Cast (or toggle off) the caller's vote. value is +1 (up) or -1 (down).
// Re-casting your current value removes it; the opposite value switches.
export async function castVote(voteCardId, value) {
  if (!voteCardId) return;
  const { error } = await supabase.rpc('cast_vote', {
    p_vote_card_id: voteCardId,
    p_value: value,
  });
  if (error) throw error;
}
