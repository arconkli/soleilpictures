// What a doc's side panel and a note's comment card do with a thread: who may
// do what, and the writes. Both keep their threads in the cluster's Y.Doc
// (lib/docState.js; a note through lib/noteDocState.js noteCommentScope), so
// one set of handlers serves the shared CommentCard on both.
//
//   ydoc, scope    the Y.Doc and the docState scope the threads are in
//   surface        'doc' | 'note' (the link a comment gets, and how Undo works)
//   currentUser    { id, name, email, color } | null
//   canEdit        may edit the doc / the note: only they write
//   guest          a guest in a doc shared on its own. The doc's room lets a
//                  guest add (a thread, a reply, a resolve) and delete a
//                  thread they started; it refuses a rewrite of what is there
//                  (lib/docRoomBridge.js), so no Edit and no deleting one reply.
//   workspaceId, boardId, cardId    for mention notices and the link
//   feedback       useFeedback()
//
// → { me, powers(thread) → fn(row), start({ body, mentions, pageId }) → id,
//     handlers(thread, { onGone }) → CommentCard's on* props }
import {
  addCommentThread, addCommentReply, resolveComment, deleteCommentThread, deleteCommentReply,
  editComment, getDocUndoManager, snapshotThread, undoThreadChange, readThread,
} from '../../lib/docState.js';
import { notifyCommentMentions } from '../../lib/commentMentions.js';
import { docNoticePlan, sendDocNotices } from '../../lib/commentNotices.js';
import { addedMentionIds } from '../../lib/commentMentionText.js';
import { supabase } from '../../lib/supabase.js';
import { commentPowers } from '../../lib/commentRules.js';
import { commentLinkUrl } from '../../lib/commentLinkUrl.js';
import { undoToast } from '../../lib/undoToast.js';
import { t, msg } from '@lingui/core/macro';

const idsOf = (mentions) => (mentions || []).map((m) => (m && typeof m === 'object' ? m.id : m)).filter(Boolean);

// A note's thread was deleted and its Undo has gone by: the words it was on
// are told, so an editor that is open on them takes the mark off
// (AddCommentFlow.jsx). A doc keeps its marks: its threads are on the doc's
// own undo, which can still bring one back.
export const COMMENT_GONE_EVENT = 'soleil-comment-gone';
const UNDO_MS = 6000;

export const READ_ONLY_LINE = {
  doc: msg`Only people who can edit this doc can reply.`,
  note: msg`Only people who can edit this note can reply.`,
};

