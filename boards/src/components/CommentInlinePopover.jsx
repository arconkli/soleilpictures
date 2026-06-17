import { useEffect, useState, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { commentsMap, addCommentReply, deleteCommentThread, resolveComment } from '../lib/docState.js';
import { useFeedback } from './AppFeedback.jsx';

const PAD = 8;
const W = 320;

export function CommentInlinePopover({ ydoc, scope, threadId, anchor, currentUser, onClose }) {
  const [thread, setThread] = useState(null);
  const [reply, setReply] = useState('');
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
            const ok = await feedback.confirm({
              title: 'Delete this thread?',
              message: 'Replies will be removed too.',
              danger: true,
              confirmLabel: 'Delete',
            });
            if (ok) {
              deleteCommentThread(ydoc, threadId, scope);
              // Also strip the now-orphaned highlight mark from the text
              // (DocPageEditor listens + runs removeCommentById) so deleting a
              // thread doesn't leave a dead underline behind.
              try {
                window.dispatchEvent(new CustomEvent('soleil-remove-comment-mark', { detail: { id: threadId } }));
              } catch (_) {}
              onClose?.();
            }
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
          addCommentReply(ydoc, threadId, {
            body,
            author: currentUser?.name || currentUser?.email || 'You',
            authorColor: currentUser?.color || 'var(--soleil)',
            scope,
          });
          setReply('');
        }}>
          <input value={reply} onChange={e => setReply(e.target.value)} placeholder="Reply…" />
        </form>
      )}
    </div>,
    document.body,
  );
}
