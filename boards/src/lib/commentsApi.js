// CRUD over the public.comments table (anywhere-comments — anchored to
// cards, groups, points in empty space, the board itself, or a doc range).
// Realtime subscription happens in useCanvasComments; this file is the
// REST surface.

import { supabase } from './supabase.js';

// List comments visible on a board. Includes resolved + hidden — let the
// UI decide what to render.
export async function listComments(boardId) {
  if (!boardId) return [];
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('board_id', boardId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Insert a new comment. Caller must have can_read_board() on the target.
// `anchor` is one of:
//   { kind: 'card',      id: '<cardId>' }
//   { kind: 'group',     id: '<groupId>' }
//   { kind: 'point',     x: <num>, y: <num> }
//   { kind: 'board' }
//   { kind: 'doc_range', cardId: '<docCardId>', pageId, from, to }
export async function addComment({ workspaceId, boardId, author, body, anchor, replyTo = null,
                                   offsetX = 0, offsetY = 0 }) {
  if (!workspaceId || !boardId || !author || !body || !anchor) {
    throw new Error('addComment: missing required fields');
  }
  const row = {
    workspace_id: workspaceId,
    board_id: boardId,
    author,
    body: body.toString(),
    reply_to: replyTo,
    anchor_kind: anchor.kind,
    anchor_id: null,
    anchor_x: null,
    anchor_y: null,
    doc_page_id: null,
    doc_from: null,
    doc_to: null,
    offset_x: Math.round(offsetX || 0),
    offset_y: Math.round(offsetY || 0),
  };
  if (anchor.kind === 'card' || anchor.kind === 'group') row.anchor_id = anchor.id;
  if (anchor.kind === 'point') {
    row.anchor_x = Math.round(anchor.x);
    row.anchor_y = Math.round(anchor.y);
  }
  if (anchor.kind === 'doc_range') {
    row.anchor_id = anchor.cardId;
    row.doc_page_id = anchor.pageId || null;
    row.doc_from = (anchor.from ?? null);
    row.doc_to = (anchor.to ?? null);
  }
  const { data, error } = await supabase
    .from('comments').insert(row).select('*').single();
  if (error) throw error;
  return data;
}

export async function updateComment(id, patch) {
  // body / hidden / resolved are user-editable; offset_x/y come from drag.
  // anchor_x/y are settable so we can reposition point-anchored comments
  // (card/group keep their anchor_id; only the offset changes).
  const allowed = ['body', 'hidden', 'resolved', 'offset_x', 'offset_y', 'anchor_x', 'anchor_y'];
  const row = {};
  for (const k of allowed) if (k in patch) row[k] = patch[k];
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase
    .from('comments').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteComment(id) {
  const { error } = await supabase
    .from('comments').delete().eq('id', id);
  if (error) throw error;
}

// Comments by a given author across a workspace — used by the right-click
// peer-icon viewer ("see this person's recent comments"). RLS already
// gates rows the caller can't see (peer is in shared workspace ⇒ usually
// share read).
export async function listCommentsByAuthor({ workspaceId, authorId, limit = 50 }) {
  if (!workspaceId || !authorId) return [];
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('author', authorId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