export function docThreadOps({
  ydoc, scope, surface = 'doc', currentUser = null, canEdit = false, guest = false,
  workspaceId = null, boardId = null, cardId = null, feedback = null,
}) {
  const meId = currentUser?.id || null;
  const me = meId ? { id: meId, name: currentUser?.name || 'You' } : null;
  const who = () => ({
    author: currentUser?.name || currentUser?.email || 'You',
    authorId: meId,
    // never the gold that marks what is open: a face has its own colour
    authorColor: currentUser?.color && !/soleil|#ffa500/i.test(currentUser.color) ? currentUser.color : null,
  });
  const by = { by: meId, byName: currentUser?.name || null };
  const notify = (threadId, mentions, body) => {
    notifyCommentMentions({ workspaceId, boardId, cardId, threadId, userIds: idsOf(mentions), preview: body });
  };
  // The bell (lib/commentNotices.js): the database cannot see a thread in the
  // Y.Doc, so it is told what was done, after the write, and never waited
  // for. A doc shared on its own knows its cluster only through its share
  // (scope.noticeBoardId, DocShareView: the people who manage it); a
  // signed-in person who edits it there without the cluster has the share's
  // token instead (scope.noticeShareToken), and the database finds the
  // cluster from it. A guest who is not signed in tells nobody.
  const noticeBoard = boardId || scope?.noticeBoardId || null;
  const noticeToken = noticeBoard ? null : scope?.noticeShareToken || null;
  const tell = (threadId, ev) => {
    if (!meId || !threadId || !(noticeBoard || noticeToken)) return;
    try { sendDocNotices(supabase, { boardId: noticeBoard, shareToken: noticeToken, cardId, threadId }, docNoticePlan(ev, meId)); } catch (_) { /* a notice never breaks a comment */ }
  };

  const powers = (thread) => (row) => {
    const p = commentPowers({ me, row, thread, canRead: !!canEdit, canWrite: !!canEdit });
    // a reply written the old way, inside its thread, has no id of its own
    const filed = !row || !String(row.id).includes('~');
    if (!canEdit) return { reply: false, start: false, copyLink: !!p.copyLink && filed && !guest };
    const ownThread = !!thread && !!meId && thread.root.authorId === meId;
    const isRoot = !!row && !!thread && row.id === thread.id;
    return {
      ...p,
      edit: p.edit && filed && !guest,
      delete: p.delete && filed && (!guest || (isRoot && ownThread && !(thread.replies || []).length)),
      copyLink: p.copyLink && filed && !guest,
    };
  };

  // Undo of something done to one thread. A doc's threads are on its
  // structural undo, so the toast's Undo is that step while it is still the
  // newest; a note's are put back from what was kept.
  const undoably = (threadId, message, change) => {
    const um = scope?.pages ? getDocUndoManager(ydoc, scope) : null;
    if (um) {
      um.stopCapturing();
      const did = change();
      const item = um.undoStack.length ? um.undoStack[um.undoStack.length - 1] : null;
      um.stopCapturing();
      if (did) undoToast(feedback, { message, undoManager: um, stackItem: item, onUndo: () => { try { um.undo(); } catch (_) {} } });
      return did;
    }
    // Undo takes back what this did and nothing anyone wrote meanwhile
    // (lib/docState.js undoThreadChange).
    const before = snapshotThread(ydoc, threadId, scope);
    const did = change();
    if (!did) return did;
    const after = snapshotThread(ydoc, threadId, scope);
    undoToast(feedback, { message, ttl: UNDO_MS, onUndo: () => { try { undoThreadChange(ydoc, before, after, scope); } catch (_) {} } });
    if (!readThread(ydoc, threadId, scope)) {
      setTimeout(() => {
        try {
          if (!readThread(ydoc, threadId, scope)) document.dispatchEvent(new CustomEvent(COMMENT_GONE_EVENT, { detail: { cardId, threadId } }));
        } catch (_) { /* the cluster went meanwhile */ }
      }, UNDO_MS + 500);
    }
    return did;
  };

  const start = ({ body, mentions, pageId = null }) => {
    if (!canEdit) return null;
    const ids = idsOf(mentions);
    const id = addCommentThread(ydoc, { pageId, body, ...who(), mentions: ids, scope });
    notify(id, ids, body);
    tell(id, { what: 'new', threadId: id, body, mentions: ids });
    return id;
  };

  const handlers = (thread, { onGone } = {}) => {
    if (!thread) return {};
    const id = thread.id;
    const link = (rowId) => commentLinkUrl(window.location.href, { surface, boardId, cardId, commentId: rowId && !String(rowId).includes('~') ? rowId : id });
    const out = {
      onCopyLink: async (rowId) => {
        try {
          const url = link(rowId);
          if (!url) throw new Error('no link');
          await navigator.clipboard.writeText(url);
          feedback?.toast?.({ type: 'success', message: t`Link copied` });
        } catch (_) {
          feedback?.toast?.({ type: 'error', code: 'link_copy_failed', message: t`Could not copy link` });
        }
      },
    };
    if (!canEdit) return out;
    const delThread = () => {
      onGone?.();
      undoably(id, t`Comment deleted`, () => { deleteCommentThread(ydoc, id, scope); return true; });
    };
    return {
      ...out,
      onReply: ({ body, mentions }) => {
        const ids = idsOf(mentions);
        const replyId = addCommentReply(ydoc, id, { body, ...who(), mentions: ids, scope });
        // a reply to a resolved thread reopens it
        if (thread.resolved) resolveComment(ydoc, id, false, scope, by);
        notify(id, ids, body);
        if (replyId) tell(id, { what: 'reply', thread, replyId, body, mentions: ids });
      },
      // A changed comment tells nobody it already named: they were told when
      // it was written, and a fixed typo is no news. Someone the edit ADDS is
      // told in the bell only (no email, as on the canvas).
      onEdit: (rowId, { body, mentions }) => {
        const row = !rowId || rowId === id ? thread.root : (thread.replies || []).find((r) => r.id === rowId);
        const done = editComment(ydoc, id, rowId, { body, mentions: idsOf(mentions), by: meId }, scope);
        if (done && row) tell(id, { what: 'edit', thread, rowId: row.id, body, added: addedMentionIds(row.mentions, mentions) });
      },
      onDelete: (rowId) => {
        if (rowId === id && !(thread.replies || []).length) { delThread(); return; }
        let what = null;
        undoably(id, rowId === id ? t`Comment deleted` : t`Reply deleted`, () => {
          what = deleteCommentReply(ydoc, id, rowId, scope);
          return !!what;
        });
        if (what === 'thread') onGone?.();
      },
      onDeleteThread: delThread,
      onResolve: () => {
        resolveComment(ydoc, id, true, scope, by);
        tell(id, { what: 'resolve', thread });
        undoToast(feedback, { message: t`Comment resolved`, onUndo: () => { resolveComment(ydoc, id, false, scope, by); } });
      },
      onReopen: () => { resolveComment(ydoc, id, false, scope, by); },
    };
  };

  return { me, powers, start, handlers };
}
