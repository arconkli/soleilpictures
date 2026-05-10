import { useEffect, useRef, useState } from 'react';
import { LiveCursor } from './primitives.jsx';

// Render layer for remote-user presence on a canvas board.
//   - Live cursor per peer (transformed by current pan/zoom)
//   - Selection ring on cards another peer has selected (their color)
//   - (Drag is implicit — cards.x/y is Y.Doc-synced so the card itself moves
//      live in everyone's view as a peer drags it.)
//
// Awareness payload conventions (set by CanvasSurface):
//   localState.user            = { id, name, color }
//   localState.canvasCursor    = { boardId, x, y }     // canvas-space coords
//   localState.canvasSelection = { boardId, cardIds, strokeIds, arrowIds }
//   localState.liveDrag        = { boardId, cards: [{id,x,y}] } during drag
export function CanvasPresence({ getAwareness, boardId, pan, zoom, selfId }) {
  const [peers, setPeers] = useState([]);
  // Lerped cursor positions, keyed by clientId. Kept separate from `peers`
  // so the rAF loop can update cursor display without re-running the
  // whole presence aggregation, and so non-positional fields (selection,
  // marquee) still update at change cadence.
  const [cursorDisplay, setCursorDisplay] = useState({});

  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw) return;
    const ALPHA = 0.35;
    const SNAP_PX = 0.5;
    const cursorTargets = { current: {} };
    const cursorState   = { current: {} };
    let rafId = 0;

    const tick = () => {
      rafId = 0;
      const display = cursorState.current;
      const targets = cursorTargets.current;
      let moved = false;
      for (const id in display) {
        const t = targets[id];
        if (!t) continue;
        const dx = t.x - display[id].x;
        const dy = t.y - display[id].y;
        if (Math.abs(dx) < SNAP_PX && Math.abs(dy) < SNAP_PX) {
          if (display[id].x !== t.x || display[id].y !== t.y) {
            display[id] = { x: t.x, y: t.y };
            moved = true;
          }
        } else {
          display[id] = { x: display[id].x + dx * ALPHA, y: display[id].y + dy * ALPHA };
          moved = true;
        }
      }
      if (moved) {
        setCursorDisplay({ ...display });
        rafId = requestAnimationFrame(tick);
      }
    };

    const refresh = () => {
      const states = aw.getStates();
      // Group by user.id and keep only the freshest entry per user, so a
      // peer who reconnected with a new clientID doesn't show as two
      // cursors (one frozen, one live) while the old state ages out.
      const newest = new Map();
      const nextCursorTargets = {};
      states.forEach((state, clientId) => {
        if (!state?.user) return;
        if (state.user.id === selfId) return;
        const cursor = state.canvasCursor;
        const sel = state.canvasSelection;
        const drag = state.liveDrag;
        const marquee = state.marquee;
        const onBoard = (cursor?.boardId === boardId)
                     || (sel?.boardId === boardId)
                     || (drag?.boardId === boardId)
                     || (marquee?.boardId === boardId);
        if (!onBoard) return;
        const meta = aw.meta?.get?.(clientId);
        const updated = meta?.lastUpdated || 0;
        const existing = newest.get(state.user.id);
        if (existing && existing.updated >= updated) return;
        newest.set(state.user.id, {
          clientId,
          updated,
          user: state.user,
          hasCursor: cursor?.boardId  === boardId,
          cardIds:   sel?.boardId     === boardId ? (sel.cardIds   || []) : [],
          strokeIds: sel?.boardId     === boardId ? (sel.strokeIds || []) : [],
          arrowIds:  sel?.boardId     === boardId ? (sel.arrowIds  || []) : [],
          dragCards: drag?.boardId    === boardId ? (drag.cards   || []) : [],
          marquee:   marquee?.boardId === boardId ? marquee : null,
        });
        if (cursor?.boardId === boardId) {
          nextCursorTargets[clientId] = { x: cursor.x, y: cursor.y };
        }
      });
      setPeers([...newest.values()]);
      cursorTargets.current = nextCursorTargets;
      // Snap newcomers to their first reported position (no lerp from 0,0).
      for (const id in nextCursorTargets) {
        if (!(id in cursorState.current)) {
          cursorState.current[id] = { x: nextCursorTargets[id].x, y: nextCursorTargets[id].y };
        }
      }
      // Drop departed peers from the lerp store.
      let dropped = false;
      for (const id in cursorState.current) {
        if (!(id in nextCursorTargets)) {
          delete cursorState.current[id];
          dropped = true;
        }
      }
      if (dropped) setCursorDisplay({ ...cursorState.current });
      if (!rafId) rafId = requestAnimationFrame(tick);
    };
    refresh();
    aw.on('change', refresh);
    return () => {
      aw.off('change', refresh);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [getAwareness, boardId, selfId]);

  // Cursors get rendered in canvas-space, then transformed by the same
  // pan/zoom the canvas itself uses, so a peer's screen-space cursor
  // follows the same coordinate system as the cards.
  return (
    <>
      {/* Peer marquee rectangles — drawn in canvas-space, transformed by the
          parent canvas's pan/zoom so they line up with the cards being
          highlighted. Sit just below cursors but above cards. */}
      <div className="peer-marquees-layer" style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 999990,
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: '0 0',
      }}>
        {peers.map(p => p.marquee && (
          <div key={'mq-' + p.clientId}
               className="peer-marquee"
               style={{
                 position: 'absolute',
                 left: p.marquee.x0,
                 top: p.marquee.y0,
                 width: Math.max(0, p.marquee.x1 - p.marquee.x0),
                 height: Math.max(0, p.marquee.y1 - p.marquee.y0),
                 background: colorWithAlpha(p.user.color || '#4f8df8', 0.10),
                 border: `1px solid ${p.user.color || '#4f8df8'}`,
                 borderRadius: 2,
               }} />
        ))}
      </div>
      <div className="cursors-layer">
        {peers.map(p => {
          if (!p.hasCursor) return null;
          const c = cursorDisplay[p.clientId];
          if (!c) return null;
          return (
            <LiveCursor
              key={p.clientId}
              x={pan.x + c.x * zoom}
              y={pan.y + c.y * zoom}
              name={(p.user.name || '?').split(' ')[0]}
              color={p.user.color || 'var(--soleil)'}
            />
          );
        })}
      </div>
      <PeerSelectionStyles peers={peers} />
    </>
  );
}

