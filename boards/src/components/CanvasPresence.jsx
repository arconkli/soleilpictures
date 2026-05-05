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
//   localState.canvasSelection = { boardId, cardIds }  // string[]
//   localState.liveDrag        = { boardId, cards: [{id,x,y}] } during drag
export function CanvasPresence({ getAwareness, boardId, pan, zoom, selfId }) {
  const [peers, setPeers] = useState([]);

  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw) return;
    const refresh = () => {
      const states = aw.getStates();
      const out = [];
      states.forEach((state, clientId) => {
        if (!state?.user) return;
        if (state.user.id === selfId) return;       // skip self
        const cursor = state.canvasCursor;
        const sel = state.canvasSelection;
        const drag = state.liveDrag;
        const marquee = state.marquee;
        const onBoard = (cursor?.boardId === boardId)
                     || (sel?.boardId === boardId)
                     || (drag?.boardId === boardId)
                     || (marquee?.boardId === boardId);
        if (!onBoard) return;
        out.push({
          clientId,
          user: state.user,
          cursor:    cursor?.boardId === boardId ? { x: cursor.x, y: cursor.y } : null,
          cardIds:   sel?.boardId    === boardId ? (sel.cardIds || []) : [],
          dragCards: drag?.boardId   === boardId ? (drag.cards   || []) : [],
          marquee:   marquee?.boardId === boardId ? marquee : null,
        });
      });
      setPeers(out);
    };
    refresh();
    aw.on('change', refresh);
    return () => aw.off('change', refresh);
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
        {peers.map(p => p.cursor && (
          <LiveCursor
            key={p.clientId}
            x={pan.x + p.cursor.x * zoom}
            y={pan.y + p.cursor.y * zoom}
            name={(p.user.name || '?').split(' ')[0]}
            color={p.user.color || 'var(--soleil)'}
          />
        ))}
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
      const color = p.user.color || '#d4a04a';
      const soft = colorWithAlpha(color, 0.22);
      for (const id of p.cardIds) {
        const safe = id.replace(/"/g, '\\"');
        // Inset ring on the inner content (which has its own background and
        // sits at the same edge as the card). Corners draw via inset
        // box-shadow so they stay INSIDE the card's overflow:hidden clip.
        rules.push(
          `.card[data-card-id="${safe}"] > :first-child {`
          + ` box-shadow:`
          + `   inset 0 0 0 2px ${color},`
          + `   inset 0 0 0 6px ${soft},`
          + `   var(--shadow-2);`
          + ` border-radius: var(--radius-md); }`
        );
        // Subtle outer halo on the card itself (small, fits in overflow).
        // The card's own overflow:hidden wins on inner pixels but the
        // shadow can extend up to ~4px before contain:paint truncates it
        // — which is fine for a soft glow.
        rules.push(
          `.card[data-card-id="${safe}"] {`
          + ` outline: 1px solid ${color};`
          + ` outline-offset: 2px; }`
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
  // Accept #rrggbb only (we control the palette); fall back to rgba(212,160,74,…).
  if (typeof c === 'string' && c.startsWith('#') && c.length === 7) {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return `rgba(212,160,74,${a})`;
}
