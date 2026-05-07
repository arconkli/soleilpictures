// Anywhere-comments on canvas. Each top-level comment renders as a small
// inline note (avatar + author + relative time, then the body) so the
// content is legible at a glance without needing to expand. Clicking the
// note opens the full thread with replies and resolve/hide/delete
// actions.
//
// Coordinate model:
//   anchor_kind = 'card'   → anchor element bounds via [data-card-id="<id>"]
//   anchor_kind = 'group'  → anchor element bounds via [data-group-id="<id>"]
//   anchor_kind = 'point'  → anchor_x/y are canvas-space coords
//   anchor_kind = 'board'  → fixed top-right of canvas wrap
//   anchor_kind = 'doc_range' → ignored on canvas (shown inside doc)

import { useEffect, useRef, useState } from 'react';
import { addComment, updateComment, deleteComment } from '../lib/commentsApi.js';
import { useFeedback } from './AppFeedback.jsx';
import { relativeTimeShort } from '../lib/relativeTime.js';

export function CanvasCommentLayer({
  comments, boardId, workspaceId, userId, wsPeers = [],
  // Pixel position helpers — receivers convert canvas coords to viewport
  // pixels via the canvas's CSS transform. We pass `getCanvasToViewport`
  // so the layer can place bubbles against the live pan/zoom.
  canvasToViewport,
  // Resolve a card / group id to its current bounding box in canvas space,
  // for anchor_kind='card'/'group'. Returns null when the element no
  // longer exists.
  resolveCardBBox, resolveGroupBBox,
}) {
  if (!comments?.length) return null;
  // Index replies by parent so the top-level bubble can render its thread.
  const byParent = new Map();
  const tops = [];
  for (const c of comments) {
    if (c.hidden) continue;
    if (c.reply_to) {
      const arr = byParent.get(c.reply_to) || [];
      arr.push(c);
      byParent.set(c.reply_to, arr);
    } else {
      tops.push(c);
    }
  }
  return (
    <div className="canvas-comment-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {tops.map(c => (
        <CanvasCommentBubble
          key={c.id}
          comment={c}
          replies={byParent.get(c.id) || []}
          boardId={boardId}
          workspaceId={workspaceId}
          userId={userId}
          wsPeers={wsPeers}
          canvasToViewport={canvasToViewport}
          resolveCardBBox={resolveCardBBox}
          resolveGroupBBox={resolveGroupBBox}
        />
      ))}
    </div>
  );
}

function anchorPoint({ comment, resolveCardBBox, resolveGroupBBox }) {
  // Returns { x, y } in canvas coords for the bubble's tail. Each kind
  // picks a sensible default (top-right of card/group, the literal point,
  // or the canvas origin for board-level).
  if (comment.anchor_kind === 'card') {
    const b = resolveCardBBox?.(comment.anchor_id);
    if (b) return { x: b.x + b.w + 8, y: b.y - 8 };
  }
  if (comment.anchor_kind === 'group') {
    const b = resolveGroupBBox?.(comment.anchor_id);
    if (b) return { x: b.x + b.w + 8, y: b.y - 8 };
  }
  if (comment.anchor_kind === 'point') {
    return { x: comment.anchor_x ?? 0, y: comment.anchor_y ?? 0 };
  }
  // 'board' fallback — top-right corner of the visible canvas.
  return { x: 100, y: 100 };
}

function resolvePeerName(authorId, wsPeers, userId) {
  const peer = (wsPeers || []).find(p => p?.user?.id === authorId);
  if (peer?.user?.name) return peer.user.name;
  if (peer?.user?.email) return peer.user.email.split('@')[0];
  if (authorId === userId) return 'you';
  return (authorId || '').slice(0, 6) || 'someone';
}
function resolvePeerColor(authorId, wsPeers) {
  const peer = (wsPeers || []).find(p => p?.user?.id === authorId);
  return peer?.user?.color || '#4f8df8';
}

