// The notifications bell (placement C, owner's pick, 2026-10-21): a button in
// the board's right island after the theme switch (on a phone, in the top bar
// before Share), its number the unread count, and the list under it. Pure, so
// node --test can pin it: the count, the label, where the panel goes, when a
// phone sheet replaces it, and where a row leads.

import { t, plural } from '@lingui/core/macro';
import { LOOSE_ID } from './commentLink.js';

export const PANEL_WIDTH = 340;
export const PANEL_GUTTER = 16;   // the panel never comes closer to a viewport edge
export const PANEL_GAP = 8;       // under the island's bottom edge
const PANEL_MIN_ROOM = 160;       // the least height it is pulled up to keep

// Ink, never a badge: nothing at 0, the number to 9, then 9+.
export function bellCountLabel(unread) {
  const n = Math.floor(Number(unread) || 0);
  if (n <= 0) return '';
  return n > 9 ? '9+' : String(n);
}

export function bellAriaLabel(unread) {
  const n = Math.floor(Number(unread) || 0);
  return n > 0 ? plural(n, { one: 'Notifications, # unread', other: 'Notifications, # unread' }) : t`Notifications`;
}

// {top, right} for a position:fixed panel: its right edge on the island's,
// its top PANEL_GAP under it. The island is the anchor, so the right edge
// follows it even though it sits nearer the edge than the gutter (10px); an
// island off the right edge falls back to the gutter, and the left and bottom
// edges keep PANEL_GUTTER clear of the viewport's.
export function placeUnderIsland(islandRect, viewport) {
  const vw = Number(viewport?.width) || 0;
  const vh = Number(viewport?.height) || 0;
  if (!islandRect) return { top: PANEL_GUTTER, right: PANEL_GUTTER };
  let right = Math.round(vw - islandRect.right);
  if (!(right >= 0)) right = PANEL_GUTTER;
  // The left edge stays inside the gutter.
  right = Math.max(0, Math.min(right, vw - PANEL_WIDTH - PANEL_GUTTER));
  let top = Math.round(islandRect.bottom + PANEL_GAP);
  top = Math.min(top, vh - PANEL_GUTTER - PANEL_MIN_ROOM);
  top = Math.max(top, PANEL_GUTTER);
  return { top, right };
}

// A phone shell, or a window too narrow for the panel and its two gutters.
export function wantsNotificationSheet({ mobileShell = false, viewportWidth = Infinity } = {}) {
  if (mobileShell) return true;
  return Number(viewportWidth) < PANEL_WIDTH + 2 * PANEL_GUTTER;
}

// team.* rows that are about the bill, and the ones that answer a person.
const TEAM_BILLING_KINDS = new Set(['team.seats_full', 'team.payment_failed', 'team.view_only', 'team.active_again']);
const TEAM_ANSWER_KINDS = new Set(['team.request_approved', 'team.kept_viewer', 'team.joined_as_viewer']);

// ── Comment notices ─────────────────────────────────────────────────────────
// comment.* is a comment on a cluster's canvas, doc.* one on a doc's or a
// note's words (the client that wrote it says so: lib/commentNotices.js), and
// file.commented / file.replied one on a shared file. Each of new, reply,
// mention and resolved.
const COMMENT_KIND = /^(comment|doc)\.(new|reply|mention|resolved)$/;
const FILE_COMMENT_KIND = /^file\.(commented|replied)$/;
// An id out of `data`. A doc notice's ids were written by another person's
// client, so they are data: letters, digits, _ and - only (the same rule as
// lib/commentNotices.js NOTICE_ID), or the id is not used. The one id rule,
// 80 characters, is lib/commentLink.js LOOSE_ID; the emails keep the same
// literal (supabase/functions/_shared/email/templates.ts LINK_ID).
export const NOTICE_ID = LOOSE_ID;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeId = (v) => (typeof v === 'string' && NOTICE_ID.test(v) ? v : null);

export function isCommentNotice(n) {
  const kind = String(n?.kind || '');
  return COMMENT_KIND.test(kind) || FILE_COMMENT_KIND.test(kind);
}

// The conversation a comment notice is about, or null (a file notice written
// before the comment notices migration names none).
export function noticeThreadId(n) {
  if (!isCommentNotice(n)) return null;
  return safeId(n.data?.thread_id);
}

// How many comments a row stands for: a burst on one thread folds into the
// person's unread row (data.count), so 3 reads as the newest "+2 more".
export function noticeMore(n) {
  if (!isCommentNotice(n)) return 0;
  const c = Math.floor(Number(n?.data?.count));
  return Number.isFinite(c) && c > 1 ? Math.min(c - 1, 99) : 0;
}

// A live notice into the list. One rule for every kind:
//   a new id          goes to the top, unread unless the payload itself
//                     carries a read_at
//   an id listed      REPLACES that row (the payload's fields over the row's)
//                     and goes to the top, KEEPING the row's read_at unless
//                     the payload itself carries one (a read made elsewhere)
// What arrives here, all on 'schedule-ping' and none with a read_at today:
//   an insert's ping (0242 notifications_broadcast); realtime can deliver it
//     twice, and the second must not turn a row the person read unread
//   team.joined counting up (0897): the same id, new words, count and time
//   a comment notice folding (_notify_comment): the same id, newer words, a
//     higher count
// Both folds are made only into a row the database holds as unread, so a row
// this list holds as read was read here a moment ago (markRead is optimistic)
// and stays read.
export function mergeNotice(list, payload, max = 50) {
  const prev = Array.isArray(list) ? list : [];
  if (!payload || payload.id == null) return prev;
  const had = prev.find((x) => x.id === payload.id);
  const readAt = payload.read_at || had?.read_at || null;
  const row = { ...(had || {}), ...payload, read_at: readAt };
  return [row, ...prev.filter((x) => x.id !== payload.id)].slice(0, max);
}

