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
  // Lerped cursor positions keyed by clientId. Carries user meta inline
  // so the cursor can render even when the peer briefly drops out of the
  // `peers` list (e.g. sender momentarily writes canvasCursor=null on a
  // pointerleave caused by a popover overlay). A grace window keeps the
  // last-known position visible across these transient gaps so the cursor
  // doesn't pop in and out of existence.
  const [cursorDisplay, setCursorDisplay] = useState({});

  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw) return;
    const ALPHA = 0.35;
    const SNAP_PX = 0.5;
    const GRACE_MS = 700;
    const cursorTargets = { current: {} };  // clientId → { x, y }  (current target if currently broadcasting)
    const cursorState   = { current: {} };  // clientId → { x, y, user, lastSeen }
    let rafId = 0;
    let cleanupId = 0;

    const tick = () => {
      rafId = 0;
      const display = cursorState.current;
      const targets = cursorTargets.current;
      let moved = false;
      for (const id in display) {
        const t = targets[id];
        if (!t) continue;  // no current target: hold last position (within grace)
        const dx = t.x - display[id].x;
        const dy = t.y - display[id].y;
        if (Math.abs(dx) < SNAP_PX && Math.abs(dy) < SNAP_PX) {
          if (display[id].x !== t.x || display[id].y !== t.y) {
            display[id] = { ...display[id], x: t.x, y: t.y };
            moved = true;
          }
        } else {
          display[id] = { ...display[id], x: display[id].x + dx * ALPHA, y: display[id].y + dy * ALPHA };
          moved = true;
        }
      }
      if (moved) {
        setCursorDisplay({ ...display });
        rafId = requestAnimationFrame(tick);
      }
    };

    const dropExpired = () => {
      const now = performance.now();
      let changed = false;
      for (const id in cursorState.current) {
        if (id in cursorTargets.current) continue;  // still actively broadcasting
        const lastSeen = cursorState.current[id].lastSeen || 0;
        if (now - lastSeen > GRACE_MS) {
          delete cursorState.current[id];
          changed = true;
        }
      }
      if (changed) setCursorDisplay({ ...cursorState.current });
    };

    const refresh = () => {
      const now = performance.now();
      const states = aw.getStates();
      // Group by user.id and keep only the freshest entry per user, so a
      // peer who reconnected with a new clientID doesn't show as two
      // cursors (one frozen, one live) while the old state ages out.
      const newest = new Map();
      const nextCursorTargets = {};
      const userByClientId = new Map();
      states.forEach((state, clientId) => {
        // TEMP diagnostic: which silent-skip branch is dropping peers?
        // Remove once the cursor-visibility regression is identified.
        const _cursor = state?.canvasCursor;
        const _sel = state?.canvasSelection;
        const _drag = state?.liveDrag;
        const _mq = state?.marquee;
        const _onBoard = (_cursor?.boardId === boardId)
                     || (_sel?.boardId === boardId)
                     || (_drag?.boardId === boardId)
                     || (_mq?.boardId === boardId);
        const _reason =
          !state ? 'no-state'
          : !state.user ? 'no-user'
          : state.user.id === selfId ? 'is-self'
          : !_onBoard ? 'wrong-board'
          : 'ok';
        if (_reason !== 'ok') {
          console.log('[canvaspres] drop', clientId, _reason, {
            hasUser: !!state?.user,
            peerUserId: state?.user?.id,
            selfId,
            cursorBoardId: _cursor?.boardId,
            boardId,
            isOwnClient: clientId === aw.clientID,
          });
        } else {
          console.log('[canvaspres] ok', clientId, {
            peerUserId: state.user.id,
            peerName: state.user.name,
            hasCursor: !!_cursor,
          });
        }
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
          cardIds:   sel?.boardId     === boardId ? (sel.cardIds   || []) : [],
          strokeIds: sel?.boardId     === boardId ? (sel.strokeIds || []) : [],
          arrowIds:  sel?.boardId     === boardId ? (sel.arrowIds  || []) : [],
          dragCards: drag?.boardId    === boardId ? (drag.cards   || []) : [],
          marquee:   marquee?.boardId === boardId ? marquee : null,
        });
        if (cursor?.boardId === boardId) {
          nextCursorTargets[clientId] = { x: cursor.x, y: cursor.y };
          userByClientId.set(clientId, state.user);
        }
      });
      setPeers([...newest.values()]);
      cursorTargets.current = nextCursorTargets;
      // Snap newcomers to their first reported position; refresh user meta
      // and lastSeen on every active broadcast.
      let displayChanged = false;
      for (const id in nextCursorTargets) {
        const t = nextCursorTargets[id];
        const u = userByClientId.get(id);
        if (!cursorState.current[id]) {
          cursorState.current[id] = { x: t.x, y: t.y, user: u, lastSeen: now };
          displayChanged = true;
        } else {
          cursorState.current[id].lastSeen = now;
          if (u) cursorState.current[id].user = u;
        }
      }
      // TEMP diagnostic: log every refresh outcome so we can tell if
      // cursorDisplay is actually getting populated or stays empty.
      console.log('[canvaspres] refresh-out', {
        nextCursorTargetIds: Object.keys(nextCursorTargets),
        cursorStateIds: Object.keys(cursorState.current),
        peerCount: newest.size,
        displayChanged,
      });
      if (displayChanged) setCursorDisplay({ ...cursorState.current });
      if (!rafId) rafId = requestAnimationFrame(tick);
      dropExpired();
    };
    refresh();
    aw.on('change', refresh);
    // If no awareness changes fire (peer goes silent without disconnecting),
    // periodically prune entries past the grace window.
    cleanupId = setInterval(dropExpired, 1000);
    return () => {
      aw.off('change', refresh);
      if (rafId) cancelAnimationFrame(rafId);
      if (cleanupId) clearInterval(cleanupId);
    };
  }, [getAwareness, boardId, selfId]);

  // Cursors get rendered in canvas-space, then transformed by the same
  // pan/zoom the canvas itself uses, so a peer's screen-space cursor
  // follows the same coordinate system as the cards.
  // TEMP diagnostic: log cursorDisplay state once per render.
  if (typeof window !== 'undefined' && !window.__cursorRenderLogThrottle) {
    window.__cursorRenderLogThrottle = setTimeout(() => {
      window.__cursorRenderLogThrottle = null;
    }, 500);
    console.log('[canvaspres] render-tick', {
      cursorDisplayKeys: Object.keys(cursorDisplay),
      cursorDisplayValues: Object.entries(cursorDisplay).map(([id, c]) => ({
        id, hasUser: !!c?.user, name: c?.user?.name, x: c?.x, y: c?.y,
      })),
      peerCount: peers.length,
      pan, zoom, boardId,
    });
  }
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
      <div className="cursors-layer" data-cursor-count={Object.keys(cursorDisplay).length}>
        {Object.entries(cursorDisplay).map(([clientId, c]) => {
          if (!c?.user) return null;
          const sx = pan.x + c.x * zoom;
          const sy = pan.y + c.y * zoom;
          // TEMP diagnostic: log every render-time position so we can tell
          // if cursors are being placed off-screen / at NaN.
          if (typeof window !== 'undefined' && !window.__cursorRenderLogThrottle) {
            window.__cursorRenderLogThrottle = setTimeout(() => {
              window.__cursorRenderLogThrottle = null;
            }, 500);
            console.log('[canvaspres] render', clientId, {
              name: c.user.name,
              canvasXY: { x: c.x, y: c.y },
              screenXY: { x: sx, y: sy },
              pan, zoom,
            });
          }
          return (
            <LiveCursor
              key={clientId}
              x={sx}
              y={sy}
              name={(c.user.name || '?').split(' ')[0]}
              color={c.user.color || 'var(--soleil)'}
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