function CanvasCommentBubble({ comment, replies, boardId, workspaceId, userId, wsPeers, canvasToViewport, resolveCardBBox, resolveGroupBBox }) {
  const feedback = useFeedback();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const isAuthor = comment.author === userId;
  const author = resolvePeerName(comment.author, wsPeers, userId);
  const authorColor = resolvePeerColor(comment.author, wsPeers);
  const replyCount = replies?.length || 0;

  const cp = anchorPoint({ comment, resolveCardBBox, resolveGroupBBox });
  const v = canvasToViewport ? canvasToViewport(cp.x, cp.y) : { x: cp.x, y: cp.y };

  // Close on outside click + Escape.
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const submitReply = async (e) => {
    e?.preventDefault?.();
    const text = reply.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await addComment({
        workspaceId, boardId, author: userId, body: text,
        // Attach reply to the same anchor as the parent so threads stay
        // co-located if the anchor card is moved.
        anchor: parentAnchor(comment),
        replyTo: comment.id,
      });
      setReply('');
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Reply failed: ' + (err.message || err) });
    } finally {
      setBusy(false);
    }
  };

  const onResolve = async () => {
    try {
      await updateComment(comment.id, { resolved: !comment.resolved });
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Update failed: ' + (err.message || err) });
    }
  };
  const onHide = async () => {
    try { await updateComment(comment.id, { hidden: true }); }
    catch (err) { feedback.toast({ type: 'error', message: 'Hide failed: ' + (err.message || err) }); }
  };
  const onDelete = async () => {
    const ok = await feedback.confirm({
      title: 'Delete comment?',
      message: 'This also removes all replies.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try { await deleteComment(comment.id); }
    catch (err) { feedback.toast({ type: 'error', message: 'Delete failed: ' + (err.message || err) }); }
  };

  return (
    <div ref={wrapRef}
         className={`canvas-comment ${open ? 'is-open' : ''} ${comment.resolved ? 'is-resolved' : ''}`}
         style={{ left: v.x, top: v.y, pointerEvents: 'auto' }}>
      {/* Inline preview — body text is always visible so the user can read
          the comment without clicking. The whole card is the click target
          for opening the thread. */}
      <button type="button"
              className="canvas-comment-card"
              aria-expanded={open}
              onClick={() => setOpen(o => !o)}>
        <span className="canvas-comment-card-head">
          <span className="canvas-comment-avatar"
                style={{ background: authorColor }}
                aria-hidden="true">
            {(author || '?')[0].toUpperCase()}
          </span>
          <span className="canvas-comment-author">{author}</span>
          <span className="canvas-comment-when">{relativeTimeShort(comment.created_at)}</span>
          {comment.resolved && <span className="canvas-comment-tag">resolved</span>}
        </span>
        <span className="canvas-comment-body" title={comment.body}>
          {comment.body}
        </span>
        {replyCount > 0 && (
          <span className="canvas-comment-replies-count">
            {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
          </span>
        )}
      </button>
      {open && (
        <div className="canvas-comment-thread">
          {replies.map(r => (
            <CommentLine key={r.id}
                         c={r}
                         authorName={resolvePeerName(r.author, wsPeers, userId)}
                         authorColor={resolvePeerColor(r.author, wsPeers)}
                         canManage={r.author === userId}
                         onDelete={async () => {
                           const ok = await feedback.confirm({
                             title: 'Delete reply?', confirmLabel: 'Delete', danger: true,
                           });
                           if (!ok) return;
                           try { await deleteComment(r.id); }
                           catch (err) { feedback.toast({ type: 'error', message: 'Delete failed' }); }
                         }} />
          ))}
          <form className="canvas-comment-reply" onSubmit={submitReply}>
            <input className="canvas-comment-reply-input"
                   placeholder="Reply…"
                   value={reply}
                   disabled={busy}
                   onChange={(e) => setReply(e.target.value)} />
            <button type="submit"
                    className="canvas-comment-reply-send"
                    disabled={!reply.trim() || busy}>Send</button>
          </form>
          <div className="canvas-comment-actions">
            <button type="button" onClick={onResolve}>
              {comment.resolved ? 'Reopen' : 'Resolve'}
            </button>
            <button type="button" onClick={onHide}>Hide</button>
            {isAuthor && <button type="button" className="danger" onClick={onDelete}>Delete</button>}
          </div>
        </div>
      )}
    </div>
  );
}

// Reconstruct the same anchor shape from a comment row so a reply attaches
// to the same target as its parent.
function parentAnchor(c) {
  if (c.anchor_kind === 'card')   return { kind: 'card',  id: c.anchor_id };
  if (c.anchor_kind === 'group')  return { kind: 'group', id: c.anchor_id };
  if (c.anchor_kind === 'point')  return { kind: 'point', x: c.anchor_x, y: c.anchor_y };
  if (c.anchor_kind === 'board')  return { kind: 'board' };
  return { kind: 'card', id: c.anchor_id };
}

function CommentLine({ c, authorName, authorColor, canManage, onDelete }) {
  return (
    <div className="canvas-comment-line">
      <span className="canvas-comment-line-head">
        <span className="canvas-comment-avatar canvas-comment-avatar-sm"
              style={{ background: authorColor }}
              aria-hidden="true">
          {(authorName || '?')[0].toUpperCase()}
        </span>
        <span className="canvas-comment-line-name">{authorName}</span>
        <span className="canvas-comment-line-when">{relativeTimeShort(c.created_at)}</span>
        {canManage && (
          <button type="button"
                  className="canvas-comment-line-x"
                  aria-label="Delete reply"
                  onClick={onDelete}>×</button>
        )}
      </span>
      <div className="canvas-comment-line-body">{c.body}</div>
    </div>
  );
}