export const NOTICE_TOAST_GAP_MS = 2 * 60 * 1000;

// Does a live notice get a toast (and a browser notice)? `toastedIds` (a Set)
// and `lastByThread` (a Map of thread → when it last toasted) are the page's
// memory; the caller records a yes with noteNoticeToast.
//   any notice         once per id (realtime can deliver a ping twice)
//   a comment notice   once per conversation every two minutes, however many
//                      times its row folds; never while that conversation is
//                      open on screen
//   doc.mention        never: its toast is the mention's own (App.jsx, from
//                      mention_notifications)
export function shouldToastNotice(n, { toastedIds, lastByThread, now = Date.now(), threadOpen = null } = {}) {
  if (!n || n.id == null) return false;
  if (n.kind === 'doc.mention') return false;
  const thread = noticeThreadId(n);
  if (!thread) return !toastedIds?.has(n.id);
  if (threadOpen?.(thread)) return false;
  const last = lastByThread?.get(thread);
  return !(Number.isFinite(last) && now - last < NOTICE_TOAST_GAP_MS);
}
export function noteNoticeToast(n, { toastedIds, lastByThread, now = Date.now() } = {}) {
  if (!n || n.id == null) return;
  toastedIds?.add(n.id);
  const thread = noticeThreadId(n);
  if (thread) lastByThread?.set(thread, now);
}

// What a shared file's own page (/f/<token>) takes to open at one comment.
export function fileCommentQuery(commentId) {
  return typeof commentId === 'string' && UUID.test(commentId) ? '?comment=' + encodeURIComponent(commentId) : '';
}

// Where a row leads:
//   { kind: 'comment', surface: 'canvas', boardId, threadId, commentId }
//                                             a comment.* row: that conversation
//   { kind: 'comment', surface: 'doc', boardId, cardId, threadId, commentId }
//                                             a doc.* row: the thread on that
//                                             doc's or note's words
//   { kind: 'file', token, inApp, commentId } a file.* row with a link token;
//                                             commentId when it names a comment
//   { kind: 'settings', tab, workspaceId }    an editor-limit row: Members; an
//                                             invite reward: Invite & earn
//   { kind: 'team', tab, orgId }              a team.* row: the Team page on
//                                             People ('people') or Seats &
//                                             billing ('billing'), of the team
//                                             the row's data.org_id names
//                                             (null when it names none)
//   { kind: 'board', boardId }                anything else with a board
//   null                                      nothing to open
// A comment row whose ids are missing or are not ids opens its cluster. The
// cluster is always the row's own board_id, never one out of `data`.
// fileShares / sharedFiles are the appHost holds, passed in so this stays pure.
export function notificationTarget(n, { fileShares = true, sharedFiles = true } = {}) {
  if (!n) return null;
  const kind = String(n.kind || '');
  if (kind.startsWith('file.') && n.data?.token && fileShares) {
    const c = n.data.comment_id;
    const commentId = typeof c === 'string' && UUID.test(c) ? c.toLowerCase() : null;
    return { kind: 'file', token: n.data.token, inApp: !!sharedFiles, ...(commentId ? { commentId } : {}) };
  }
  if (COMMENT_KIND.test(kind) && typeof n.board_id === 'string' && UUID.test(n.board_id)) {
    const boardId = n.board_id;
    const threadId = safeId(n.data?.thread_id);
    const commentId = safeId(n.data?.comment_id);
    if (kind.startsWith('comment.')) {
      if (threadId || commentId) return { kind: 'comment', surface: 'canvas', boardId, threadId: threadId || commentId, commentId: commentId || threadId };
    } else {
      const cardId = safeId(n.data?.card_id);
      if (cardId && threadId) return { kind: 'comment', surface: 'doc', boardId, cardId, threadId, commentId: commentId || threadId };
    }
    return { kind: 'board', boardId };
  }
  if (kind === 'editors.limit_reached') {
    // public.notifications.workspace_id (0242) first, then the payload's.
    const workspaceId = n.workspace_id || n.data?.workspace_id || null;
    if (workspaceId) return { kind: 'settings', tab: 'members', workspaceId };
  }
  if (kind === 'invite.reward') return { kind: 'settings', tab: 'invite' };
  // team.* rows. A team that ended has nothing to open, and the board rule
  // below must not catch it.
  if (kind === 'team.removed' || kind === 'team.closed') return null;
  const orgId = typeof n.data?.org_id === 'string' && n.data.org_id ? n.data.org_id : null;
  if (kind === 'team.join_request' || kind === 'team.joined') return { kind: 'team', tab: 'people', orgId };
  if (TEAM_BILLING_KINDS.has(kind)) return { kind: 'team', tab: 'billing', orgId };
  // An answer about a cluster opens the cluster; one about the team alone, People.
  if (TEAM_ANSWER_KINDS.has(kind) && !n.board_id) return { kind: 'team', tab: 'people', orgId };
  if (n.board_id) return { kind: 'board', boardId: n.board_id };
  return null;
}
