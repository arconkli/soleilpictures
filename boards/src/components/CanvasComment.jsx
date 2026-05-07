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
  // Current zoom — needed by drag handlers to convert viewport pixel
  // deltas into canvas-space deltas (the layer sits outside the canvas
  // transform, so 10px drag = 10/zoom canvas units).
  zoom = 1,
  // Resolve a card / group id to its current bounding box in canvas space,
  // for anchor_kind='card'/'group'. Returns null when the element no
  // longer exists.
  resolveCardBBox, resolveGroupBBox,
  // Inline-draft state. When set, the layer renders an inline input at
  // the given viewport position. submitting calls onSubmitDraft; Esc /
  // outside-click calls onCancelDraft.
  draft, onSubmitDraft, onCancelDraft,
  // Optimistic local removal — invoked right after a successful delete
  // so the bubble disappears without waiting for the realtime fan-out.
  onLocallyRemoved,
  // When true, hidden comments render (faded, with an "unhide" button
  // instead of "hide") so the user can recover them. Default false.
  revealHidden = false,
}) {
  // Index replies by parent so the top-level bubble can render its thread.
  // Skip resolved + hidden comments entirely (resolved → conversation done,
  // hidden → user dismissed). The History modal's Comments tab is where
  // both go to be reviewed / restored. The eye toggle reveals hidden ones
  // INLINE for easy unhide.
  const byParent = new Map();
  const tops = [];
  for (const c of (comments || [])) {
    if (c.resolved) continue;
    if (c.hidden && !revealHidden) continue;
    if (c.reply_to) {
      const arr = byParent.get(c.reply_to) || [];
      arr.push(c);
      byParent.set(c.reply_to, arr);
    } else {
      tops.push(c);
    }
  }
  if (!tops.length && !draft) return null;
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
          zoom={zoom}
          canvasToViewport={canvasToViewport}
          resolveCardBBox={resolveCardBBox}
          resolveGroupBBox={resolveGroupBBox}
          onLocallyRemoved={onLocallyRemoved}
          isRevealedHidden={c.hidden && revealHidden}
        />
      ))}
      {draft && (
        <CanvasCommentDraft
          viewport={draft.viewport}
          onSubmit={onSubmitDraft}
          onCancel={onCancelDraft}
        />
      )}
    </div>
  );
}

function CanvasCommentDraft({ viewport, onSubmit, onCancel }) {
  const [body, setBody] = useState('');
  const ref = useRef(null);
  // Outside click + Escape cancel.
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return;
      onCancel?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onCancel]);
  // Auto-focus on mount so the user can just start typing.
  useEffect(() => {
    const el = ref.current?.querySelector('textarea');
    if (el) { try { el.focus({ preventScroll: true }); } catch (_) { el.focus(); } }
  }, []);
  return (
    <div ref={ref}
         className="canvas-comment canvas-comment-draft"
         style={{ left: viewport.x, top: viewport.y, pointerEvents: 'auto' }}
         onMouseDown={(e) => e.stopPropagation()}
         onPointerDown={(e) => e.stopPropagation()}>
      <form className="canvas-comment-card canvas-comment-card-draft"
            onSubmit={(e) => { e.preventDefault(); onSubmit?.(body); }}>
        <textarea className="canvas-comment-draft-input"
                  rows={2}
                  value={body}
                  placeholder="Add a comment…"
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      onSubmit?.(body);
                    }
                  }} />
        <div className="canvas-comment-draft-actions">
          <span className="canvas-comment-draft-hint">Enter to post · Esc to cancel</span>
          <button type="button"
                  className="canvas-comment-draft-cancel"
                  onClick={onCancel}>Cancel</button>
          <button type="submit"
                  className="canvas-comment-draft-post"
                  disabled={!body.trim()}>Post</button>
        </div>
      </form>
    </div>
  );
}

