import { useEffect, useState, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { commentsMap, addCommentReply, deleteCommentThread, resolveComment, getDocUndoManager, DOC_ORIGIN } from '../lib/docState.js';
import { undoToast } from '../lib/undoToast.js';
import { notifyCommentMentions } from '../lib/commentMentions.js';
import { EntityPicker } from './EntityPicker.jsx';
import { caretRect } from '../lib/caretRect.js';
import { useFeedback } from './AppFeedback.jsx';

// Keep only the people whose @name still appears in the final text — a user can
// pick someone from the picker and then delete the mention again.
function matchMentions(body, picked) {
  return [...new Set(picked.filter(m => body.includes('@' + m.name)).map(m => m.id))];
}

// Scan back from the caret to an unbroken "@word" (same rule as
// MessageComposer / InlineComposer).
function detectMentionToken(text, caret) {
  let i = caret - 1;
  while (i >= 0 && /\S/.test(text[i]) && text[i] !== '@') i--;
  if (i < 0 || text[i] !== '@') return null;
  return { tokenStart: i, query: text.slice(i + 1, caret) };
}

const PAD = 8;
const W = 320;

export function CommentInlinePopover({
  ydoc, scope, threadId, anchor, currentUser, onClose,
  // Optional. Present → replies can @-mention and the named people get
  // notified through notify_comment_mention. Absent (e.g. a legacy view='doc'
  // board with no board id in scope) → plain-text replies, as before.
  workspaceId = null, boardId = null, cardId = null,
}) {
  const [thread, setThread] = useState(null);
  const [reply, setReply] = useState('');
  const [replyMention, setReplyMention] = useState(null);   // { tokenStart, query, anchor }
  const [replyMentions, setReplyMentions] = useState([]);   // [{ id, name }]
  const popRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const feedback = useFeedback();

  // Guard an in-progress reply: Escape / outside-click used to discard it
  // silently. Refs keep the dismiss handlers reading current state, and
  // confirmingRef stops the confirm dialog's own clicks from re-triggering
  // the outside-click close.
  const replyRef = useRef('');
  replyRef.current = reply;
  const confirmingRef = useRef(false);
  const requestClose = async () => {
    if (confirmingRef.current) return;
    if (replyRef.current.trim()) {
      confirmingRef.current = true;
      const ok = await feedback.confirm({
        title: 'Discard reply?',
        message: 'You have an unsent reply on this comment.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep writing',
        danger: true,
      });
      confirmingRef.current = false;
      if (!ok) return;
    }
    onClose?.();
  };

  useEffect(() => {
    if (!ydoc || !threadId) return;
    const cm = commentsMap(ydoc, scope);
    if (!cm) return;
    const refresh = () => {
      const v = cm.get(threadId);
      if (!v) { setThread(null); return; }
      const get = (k) => v?.get?.(k) ?? v?.[k];
      const repliesY = get('replies');
      setThread({
        id: threadId,
        body: get('body'),
        author: get('author'),
        authorColor: get('authorColor'),
        ts: get('ts'),
        resolved: get('resolved') || false,
        replies: repliesY?.toArray ? repliesY.toArray() : (Array.isArray(repliesY) ? repliesY : []),
      });
    };
    refresh();
    cm.observeDeep(refresh);
    return () => cm.unobserveDeep(refresh);
  }, [ydoc, scope, threadId]);

  useLayoutEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const vh = window.innerHeight, vw = window.innerWidth;
      const popH = popRef.current?.scrollHeight || 240;
      const top = Math.min(vh - popH - PAD, anchor.top);
      const left = Math.min(Math.max(PAD, anchor.right + PAD), vw - W - PAD);
      setPos({ top, left });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchor]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !confirmingRef.current) requestClose(); };
    const onDown = (e) => {
      // Clicks inside the popover or the discard-confirm dialog don't close.
      if (e.target.closest?.('.feedback-bg')) return;
      if (popRef.current && !popRef.current.contains(e.target)) requestClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  if (!thread) return null;

  return createPortal(
    <div ref={popRef} className="comment-inline-pop surface-frosted" style={{ top: pos.top, left: pos.left, width: W }}>
      <div className="comment-inline-head">
        <span className="comment-inline-author" style={{ background: thread.authorColor || 'var(--soleil)' }}>
          {(thread.author || '?')[0]?.toUpperCase()}
        </span>
        <span className="comment-inline-name">{thread.author}</span>
        <button
          className="comment-inline-x"
          title={thread.resolved ? 'Reopen' : 'Resolve'}
          onClick={() => resolveComment(ydoc, threadId, !thread.resolved, scope)}
        >{thread.resolved ? '↺' : '✓'}</button>
        <button
          className="comment-inline-x"
          title="Delete"
          onClick={async () => {
            // Docs (full scope): no confirm — the DOC_ORIGIN UndoManager makes
            // the delete reversible, so the house delete→Undo-toast convention
            // applies. The highlight-mark strip is DEFERRED past the undo
            // window: an undo (toast or Cmd+Z) restores a still-anchored
            // thread; the strip only runs once the delete has stuck.
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
              setTimeout(() => {
                // Strip the dead underline only if the thread is still gone
                // (covers toast-undo AND a Cmd+Z inside the window).
                if (!commentsMap(ydoc, scope)?.get(threadId)) {
                  try {
                    window.dispatchEvent(new CustomEvent('soleil-remove-comment-mark', { detail: { id: threadId } }));
                  } catch (_) {}
                }
              }, 6500);
              onClose?.();
              return;
            }
            // Notes (comments-only scope — no structural UndoManager): the
            // thread value is a plain object in a Y.Map, so a closure restore
            // IS the engine — capture it before deleting, re-set it on Undo.
            // Same deferred mark-strip as the doc branch, so an undo restores
            // a still-anchored thread. No confirm: delete → Undo toast.
            const saved = commentsMap(ydoc, scope)?.get(threadId) || null;
            deleteCommentThread(ydoc, threadId, scope);
            undoToast(feedback, {
              message: 'Comment thread deleted',
              onUndo: () => {
                try {
                  const map = commentsMap(ydoc, scope);
                  if (saved && map && !map.get(threadId)) {
                    ydoc.transact(() => { map.set(threadId, saved); }, DOC_ORIGIN);
                  }
                } catch (_) {}
              },
            });
            setTimeout(() => {
              if (!commentsMap(ydoc, scope)?.get(threadId)) {
                try {
                  window.dispatchEvent(new CustomEvent('soleil-remove-comment-mark', { detail: { id: threadId } }));
                } catch (_) {}
              }
            }, 6500);
            onClose?.();
          }}
        >×</button>
      </div>
      <div className="comment-inline-body">{thread.body}</div>
      {thread.replies.map((r, i) => (
        <div key={r.id || i} className="comment-inline-reply">
          <div className="comment-inline-name">{r.author}</div>
          <div>{r.body}</div>
        </div>
      ))}
      {!thread.resolved && (
        <form className="comment-inline-replyform" onSubmit={(e) => {
          e.preventDefault();
          const body = reply.trim();
          if (!body) return;
          const mentions = matchMentions(body, replyMentions);
          addCommentReply(ydoc, threadId, {
            body,
            author: currentUser?.name || currentUser?.email || 'You',
            authorId: currentUser?.id || null,
            authorColor: currentUser?.color || 'var(--soleil)',
            mentions,
            scope,
          });
          notifyCommentMentions({ workspaceId, boardId, cardId, threadId, userIds: mentions, preview: body });
          setReply('');
          setReplyMentions([]);
        }}>
          <input value={reply}
                 onChange={(e) => {
                   const next = e.target.value;
                   setReply(next);
                   if (!workspaceId) return;
                   const tok = detectMentionToken(next, e.target.selectionStart ?? next.length);
                   setReplyMention(tok ? { ...tok, anchor: caretRect(e.target) } : null);
                 }}
                 onKeyDown={(e) => { if (e.key === 'Enter' && replyMention) e.preventDefault(); }}
                 placeholder={workspaceId ? 'Reply… (@ to mention)' : 'Reply…'} />
        </form>
      )}
      {replyMention && workspaceId && (
        <EntityPicker
          workspaceId={workspaceId}
          anchor={replyMention.anchor}
          initialQuery={replyMention.query}
          filter={['user']}
          onCommit={(targets) => {
            const t = targets?.[0];
            if (!t) { setReplyMention(null); return; }
            const name = t.title || t.name || 'someone';
            const before = reply.slice(0, replyMention.tokenStart);
            const after = reply.slice(replyMention.tokenStart + 1 + replyMention.query.length);
            setReply(before + '@' + name + ' ' + after);
            setReplyMentions(p => [...p, { id: t.id, name }]);
            setReplyMention(null);
          }}
          onCancel={() => setReplyMention(null)}
        />
      )}
    </div>,
    document.body,
  );
}
