// CRUD over the public.comments table (anywhere-comments — anchored to
// cards, groups, points in empty space, the board itself, or a doc range).
// Realtime subscription happens in useCanvasComments; this file is the
// REST surface.

import { supabase, sessionUserId } from './supabase.js';
import { logEvent } from './analytics.js';
import { EV } from './analyticsEvents.js';

// List comments visible on a board. Includes resolved + hidden — let the
// UI decide what to render. Excludes soft-deleted rows.
export async function listComments(boardId) {
  if (!boardId) return [];
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('board_id', boardId)
    .is('deleted_at', null)
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
  // Logged here, at the one choke point every comment goes through, rather than
  // at each UI entry (canvas pin, inline popover, doc range) — a new entry point
  // then can't quietly go unmeasured.
  //
  // Shape only: length is bucketed and mentions are a boolean. The body is a
  // colleague's message about someone's work and has no business in an
  // analytics table.
  try {
    logEvent(EV.COMMENT_CREATE, {
      board_id: boardId,
      is_reply: !!replyTo,
      anchor_kind: anchor.kind,
      has_mention: /(^|\s)@\w/.test(String(body)),
      len_bucket: lenBucket(String(body).length),
    });
  } catch (_) { /* never let telemetry break posting a comment */ }
  return data;
}

// Coarse enough that a length can't be used to identify a specific message.
function lenBucket(n) {
  if (n <= 20) return 'xs';
  if (n <= 80) return 's';
  if (n <= 240) return 'm';
  return 'l';
}

export async function updateComment(id, patch) {
  // body / hidden / resolved are user-editable; offset_x/y come from drag.
  // anchor_x/y are settable so we can reposition point-anchored comments
  // (card/group keep their anchor_id; only the offset changes).
  const allowed = ['body', 'hidden', 'resolved', 'offset_x', 'offset_y', 'anchor_x', 'anchor_y'];
  const row = {};
  for (const k of allowed) if (k in patch) row[k] = patch[k];
  if (Object.keys(row).length === 0) return;
  // RLS (author, or anyone who can write the board) filters an UPDATE the
  // caller may not make down to zero rows, and PostgREST reports that as
  // success. Ask for the ids back so a refused Resolve/Hide says so instead
  // of silently doing nothing.
  const { data, error } = await supabase
    .from('comments').update(row).eq('id', id).select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw notAllowed('change');
}

// What a refused write turns into: a zero-row UPDATE, or the RPCs' 42501,
// whose own message names the comment's uuid. Same code either way.
function notAllowed(verb) {
  const e = new Error(`Only its author or an editor of this cluster can ${verb} this comment.`);
  e.code = '42501';
  return e;
}

// Soft-delete a comment. Recoverable for 30 days via restoreComment, or
// from the History modal's Comments tab (deleted comments still show
// there with a Restore action). The 30-day window is enforced by the
// purge_old_deleted_comments() RPC.
export async function deleteComment(id) {
  const { error } = await supabase.rpc('soft_delete_comment', { p_comment_id: id });
  if (error) {
    // The RPC is authoritative on permission. Falling back to an UPDATE after
    // a refusal ran into the same RLS, matched zero rows, "succeeded", and the
    // archive showed "Comment deleted" for a comment that never was.
    if (error.code === '42501') throw notAllowed('delete');
    console.warn('[deleteComment] RPC failed, falling back to UPDATE', error);
    const upd = await supabase
      .from('comments')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
      .select('id');
    if (upd.error) throw upd.error;
    if (!upd.data || upd.data.length === 0) throw notAllowed('delete');
  }
}

// Reverse a soft-delete.
export async function restoreComment(id) {
  const { error } = await supabase.rpc('restore_comment', { p_comment_id: id });
  if (error) {
    if (error.code === '42501') throw notAllowed('restore');   // as deleteComment
    console.warn('[restoreComment] RPC failed, falling back to UPDATE', error);
    const upd = await supabase
      .from('comments')
      .update({ deleted_at: null, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id');
    if (upd.error) throw upd.error;
    if (!upd.data || upd.data.length === 0) throw notAllowed('restore');
  }
}

// Bulk-unhide every individually-hidden comment on a board. Used by the
// canvas eye-toggle so flipping the master "show all" actually surfaces
// comments the user previously dismissed via the per-bubble Hide
// action — not just the layer's visibility. RLS still gates which rows
// the caller can flip; ones they don't have write access to are left
// alone (Postgres returns the rows it CAN update without erroring on
// the rest).
export async function unhideAllOnBoard(boardId) {
  if (!boardId) return 0;
  const { data, error } = await supabase
    .from('comments')
    .update({ hidden: false })
    .eq('board_id', boardId)
    .eq('hidden', true)
    .is('deleted_at', null)
    .select('id');
  if (error) throw error;
  return (data || []).length;
}

// View-state for top-level comment threads — used to drive the small
// "unread reply" dot on canvas bubbles. Per-user; RLS scopes to self.
// We pass the root ids in explicitly (rather than join via SQL) so
// supabase-js can do this with a single .in() filter.
export async function listMyCommentViews(rootIds) {
  if (!rootIds || rootIds.length === 0) return new Map();
  const uid = await sessionUserId();
  if (!uid) return new Map();
  const { data, error } = await supabase
    .from('comment_views')
    .select('root_comment_id, last_viewed_at')
    .eq('user_id', uid)
    .in('root_comment_id', rootIds);
  if (error) throw error;
  const m = new Map();
  (data || []).forEach(r => m.set(r.root_comment_id, r.last_viewed_at));
  return m;
}

// Upsert (user, root_comment) → now(). Fire-and-forget from the UI; if
// it fails the worst case is the dot reappears on next reload.
export async function markCommentViewed(rootCommentId) {
  if (!rootCommentId) return;
  const uid = await sessionUserId();
  if (!uid) return;
  const { error } = await supabase
    .from('comment_views')
    .upsert(
      { user_id: uid, root_comment_id: rootCommentId, last_viewed_at: new Date().toISOString() },
      { onConflict: 'user_id,root_comment_id' }
    );
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
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
