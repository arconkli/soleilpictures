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

import { useEffect, useReducer, useRef, useState } from 'react';
import { addComment, updateComment, deleteComment } from '../lib/commentsApi.js';
import { bubbleLayout, clamp, BUBBLE_W, BUBBLE_H_DEFAULT } from '../lib/bubbleLayout.js';
import { useFeedback } from './AppFeedback.jsx';
import { relativeTimeShort } from '../lib/relativeTime.js';
import * as userProfiles from '../lib/userProfiles.js';
import { pickPresenceColor } from '../lib/presenceColor.js';

export function CanvasCommentLayer({
  comments, boardId, workspaceId, userId, wsPeers = [],
  // Current user (id, name, color). Lets the local user's name/color
  // stay consistent even when they're not in wsPeers (e.g. fresh page
  // load before presence syncs).
  currentUser,
  // Current zoom — used by drag handlers to convert pointer-pixel
  // deltas into canvas-space deltas. Bubble positions themselves are
  // pure canvas coordinates because the layer mounts INSIDE the
  // canvas transform; it scales with the rest of the board content.
  zoom = 1,
  // Resolve a card / group id to its current bounding box in canvas space,
  // for anchor_kind='card'/'group'. Returns null when the element no
  // longer exists.
  resolveCardBBox, resolveGroupBBox,
  // Inline-draft state. When set, the layer renders an inline input at
  // the given canvas position. submitting calls onSubmitDraft; Esc /
  // outside-click calls onCancelDraft.
  draft, onSubmitDraft, onCancelDraft,
  // Optimistic local removal — invoked right after a successful delete
  // so the bubble disappears without waiting for the realtime fan-out.
  onLocallyRemoved,
  // Master visibility — when false, every comment bubble is hidden;
  // we render small "anchor dots" instead so the user can still see
  // WHERE comments live without the bubble chrome.
  layerVisible = true,
  // Per-user "last viewed" timestamps for top-level threads. Used to
  // render the small unread-reply dot. onMarkViewed is called when a
  // bubble opens to clear the dot.
  viewsByRootId = new Map(),
  onMarkViewed,
}) {
  // Re-render whenever the userProfiles cache resolves a new entry.
  // One subscription for the whole layer (cheaper than per-bubble),
  // and the cache itself is what feeds resolveAuthor below.
  const [, tickProfiles] = useReducer(x => x + 1, 0);
  useEffect(() => userProfiles.subscribe(tickProfiles), []);

  // Index replies by parent so the top-level bubble can render its thread.
  // Skip resolved + hidden comments entirely; resolved goes to the
  // History tab and the comment archive popover, hidden goes to the
  // archive popover (and History tab).
  const byParent = new Map();
  const tops = [];
  for (const c of (comments || [])) {
    if (c.resolved) continue;
    if (c.hidden) continue;
    if (c.reply_to) {
      const arr = byParent.get(c.reply_to) || [];
      arr.push(c);
      byParent.set(c.reply_to, arr);
    } else {
      tops.push(c);
    }
  }
  // When the master eye is off, replace every bubble with just the
  // small anchor dot — at the EXACT perimeter point the bubble was
  // meeting before. Computed from the same bubbleLayout used while
  // bubbles render, so toggling the eye off doesn't visually move
  // the dots.
  if (!layerVisible) {
    return (
      <div className="canvas-comment-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {tops.map(c => {
          const layout = bubbleLayout(c, resolveCardBBox, resolveGroupBBox, {
            ox: c.offset_x || 0, oy: c.offset_y || 0,
            ax: c.anchor_x || 0, ay: c.anchor_y || 0,
          });
          const p = layout.dot;
          if (!p) return null;
          const color = resolveAuthor(c.author, currentUser).color;
          return (
            <CommentAnchorDot key={c.id}
                              x={p.x} y={p.y}
                              color={color}
                              count={(byParent.get(c.id) || []).length + 1} />
          );
        })}
      </div>
    );
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
          currentUser={currentUser}
          zoom={zoom}
          resolveCardBBox={resolveCardBBox}
          resolveGroupBBox={resolveGroupBBox}
          onLocallyRemoved={onLocallyRemoved}
          lastViewedAt={viewsByRootId.get(c.id) || null}
          onMarkViewed={onMarkViewed}
        />
      ))}
      {draft && (
        <CanvasCommentDraft
          canvasPos={draft.canvasPos}
          onSubmit={onSubmitDraft}
          onCancel={onCancelDraft}
        />
      )}
    </div>
  );
}