function anchorPoint({ comment, resolveCardBBox, resolveGroupBBox }) {
  // Returns { x, y } in canvas coords for the bubble. Per-comment
  // offset_x / offset_y let the author drag the bubble around its
  // anchor. For 'point' anchors the offset is added on top of the
  // stored anchor so a manual drag survives card moves nearby.
  const ox = comment.offset_x || 0;
  const oy = comment.offset_y || 0;
  if (comment.anchor_kind === 'card') {
    const b = resolveCardBBox?.(comment.anchor_id);
    if (b) return { x: b.x + b.w + 8 + ox, y: b.y - 8 + oy };
  }
  if (comment.anchor_kind === 'group') {
    const b = resolveGroupBBox?.(comment.anchor_id);
    if (b) return { x: b.x + b.w + 8 + ox, y: b.y - 8 + oy };
  }
  if (comment.anchor_kind === 'point') {
    return { x: (comment.anchor_x ?? 0) + ox, y: (comment.anchor_y ?? 0) + oy };
  }
  // 'board' fallback — top-right corner of the visible canvas.
  return { x: 100 + ox, y: 100 + oy };
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

function CanvasCommentBubble({ comment, replies, boardId, workspaceId, userId, wsPeers, zoom = 1, canvasToViewport, resolveCardBBox, resolveGroupBBox, onLocallyRemoved, isRevealedHidden = false }) {
  const feedback = useFeedback();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const isAuthor = comment.author === userId;
  const author = resolvePeerName(comment.author, wsPeers, userId);
  const authorColor = resolvePeerColor(comment.author, wsPeers);
  const replyCount = replies?.length || 0;

  // Live drag offset — while the author is dragging, render the bubble
  // at this offset for instant feedback. On pointer-up we commit the
  // value to the DB and KEEP the delta visible until the comment prop
  // reflects the new offset (the realtime UPDATE refetches and lands
  // a fresh row). Without this hold-over, the bubble snaps back to its
  // pre-drag position for a frame and then teleports — looks like a
  // glitch.
  const [dragDelta, setDragDelta] = useState(null);
  // The values we just committed — once `comment` reflects them, the
  // saved offset already matches what the user dragged to and we can
  // safely drop the local override.
  const committedRef = useRef(null);
  // Suppresses the synthesized click that fires after pointerup of a
  // drag, so dragging the head doesn't accidentally toggle the thread.
  const justDraggedRef = useRef(false);

  const cp = anchorPoint({ comment, resolveCardBBox, resolveGroupBBox });
  const liveCp = dragDelta
    ? { x: cp.x + dragDelta.dx, y: cp.y + dragDelta.dy }
    : cp;
  const v = canvasToViewport ? canvasToViewport(liveCp.x, liveCp.y) : { x: liveCp.x, y: liveCp.y };

  // When the comment row's saved offset / anchor catches up to what we
  // just committed, drop the dragDelta override. After this, cp is
  // computed from the fresh offsets and the bubble stays put.
  useEffect(() => {
    if (!dragDelta || !committedRef.current) return;
    const c = committedRef.current;
    const matched = comment.anchor_kind === 'point'
      ? (comment.anchor_x === c.ax && comment.anchor_y === c.ay)
      : (comment.offset_x === c.ox && comment.offset_y === c.oy);
    if (matched) {
      committedRef.current = null;
      setDragDelta(null);
    }
  }, [comment.offset_x, comment.offset_y, comment.anchor_x, comment.anchor_y,
      comment.anchor_kind, dragDelta]);

  // Author-only drag-to-reposition. Pointerdown on the head row starts
  // a drag (we use the head, not the whole card, so dragging doesn't
  // conflict with click-to-expand). Threshold prevents accidental drags
  // on a quick click.
  const onDragStart = (e) => {
    if (!isAuthor) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    const startClient = { x: e.clientX, y: e.clientY };
    let started = false;
    const onMove = (ev) => {
      const dxPx = ev.clientX - startClient.x;
      const dyPx = ev.clientY - startClient.y;
      if (!started && Math.hypot(dxPx, dyPx) < 4) return; // click threshold
      started = true;
      const dx = dxPx / Math.max(0.001, zoom);
      const dy = dyPx / Math.max(0.001, zoom);
      setDragDelta({ dx, dy });
    };
    const onUp = async (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!started) { setDragDelta(null); return; }
      // The synthesized click that's about to fire on the parent
      // button would toggle the thread — suppress it.
      justDraggedRef.current = true;
      setTimeout(() => { justDraggedRef.current = false; }, 0);
      const dxPx = ev.clientX - startClient.x;
      const dyPx = ev.clientY - startClient.y;
      const dx = Math.round(dxPx / Math.max(0.001, zoom));
      const dy = Math.round(dyPx / Math.max(0.001, zoom));
      if (dx === 0 && dy === 0) { setDragDelta(null); return; }
      const patch = {};
      if (comment.anchor_kind === 'point') {
        patch.anchor_x = (comment.anchor_x || 0) + dx;
        patch.anchor_y = (comment.anchor_y || 0) + dy;
      } else {
        patch.offset_x = (comment.offset_x || 0) + dx;
        patch.offset_y = (comment.offset_y || 0) + dy;
      }
      // Snap the visual delta to whole canvas units (matches what we
      // just committed) and remember the committed values. The effect
      // above clears dragDelta only when comment props reflect them.
      setDragDelta({ dx, dy });
      committedRef.current = comment.anchor_kind === 'point'
        ? { ax: patch.anchor_x, ay: patch.anchor_y }
        : { ox: patch.offset_x, oy: patch.offset_y };
      try {
        await updateComment(comment.id, patch);
      } catch (err) {
        feedback.toast({ type: 'error', message: 'Move failed: ' + (err.message || err) });
        // Roll back — the prop never changed, so just drop the override.
        committedRef.current = null;
        setDragDelta(null);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

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
  const onUnhide = async () => {
    try { await updateComment(comment.id, { hidden: false }); }
    catch (err) { feedback.toast({ type: 'error', message: 'Unhide failed: ' + (err.message || err) }); }
  };
  const onDelete = async () => {
    const ok = await feedback.confirm({
      title: 'Delete comment?',
      message: 'This also removes all replies.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteComment(comment.id);
      // Drop from local state immediately — the realtime DELETE event
      // also fires (replica identity full now includes board_id) but
      // doing both gives instant UX regardless of channel lag.
      onLocallyRemoved?.(comment.id);
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Delete failed: ' + (err.message || err) });
    }
  };

  return (
    <div ref={wrapRef}
         className={`canvas-comment ${open ? 'is-open' : ''} ${comment.resolved ? 'is-resolved' : ''} ${dragDelta ? 'is-dragging' : ''} ${isAuthor ? 'is-mine' : ''} ${isRevealedHidden ? 'is-revealed-hidden' : ''}`}
         style={{ left: v.x, top: v.y, pointerEvents: 'auto' }}>
      {/* Inline preview — body text is always visible so the user can read
          the comment without clicking. The whole card is the click target
          for opening the thread. */}
      <button type="button"
              className="canvas-comment-card"
              aria-expanded={open}
              onClick={() => {
                if (justDraggedRef.current) return;
                setOpen(o => !o);
              }}>
        <span className="canvas-comment-card-head"
              onPointerDown={onDragStart}
              title={isAuthor ? 'Drag to reposition' : undefined}>
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
                           try {
                             await deleteComment(r.id);
                             onLocallyRemoved?.(r.id);
                           } catch (err) { feedback.toast({ type: 'error', message: 'Delete failed' }); }
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
            {comment.hidden
              ? <button type="button" onClick={onUnhide}>Unhide</button>
              : <button type="button" onClick={onHide}>Hide</button>}
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
