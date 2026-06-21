// Vote cards on canvas — a separate annotation type that behaves like a
// comment (anchored to a card/group/point/board, draggable, hides with the
// comments eye toggle) but renders a tiny up/down poll: a ✓ with the
// up-count and an ✗ with the down-count. Any reader can vote; the author
// can drag, label, and delete. Anchoring math + the drag pattern are shared
// with CanvasComment (bubbleLayout). Counts + the caller's own vote come
// pre-derived from list_vote_cards (see useVoteCards / migration 0160).
//
// Coordinate model mirrors comments:
//   anchor_kind = 'card'  → bounds via resolveCardBBox(anchor_id)
//   anchor_kind = 'group' → bounds via resolveGroupBBox(anchor_id)
//   anchor_kind = 'point' → anchor_x/y are canvas-space coords
//   anchor_kind = 'board' → free placement near top-left

import { useEffect, useRef, useState } from 'react';
import { updateVoteCard, deleteVoteCard, castVote } from '../lib/voteCardsApi.js';
import { bubbleLayout } from '../lib/bubbleLayout.js';
import { useFeedback } from './AppFeedback.jsx';
import { pickPresenceColor } from '../lib/presenceColor.js';

const VOTE_W = 132;   // initial estimate — replaced by ResizeObserver measure
const VOTE_H = 40;

export function CanvasVoteLayer({
  voteCards, userId, currentUser,
  zoom = 1,
  resolveCardBBox, resolveGroupBBox,
  onLocallyRemoved,
  // Master visibility — shared with comments (the canvas eye toggle).
  // When false, render only small anchor dots so users still see WHERE
  // votes live without the widget chrome.
  layerVisible = true,
}) {
  const cards = (voteCards || []).filter(v => !v.resolved && !v.hidden);

  if (!layerVisible) {
    return (
      <div className="canvas-vote-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {cards.map(v => {
          const layout = bubbleLayout(v, resolveCardBBox, resolveGroupBBox, {
            ox: v.offset_x || 0, oy: v.offset_y || 0,
            ax: v.anchor_x || 0, ay: v.anchor_y || 0,
          });
          const p = layout.dot;
          if (!p) return null;
          return <VoteAnchorDot key={v.id} x={p.x} y={p.y} color={pickPresenceColor(v.author || '')} />;
        })}
      </div>
    );
  }

  if (!cards.length) return null;
  return (
    <div className="canvas-vote-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {cards.map(v => (
        <VoteCardBubble
          key={v.id}
          vote={v}
          userId={userId}
          currentUser={currentUser}
          zoom={zoom}
          resolveCardBBox={resolveCardBBox}
          resolveGroupBBox={resolveGroupBBox}
          onLocallyRemoved={onLocallyRemoved}
        />
      ))}
    </div>
  );
}

// Toggle math for the optimistic display: applying `value` (+1/-1) given
// the current view. Re-casting your current value removes it; the opposite
// switches. Mirrors the server-side cast_vote logic.
function nextVote(view, value) {
  let { my_value: my, up, down } = view;
  if (my === 1) up -= 1; else if (my === -1) down -= 1;
  if (my === value) {
    my = null;                              // toggle off
  } else {
    my = value;
    if (value === 1) up += 1; else down += 1;
  }
  return { my_value: my, up, down };
}