function CanvasCommentDraft({ canvasPos, onSubmit, onCancel }) {
  const [body, setBody] = useState('');
  const ref = useRef(null);
  // Outside click + Escape cancel.
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return;
      onCancel?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') onCancel?.(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
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
         style={{ left: canvasPos.x, top: canvasPos.y, pointerEvents: 'auto' }}
         onMouseDown={(e) => e.stopPropagation()}
         onPointerDown={(e) => e.stopPropagation()}>
      <form className="canvas-comment-card canvas-comment-card-draft"
            onSubmit={(e) => { e.preventDefault(); onSubmit?.(body); }}>
        <textarea className="canvas-comment-draft-input"
                  autoFocus
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
  return anchorPointFromBase(comment, resolveCardBBox, resolveGroupBBox, {
    ox: comment.offset_x || 0,
    oy: comment.offset_y || 0,
    ax: comment.anchor_x || 0,
    ay: comment.anchor_y || 0,
  });
}

// Same as anchorPoint but takes the offset/anchor values explicitly,
// so the bubble component can use a baseRef of "what we believe the
// committed values are" instead of the (possibly-stale) prop. Critical
// for the rapid-drag case where the prop hasn't fanned out yet.
function anchorPointFromBase(comment, resolveCardBBox, resolveGroupBBox, base) {
  return bubbleLayout(comment, resolveCardBBox, resolveGroupBBox, base).bubble;
}

// bubbleLayout / snapBubbleToBox / clamp / BUBBLE_W / BUBBLE_H_DEFAULT now
// live in ../lib/bubbleLayout.js (shared with the vote-card layer).

// Resolve a name/color for any author id. The local user always
// resolves to currentUser (their saved profile) so they stay
// consistent everywhere they appear. For everyone else we consult
// the userProfiles cache — populated synchronously from workspace
// presence AND asynchronously from the profiles table (display_name
// / color) + users_by_ids (email fallback). resolve() schedules a
// fetch the first time we see an unknown id and the layer re-renders
// when it arrives. The deterministic palette color from
// pickPresenceColor() makes sure even a never-resolved id renders
// with a stable, non-default avatar.
function resolveAuthor(authorId, currentUser) {
  if (authorId && currentUser && authorId === currentUser.id) {
    return {
      name:  currentUser.name  || (currentUser.email ? currentUser.email.split('@')[0] : null) || 'you',
      color: currentUser.color || pickPresenceColor(authorId),
    };
  }
  const entry = userProfiles.resolve(authorId);
  return {
    name:  entry?.name || (entry?.email ? entry.email.split('@')[0] : null) || 'Member',
    color: entry?.color || pickPresenceColor(authorId || ''),
  };
}

