// Deleting a comment thread the house way: no confirm, and a toast with Undo.
// The thread popover (components/CommentInlinePopover.jsx) and the doc look's
// Comments panel (components/doc/DocCommentsTab.jsx) delete through here.
//
// A doc's threads are on its structural undo (docState getDocUndoManager), so
// the toast's Undo is that step, and only while it's still the newest. A
// note's comments have no such undo: what the thread had filed is kept and
// put back. Either way the highlight is taken off the text only once the
// delete has stuck, past the toast's window, so an undo (the toast's or ⌘Z)
// finds the thread still anchored.
import {
  commentsMap, deleteCommentThread, getDocUndoManager, snapshotThread, restoreThread,
} from './docState.js';
import { undoToast } from './undoToast.js';

const STRIP_AFTER_MS = 6500;

export function deleteCommentThreadUndoably(ydoc, scope, threadId, feedback) {
  const stripIfGone = () => setTimeout(() => {
    if (commentsMap(ydoc, scope)?.get(threadId)) return;
    try {
      window.dispatchEvent(new CustomEvent('soleil-remove-comment-mark', { detail: { id: threadId } }));
    } catch (_) {}
  }, STRIP_AFTER_MS);
  const docUm = scope?.pages ? getDocUndoManager(ydoc, scope) : null;
  if (docUm) {
    docUm.stopCapturing();
    deleteCommentThread(ydoc, threadId, scope);
    const item = docUm.undoStack.length ? docUm.undoStack[docUm.undoStack.length - 1] : null;
    docUm.stopCapturing();
    undoToast(feedback, {
      message: 'Comment thread deleted',
      undoManager: docUm,
      stackItem: item,
      onUndo: () => { try { docUm.undo(); } catch (_) {} },
    });
    stripIfGone();
    return;
  }
  const saved = snapshotThread(ydoc, threadId, scope);
  deleteCommentThread(ydoc, threadId, scope);
  undoToast(feedback, {
    message: 'Comment thread deleted',
    onUndo: () => { try { restoreThread(ydoc, saved, scope); } catch (_) {} },
  });
  stripIfGone();
}