// Inject one CSS rule per peer-selected card so the existing card markup
// (`.card[data-card-id="…"]`) gets a colored selection ring without us
// having to traverse and re-render every card on each presence change.
// Selected-by-peer cards get four bracket-corner accents drawn in the peer's
// color via ::before/::after on a wrapper, plus a subtle outer halo so the
// card reads as "selected by someone else." We attach to the card root (not
// :first-child) so the corners overlap the card edge rather than the inner
// content's rounded radius.
function PeerSelectionStyles({ peers }) {
  const styleRef = useRef(null);
  useEffect(() => {
    if (!styleRef.current) {
      const el = document.createElement('style');
      el.dataset.canvasPresence = 'true';
      document.head.appendChild(el);
      styleRef.current = el;
    }
    const rules = [];
    for (const p of peers) {
      const color = p.user.color || '#ffa500';
      for (const id of p.cardIds) {
        const safe = id.replace(/"/g, '\\"');
        // Single clean ring in the peer's color. Outline (not box-shadow)
        // because contain:paint on the card root clips outer shadows but
        // outlines render outside that clip. No second/inner ring — the
        // user explicitly didn't want the double-select look.
        rules.push(
          `.card[data-card-id="${safe}"] {`
          + ` outline: 2px solid ${color};`
          + ` outline-offset: 1px; }`
        );
      }
      // Strokes (free-draw paths) and arrows are array-indexed, not
      // id-keyed. Use the index as a stable enough handle — when peers
      // shuffle the array (delete a stroke), the rule glitches for one
      // frame, then reconciles.
      for (const idx of (p.strokeIds || [])) {
        rules.push(
          `g[data-stroke-idx="${idx}"] path[data-stroke-line] {`
          + ` stroke: ${color} !important;`
          + ` filter: drop-shadow(0 0 3px ${color}); }`
        );
      }
      for (const idx of (p.arrowIds || [])) {
        rules.push(
          `g[data-arrow-idx="${idx}"] path[data-arrow-line] {`
          + ` stroke: ${color} !important;`
          + ` opacity: 0.95 !important;`
          + ` filter: drop-shadow(0 0 3px ${color}); }`
          + `\n`
          + `g[data-arrow-idx="${idx}"] polygon {`
          + ` fill: ${color} !important;`
          + ` opacity: 0.95 !important; }`
        );
      }
    }
    styleRef.current.textContent = rules.join('\n');
    return () => {};
  }, [peers]);
  useEffect(() => () => {
    if (styleRef.current?.parentNode) styleRef.current.parentNode.removeChild(styleRef.current);
    styleRef.current = null;
  }, []);
  return null;
}

function colorWithAlpha(c, a) {
  // Accept #rrggbb only (we control the palette); fall back to rgba(255,165,0,…).
  if (typeof c === 'string' && c.startsWith('#') && c.length === 7) {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return `rgba(255,165,0,${a})`;
}
