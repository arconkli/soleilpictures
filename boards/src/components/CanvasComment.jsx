// Anywhere-comments on canvas. Each top-level comment renders as a small
// sketchy-handwriting bubble anchored to a card, group, or point. Clicking
// the bubble opens a thread with replies. Hide / resolve / delete are
// scoped to the author + board editors.
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

function CanvasCommentBubble({ comment, replies, boardId, workspaceId, userId, wsPeers, canvasToViewport, resolveCardBBox, resolveGroupBBox }) {
  const feedback = useFeedback();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const isAuthor = comment.author === userId;
  const author = (() => {
    const peer = (wsPeers || []).find(p => p?.user?.id === comment.author);
    return peer?.user?.name || peer?.user?.email?.split('@')[0]
        || (isAuthor ? 'you' : (comment.author || '').slice(0, 6));
  })();
  const authorColor = (() => {
    const peer = (wsPeers || []).find(p => p?.user?.id === comment.author);
    return peer?.user?.color || '#d4a04a';
  })();

  const cp = anchorPoint({ comment, resolveCardBBox, resolveGroupBBox });
  const v = canvasToViewport ? canvasToViewport(cp.x, cp.y) : { x: cp.x, y: cp.y };

  const submitReply = async (e) => {
    e?.preventDefault?.();
    const text = reply.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await addComment({
        workspaceId, boardId, author: userId, body: text,
        anchor: { kind: 'card', id: comment.anchor_id }, // anchored same as parent
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
    <div className={`canvas-comment ${open ? 'is-open' : ''} ${comment.resolved ? 'is-resolved' : ''}`}
         style={{ left: v.x, top: v.y, pointerEvents: 'auto' }}>
      <button type="button"
              className="canvas-comment-pin"
              style={{ background: authorColor }}
              title={`${author} · ${relativeTimeShort(comment.created_at)}`}
              onClick={() => setOpen(o => !o)}>
        {(author || '?')[0].toUpperCase()}
      </button>
      {open && (
        <div className="canvas-comment-thread">
          <CommentLine c={comment} authorName={author} authorColor={authorColor} canManage={isAuthor} onDelete={onDelete} />
          {replies.map(r => {
            const peer = (wsPeers || []).find(p => p?.user?.id === r.author);
            const rname = peer?.user?.name
                       || peer?.user?.email?.split('@')[0]
                       || (r.author === userId ? 'you' : (r.author || '').slice(0, 6));
            const rcolor = peer?.user?.color || '#d4a04a';
            return (
              <CommentLine key={r.id} c={r} authorName={rname} authorColor={rcolor}
                           canManage={r.author === userId}
                           onDelete={async () => {
                             const ok = await feedback.confirm({
                               title: 'Delete reply?', confirmLabel: 'Delete', danger: true,
                             });
                             if (!ok) return;
                             try { await deleteComment(r.id); }
                             catch (err) { feedback.toast({ type: 'error', message: 'Delete failed' }); }
                           }} />
            );
          })}
          <form className="canvas-comment-reply" onSubmit={submitReply}>
            <input className="canvas-comment-reply-input"
                   placeholder="Reply…"
                   value={reply}
                   disabled={busy}
                   onChange={(e) => setReply(e.target.value)} />
            <button type="submit"
                    className="canvas-comment-reply-send"
                    disabled={!reply.trim() || busy}>↩</button>
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

function CommentLine({ c, authorName, authorColor, canManage, onDelete }) {
  return (
    <div className="canvas-comment-line">
      <span className="canvas-comment-line-name" style={{ color: authorColor }}>{authorName}</span>
      <span className="canvas-comment-line-when">{relativeTimeShort(c.created_at)}</span>
      <div className="canvas-comment-line-body">{c.body}</div>
    </div>
  );
}