function CanvasCommentBubble({ comment, replies, boardId, workspaceId, userId, wsPeers, currentUser, zoom = 1, resolveCardBBox, resolveGroupBBox, onLocallyRemoved, lastViewedAt = null, onMarkViewed }) {
  const feedback = useFeedback();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const isAuthor = comment.author === userId;
  const _resolved = resolveAuthor(comment.author, currentUser);
  const author = _resolved.name;
  const authorColor = _resolved.color;
  const replyCount = replies?.length || 0;

  // Unread = any reply not authored by me, newer than my last-viewed
  // timestamp on this thread. No view row yet → every other-author
  // reply is unread until the user opens it.
  const hasUnreadReplies = !!replies?.some(r =>
    r.author !== userId &&
    (!lastViewedAt || (r.created_at && r.created_at > lastViewedAt))
  );

  // Mark viewed the moment the user opens the thread. Fire-and-forget.
  useEffect(() => {
    if (open && onMarkViewed) onMarkViewed(comment.id);
  }, [open, comment.id, onMarkViewed]);

  // baseRef is what WE believe the comment's offsets are. While idle,
  // it tracks the prop. On commit we update it synchronously to the
  // values we just sent, so a follow-up drag chains off the latest
  // commit instead of off a stale prop. committedRef holds the most
  // recent committed values; we release control back to the prop only
  // when the prop catches up (out-of-order earlier props are ignored
  // to prevent the visible snap-back glitch).
  const baseRef = useRef(null);
  const committedRef = useRef(null);
  useEffect(() => {
    const next = {
      ox: comment.offset_x || 0, oy: comment.offset_y || 0,
      ax: comment.anchor_x || 0, ay: comment.anchor_y || 0,
    };
    if (baseRef.current === null) {
      baseRef.current = next;
      return;
    }
    if (committedRef.current) {
      const c = committedRef.current;
      const matched = comment.anchor_kind === 'point'
        ? (comment.anchor_x === c.ax && comment.anchor_y === c.ay)
        : (comment.offset_x === c.ox && comment.offset_y === c.oy);
      if (matched) {
        committedRef.current = null;
        baseRef.current = next;
      }
      return;
    }
    baseRef.current = next;
  }, [comment.offset_x, comment.offset_y, comment.anchor_x, comment.anchor_y, comment.anchor_kind]);

  // Live drag delta — only set during an active drag, cleared on
  // pointer-up. The new visible position chains via baseRef so we
  // don't need to hold the delta after commit.
  const [dragDelta, setDragDelta] = useState(null);
  // Suppresses the synthesized click that fires after pointerup of a
  // drag, so dragging the head doesn't accidentally toggle the thread.
  const justDraggedRef = useRef(false);

  // Measured bubble dimensions — the preview card's real height
  // varies with content (one-line vs. two-line body, reply count
  // present or not). The TOP-side layout needs the real height to
  // place the bubble flush against the card's top edge; otherwise a
  // fixed estimate leaves a visible gap.
  const cardElRef = useRef(null);
  const [bubbleDim, setBubbleDim] = useState({ w: BUBBLE_W, h: BUBBLE_H_DEFAULT });
  useEffect(() => {
    if (!cardElRef.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const el = cardElRef.current;
      if (!el) return;
      const w = el.offsetWidth || BUBBLE_W;
      const h = el.offsetHeight || BUBBLE_H_DEFAULT;
      setBubbleDim(prev => (prev.w === w && prev.h === h) ? prev : { w, h });
    });
    ro.observe(cardElRef.current);
    return () => ro.disconnect();
  }, []);

  const baseVals = baseRef.current || {
    ox: comment.offset_x || 0, oy: comment.offset_y || 0,
    ax: comment.anchor_x || 0, ay: comment.anchor_y || 0,
  };
  // While dragging, treat the cumulative drag delta as a bump to the
  // base offset BEFORE running the layout snap. That way the bubble
  // re-snaps to a different side mid-drag if the user pulls it
  // around the card; without this, dragDelta would just translate the
  // already-snapped bubble, which feels disconnected.
  const liveBase = dragDelta
    ? { ...baseVals, ox: baseVals.ox + dragDelta.dx, oy: baseVals.oy + dragDelta.dy }
    : baseVals;
  const layout = bubbleLayout(comment, resolveCardBBox, resolveGroupBBox, liveBase, bubbleDim);
  const liveCp = layout.bubble;
  const anchorPt = layout.dot;

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
      // Chain off baseRef (latest committed values), NOT off the prop —
      // the prop may still be stale from the previous drag's realtime
      // round-trip. This is what fixed the "drags lag and snap to old
      // positions" glitch when moving rapidly.
      const base = baseRef.current || {
        ox: comment.offset_x || 0, oy: comment.offset_y || 0,
        ax: comment.anchor_x || 0, ay: comment.anchor_y || 0,
      };
      const patch = {};
      let next;
      if (comment.anchor_kind === 'point') {
        patch.anchor_x = base.ax + dx;
        patch.anchor_y = base.ay + dy;
        next = { ...base, ax: patch.anchor_x, ay: patch.anchor_y };
      } else {
        patch.offset_x = base.ox + dx;
        patch.offset_y = base.oy + dy;
        next = { ...base, ox: patch.offset_x, oy: patch.offset_y };
      }
      // Update baseRef SYNCHRONOUSLY so cp recomputes to the new
      // position immediately. dragDelta is no longer needed for
      // visual continuity; clear it so subsequent renders aren't
      // double-applying the offset.
      baseRef.current = next;
      committedRef.current = comment.anchor_kind === 'point'
        ? { ax: patch.anchor_x, ay: patch.anchor_y }
        : { ox: patch.offset_x, oy: patch.offset_y };
      setDragDelta(null);
      try {
        await updateComment(comment.id, patch);
      } catch (err) {
        feedback.toast({ type: 'error', message: 'Move failed: ' + (err.message || err) });
        // Roll back — restore baseRef to the last known prop value so
        // the bubble snaps back rather than appearing committed.
        baseRef.current = {
          ox: comment.offset_x || 0, oy: comment.offset_y || 0,
          ax: comment.anchor_x || 0, ay: comment.anchor_y || 0,
        };
        committedRef.current = null;
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
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
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

  // The bubble lays out flush against the anchor's perimeter (see
  // bubbleLayout / snapBubbleToBox). The dot sits at the seam where
  // the bubble meets the card — no separate connector line.

  // Keyboard delete — when the thread is open and no text input has
  // focus, Delete / Backspace triggers the same delete flow as the
  // action button. Lets users select-and-delete the way they do with
  // cards. We listen on the document while open so the binding doesn't
  // intercept other shortcuts elsewhere.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const t = e.target;
      // Skip if the user is typing inside an input / textarea /
      // contenteditable — including the comment's own reply field.
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // Only authors can delete; everyone else's keypress is a no-op.
      if (!isAuthor) return;
      e.preventDefault();
      onDelete();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isAuthor]);

  return (
    <div ref={wrapRef}
         className={`canvas-comment ${open ? 'is-open' : ''} ${comment.resolved ? 'is-resolved' : ''} ${dragDelta ? 'is-dragging' : ''} ${isAuthor ? 'is-mine' : ''}`}
         style={{ left: liveCp.x, top: liveCp.y, pointerEvents: 'auto' }}>
      {anchorPt && (
        <div className="canvas-comment-anchor-host"
             style={{
               position: 'absolute',
               left: anchorPt.x - liveCp.x,
               top:  anchorPt.y - liveCp.y,
               width: 0, height: 0,
             }}>
          <div className="canvas-comment-anchor-dot"
               style={{
                 position: 'absolute',
                 left: -3, top: -3,
                 width: 6, height: 6,
                 borderRadius: '50%',
                 background: authorColor,
                 boxShadow: '0 0 0 1.5px var(--bg-1)',
                 pointerEvents: 'none',
               }} />
        </div>
      )}
      {/* Inline preview — body text is always visible so the user can read
          the comment without clicking. The whole card is the click target
          for opening the thread AND the drag handle (when the user is
          the author). justDraggedRef suppresses the click that would
          otherwise toggle the thread after a drag. */}
      <button type="button"
              ref={cardElRef}
              className="canvas-comment-card"
              aria-expanded={open}
              onPointerDown={onDragStart}
              title={isAuthor ? 'Drag to reposition · click to open' : undefined}
              onClick={() => {
                if (justDraggedRef.current) return;
                setOpen(o => !o);
              }}>
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
        {hasUnreadReplies && !open && (
          <span className="canvas-comment-unread-dot" aria-label="Unread reply" />
        )}
      </button>
      {open && (
        <div className="canvas-comment-thread">
          {replies.map(r => {
            const ra = resolveAuthor(r.author, currentUser);
            return (
            <CommentLine key={r.id}
                         c={r}
                         authorName={ra.name}
                         authorColor={ra.color}
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

// Pick a canvas-space point on the anchored card/group/point border
// where the comment's connector visually meets it. We anchor on the
// perimeter point closest to the bubble's center so the dot looks
// like the natural exit point of a leader line — even though we
// rarely draw the line. For point anchors it's the literal stored
// point. Returns null for board / doc_range anchors.
function anchorDotPoint(comment, resolveCardBBox, resolveGroupBBox, bubbleCenter = null) {
  let bbox = null;
  if (comment.anchor_kind === 'card')  bbox = resolveCardBBox?.(comment.anchor_id);
  if (comment.anchor_kind === 'group') bbox = resolveGroupBBox?.(comment.anchor_id);
  if (bbox) {
    const cx = bubbleCenter?.x ?? (bbox.x + bbox.w);
    const cy = bubbleCenter?.y ?? bbox.y;
    return {
      x: clamp(cx, bbox.x, bbox.x + bbox.w),
      y: clamp(cy, bbox.y, bbox.y + bbox.h),
    };
  }
  if (comment.anchor_kind === 'point') {
    return { x: comment.anchor_x ?? 0, y: comment.anchor_y ?? 0 };
  }
  return null;
}

// Tiny filled dot at the anchor's connection point. 6px diameter,
// tinted with the author's color. Used both as the always-visible
// "this comment is attached here" marker and as the only chrome that
// remains when the master eye is muted. Pure visual — no interaction.
function CommentAnchorDot({ x, y, color, count = 1 }) {
  const SIZE = 6;
  return (
    <div className="canvas-comment-anchor-dot"
         title={count === 1 ? '1 comment' : `${count} comments`}
         style={{
           position: 'absolute',
           left: x - SIZE / 2, top: y - SIZE / 2,
           width: SIZE, height: SIZE,
           borderRadius: '50%',
           background: color,
           boxShadow: `0 0 0 1.5px var(--bg-1)`,
           pointerEvents: 'none',
         }} />
  );
}

// Optional curved leader — drawn only when the bubble has been dragged
// far enough from its anchor that proximity wouldn't communicate the
// attachment. Quadratic Bezier with the control point pushed
// perpendicular to the line direction; the result reads as a soft
// thread rather than a CAD ruler. 1px non-scaling stroke at low
// opacity so it sits on the canvas without shouting.
function CommentConnectorLine({ ax, ay, bx, by, color }) {
  // Mid-point with a perpendicular offset for the control point. The
  // offset scales with the distance — short connectors get a gentle
  // bend, long ones get a more pronounced arc.
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const offset = Math.min(48, Math.max(10, len * 0.18));
  // Perpendicular vector (rotated 90deg). Pick the side that bends
  // away from the bubble's center (deterministic for a given pair).
  const px = -dy / len;
  const py =  dx / len;
  const mx = (ax + bx) / 2 + px * offset;
  const my = (ay + by) / 2 + py * offset;

  const PAD = 32;
  const minX = Math.min(ax, bx, mx) - PAD;
  const minY = Math.min(ay, by, my) - PAD;
  const maxX = Math.max(ax, bx, mx) + PAD;
  const maxY = Math.max(ay, by, my) + PAD;
  const w = maxX - minX;
  const h = maxY - minY;

  return (
    <svg className="canvas-comment-connector-line"
         width={w} height={h}
         viewBox={`${minX} ${minY} ${w} ${h}`}
         style={{
           position: 'absolute',
           left: minX, top: minY,
           pointerEvents: 'none',
           overflow: 'visible',
         }}>
      <path d={`M${ax},${ay} Q${mx},${my} ${bx},${by}`}
            fill="none"
            stroke={color}
            strokeOpacity="0.38"
            strokeWidth="1.25"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Archive popover — opens on right-click of the comments eye toggle.
// Lists every resolved + hidden top-level comment on this board with
// per-row reopen / unhide / delete actions. Read-mostly: a quick way
// to recover comments without leaving the canvas. The full History
// modal's Comments tab covers richer auditing.
export function CommentArchivePopover({
  comments, anchorRect, userId, wsPeers = [], currentUser, onClose, onLocallyRemoved,
}) {
  const feedback = useFeedback();
  const ref = useRef(null);
  // Re-render when userProfiles cache resolves any author async.
  const [, tickProfiles] = useReducer(x => x + 1, 0);
  useEffect(() => userProfiles.subscribe(tickProfiles), []);
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return;
      onClose?.();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const archived = (comments || [])
    .filter(c => !c.reply_to && (c.resolved || c.hidden))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const onReopen = async (c) => {
    try { await updateComment(c.id, { resolved: false, hidden: false }); }
    catch (err) { feedback.toast({ type: 'error', message: 'Reopen failed: ' + (err.message || err) }); }
  };
  const onUnhide = async (c) => {
    try { await updateComment(c.id, { hidden: false }); }
    catch (err) { feedback.toast({ type: 'error', message: 'Unhide failed: ' + (err.message || err) }); }
  };
  const onDeleteRow = async (c) => {
    const ok = await feedback.confirm({
      title: 'Delete comment?', confirmLabel: 'Delete', danger: true,
      message: 'Permanent — also removes any replies.',
    });
    if (!ok) return;
    try {
      await deleteComment(c.id);
      onLocallyRemoved?.(c.id);
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Delete failed: ' + (err.message || err) });
    }
  };

  // Position the popover next to the eye toggle. Anchor's right edge
  // + a small gap; clamp to viewport.
  const PAD = 8;
  const W = 320;
  const left = Math.min(window.innerWidth - W - PAD,
                        Math.max(PAD, (anchorRect?.right ?? 14) + 8));
  const top  = Math.min(window.innerHeight - 360,
                        Math.max(PAD, anchorRect?.top ?? 14));

  return (
    <div ref={ref}
         className="comment-archive"
         role="dialog"
         style={{ position: 'fixed', left, top, width: W }}>
      <div className="comment-archive-head">
        <span className="comment-archive-title">Archived comments</span>
        <button className="comment-archive-x" aria-label="Close" onClick={onClose}>✕</button>
      </div>
      <div className="comment-archive-body">
        {archived.length === 0 && (
          <div className="comment-archive-empty">
            No resolved or hidden comments on this board.
          </div>
        )}
        {archived.map(c => {
          const ra = resolveAuthor(c.author, currentUser);
          const name = ra.name;
          const color = ra.color;
          const status = c.resolved ? 'resolved' : 'hidden';
          return (
            <div key={c.id} className={`comment-archive-row is-${status}`}>
              <div className="comment-archive-row-head">
                <span className="canvas-comment-avatar canvas-comment-avatar-sm"
                      style={{ background: color }}>
                  {(name || '?')[0].toUpperCase()}
                </span>
                <span className="canvas-comment-author">{name}</span>
                <span className="canvas-comment-when">{relativeTimeShort(c.created_at)}</span>
                <span className={`comment-archive-tag is-${status}`}>{status}</span>
              </div>
              <div className="comment-archive-body-text" title={c.body}>{c.body}</div>
              <div className="comment-archive-row-actions">
                {c.resolved
                  ? <button onClick={() => onReopen(c)}>Reopen</button>
                  : <button onClick={() => onUnhide(c)}>Unhide</button>}
                <button className="danger" onClick={() => onDeleteRow(c)}>Delete</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
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