function VoteCardBubble({ vote, userId, currentUser, zoom = 1, resolveCardBBox, resolveGroupBBox, onLocallyRemoved }) {
  const feedback = useFeedback();
  const isAuthor = vote.author === userId;
  const dotColor = (isAuthor && currentUser?.color) ? currentUser.color : pickPresenceColor(vote.author || '');

  // ── Optimistic vote state ────────────────────────────────────────────
  // Show the user's click instantly; release back to the prop once the
  // realtime refetch catches up (my_value matches what we optimistically
  // set), mirroring the comment drag's baseRef/committedRef discipline.
  const [optimistic, setOptimistic] = useState(null);
  useEffect(() => {
    if (optimistic && (vote.my_value ?? null) === optimistic.my_value) setOptimistic(null);
  }, [vote.my_value, vote.up_count, vote.down_count]); // eslint-disable-line react-hooks/exhaustive-deps
  const view = optimistic || {
    my_value: vote.my_value ?? null,
    up: vote.up_count || 0,
    down: vote.down_count || 0,
  };

  const onVote = async (value) => {
    const nv = nextVote(view, value);
    setOptimistic(nv);
    try {
      await castVote(vote.id, value);
    } catch (err) {
      setOptimistic(null); // roll back to the prop on failure
      feedback.toast({ type: 'error', message: 'Vote failed: ' + (err.message || err) });
    }
  };

  // ── Label editing (author only) ──────────────────────────────────────
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(vote.label || '');
  useEffect(() => { if (!editingLabel) setLabelDraft(vote.label || ''); }, [vote.label, editingLabel]);
  const commitLabel = async () => {
    setEditingLabel(false);
    const next = labelDraft.trim();
    if (next === (vote.label || '')) return;
    try { await updateVoteCard(vote.id, { label: next || null }); }
    catch (err) { feedback.toast({ type: 'error', message: 'Save failed: ' + (err.message || err) }); }
  };

  // ── Drag-to-reposition (author only) — copied from CanvasCommentBubble.
  const baseRef = useRef(null);
  const committedRef = useRef(null);
  useEffect(() => {
    const next = {
      ox: vote.offset_x || 0, oy: vote.offset_y || 0,
      ax: vote.anchor_x || 0, ay: vote.anchor_y || 0,
    };
    if (baseRef.current === null) { baseRef.current = next; return; }
    if (committedRef.current) {
      const c = committedRef.current;
      const matched = vote.anchor_kind === 'point'
        ? (vote.anchor_x === c.ax && vote.anchor_y === c.ay)
        : (vote.offset_x === c.ox && vote.offset_y === c.oy);
      if (matched) { committedRef.current = null; baseRef.current = next; }
      return;
    }
    baseRef.current = next;
  }, [vote.offset_x, vote.offset_y, vote.anchor_x, vote.anchor_y, vote.anchor_kind]);

  const [dragDelta, setDragDelta] = useState(null);
  const justDraggedRef = useRef(false);

  const elRef = useRef(null);
  const [dim, setDim] = useState({ w: VOTE_W, h: VOTE_H });
  useEffect(() => {
    if (!elRef.current || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const el = elRef.current;
      if (!el) return;
      const w = el.offsetWidth || VOTE_W;
      const h = el.offsetHeight || VOTE_H;
      setDim(prev => (prev.w === w && prev.h === h) ? prev : { w, h });
    });
    ro.observe(elRef.current);
    return () => ro.disconnect();
  }, []);

  const baseVals = baseRef.current || {
    ox: vote.offset_x || 0, oy: vote.offset_y || 0,
    ax: vote.anchor_x || 0, ay: vote.anchor_y || 0,
  };
  const liveBase = dragDelta
    ? { ...baseVals, ox: baseVals.ox + dragDelta.dx, oy: baseVals.oy + dragDelta.dy }
    : baseVals;
  const layout = bubbleLayout(vote, resolveCardBBox, resolveGroupBBox, liveBase, dim);
  const cp = layout.bubble;
  const anchorPt = layout.dot;

  const onDragStart = (e) => {
    if (!isAuthor) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    const startClient = { x: e.clientX, y: e.clientY };
    let started = false;
    const onMove = (ev) => {
      const dxPx = ev.clientX - startClient.x;
      const dyPx = ev.clientY - startClient.y;
      if (!started && Math.hypot(dxPx, dyPx) < 4) return;
      started = true;
      setDragDelta({ dx: dxPx / Math.max(0.001, zoom), dy: dyPx / Math.max(0.001, zoom) });
    };
    const onUp = async (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!started) { setDragDelta(null); return; }
      justDraggedRef.current = true;
      setTimeout(() => { justDraggedRef.current = false; }, 0);
      const dx = Math.round((ev.clientX - startClient.x) / Math.max(0.001, zoom));
      const dy = Math.round((ev.clientY - startClient.y) / Math.max(0.001, zoom));
      if (dx === 0 && dy === 0) { setDragDelta(null); return; }
      const base = baseRef.current || {
        ox: vote.offset_x || 0, oy: vote.offset_y || 0,
        ax: vote.anchor_x || 0, ay: vote.anchor_y || 0,
      };
      const patch = {};
      let next;
      if (vote.anchor_kind === 'point') {
        patch.anchor_x = base.ax + dx;
        patch.anchor_y = base.ay + dy;
        next = { ...base, ax: patch.anchor_x, ay: patch.anchor_y };
      } else {
        patch.offset_x = base.ox + dx;
        patch.offset_y = base.oy + dy;
        next = { ...base, ox: patch.offset_x, oy: patch.offset_y };
      }
      baseRef.current = next;
      committedRef.current = vote.anchor_kind === 'point'
        ? { ax: patch.anchor_x, ay: patch.anchor_y }
        : { ox: patch.offset_x, oy: patch.offset_y };
      setDragDelta(null);
      try {
        await updateVoteCard(vote.id, patch);
      } catch (err) {
        feedback.toast({ type: 'error', message: 'Move failed: ' + (err.message || err) });
        baseRef.current = {
          ox: vote.offset_x || 0, oy: vote.offset_y || 0,
          ax: vote.anchor_x || 0, ay: vote.anchor_y || 0,
        };
        committedRef.current = null;
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onDelete = async () => {
    const ok = await feedback.confirm({
      title: 'Delete vote?',
      message: 'This removes the vote and its tally.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteVoteCard(vote.id);
      onLocallyRemoved?.(vote.id);
    } catch (err) {
      feedback.toast({ type: 'error', message: 'Delete failed: ' + (err.message || err) });
    }
  };

  return (
    <div ref={elRef}
         className={`canvas-vote ${dragDelta ? 'is-dragging' : ''} ${isAuthor ? 'is-mine' : ''}`}
         style={{ left: cp.x, top: cp.y, pointerEvents: 'auto' }}>
      {anchorPt && (
        <div className="canvas-vote-anchor-host"
             style={{ position: 'absolute', left: anchorPt.x - cp.x, top: anchorPt.y - cp.y, width: 0, height: 0 }}>
          <div className="canvas-vote-anchor-dot"
               style={{
                 position: 'absolute', left: -3, top: -3, width: 6, height: 6,
                 borderRadius: '50%', background: dotColor,
                 boxShadow: '0 0 0 1.5px var(--bg-1)', pointerEvents: 'none',
               }} />
        </div>
      )}
      <div className="canvas-vote-card">
        {/* Drag handle (author) — a slim grip strip; click does nothing,
            it exists so the whole card isn't a drag target (the buttons
            stay clickable). */}
        {isAuthor && (
          <span className="canvas-vote-grip"
                title="Drag to reposition"
                onPointerDown={onDragStart}
                aria-hidden="true">⠿</span>
        )}
        {/* Optional question label */}
        {editingLabel ? (
          <input className="canvas-vote-label-input"
                 autoFocus
                 value={labelDraft}
                 placeholder="Add a question…"
                 onChange={(e) => setLabelDraft(e.target.value)}
                 onBlur={commitLabel}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter') { e.preventDefault(); commitLabel(); }
                   if (e.key === 'Escape') { setEditingLabel(false); setLabelDraft(vote.label || ''); }
                 }} />
        ) : (vote.label
          ? <span className={`canvas-vote-label ${isAuthor ? 'is-editable' : ''}`}
                  title={isAuthor ? 'Click to edit' : undefined}
                  onClick={() => isAuthor && setEditingLabel(true)}>{vote.label}</span>
          : (isAuthor && (
              <button type="button" className="canvas-vote-label-add"
                      onClick={() => setEditingLabel(true)}>+ question</button>
            ))
        )}
        <div className="canvas-vote-buttons">
          <button type="button"
                  className={`canvas-vote-btn up ${view.my_value === 1 ? 'is-active' : ''}`}
                  title="Vote up"
                  onClick={() => onVote(1)}>
            <span className="canvas-vote-mark" aria-hidden="true">✓</span>
            <span className="canvas-vote-count">{view.up}</span>
          </button>
          <button type="button"
                  className={`canvas-vote-btn down ${view.my_value === -1 ? 'is-active' : ''}`}
                  title="Vote down"
                  onClick={() => onVote(-1)}>
            <span className="canvas-vote-mark" aria-hidden="true">✗</span>
            <span className="canvas-vote-count">{view.down}</span>
          </button>
        </div>
        {isAuthor && (
          <button type="button" className="canvas-vote-del"
                  title="Delete vote" onClick={onDelete} aria-label="Delete vote">×</button>
        )}
      </div>
    </div>
  );
}

// Tiny filled dot at the anchor's connection point — the only chrome that
// remains when the comments eye is muted (votes hide with comments).
function VoteAnchorDot({ x, y, color }) {
  const SIZE = 6;
  return (
    <div className="canvas-vote-anchor-dot"
         title="Vote"
         style={{
           position: 'absolute', left: x - SIZE / 2, top: y - SIZE / 2,
           width: SIZE, height: SIZE, borderRadius: '50%', background: color,
           boxShadow: '0 0 0 1.5px var(--bg-1)', pointerEvents: 'none',
         }} />
  );
}
