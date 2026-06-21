import { useEffect, useMemo, useRef, useState } from 'react';
import { LiveCursor } from './primitives.jsx';
import { PRESENCE_TUNING } from '../lib/presenceTuning.js';
import * as perf from '../lib/perf.js';

// Identity-only fingerprint of a peer — everything the render below actually
// draws (user, selections, marquee) but NOT cursor position or awareness
// timestamps. Cursors move continuously, so if the `peers` array rebuilt on
// every cursor tick React would re-render the whole presence layer dozens of
// times a second per peer (an O(N) storm at scale). Cursor motion is carried
// separately through the rAF-lerped cursorDisplay; gating setPeers on THIS
// fingerprint means a peer merely moving their mouse triggers zero setPeers.
// Mirrors useWorkspacePresence.js peerKey/peersFingerprint.
function peerFingerprint(p) {
  const u = p.user || {};
  const sel = [...(p.cardIds || [])].sort().join(',');
  const str = [...(p.strokeIds || [])].sort().join(',');
  const arr = [...(p.arrowIds || [])].sort().join(',');
  const mq = p.marquee ? `${p.marquee.x0},${p.marquee.y0},${p.marquee.x1},${p.marquee.y1}` : '';
  return `${p.clientId}|${u.id || ''}|${u.name || ''}|${u.color || ''}|${sel}|${str}|${arr}|${mq}`;
}
function peersFingerprint(peers) {
  return peers.map(peerFingerprint).sort().join('||');
}

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
export function CanvasPresence({ getAwareness, boardId, pan, zoom, selfId, getCardById }) {
  const [peers, setPeers] = useState([]);
  // Lerped cursor positions keyed by clientId. Carries user meta inline
  // so the cursor can render even when the peer briefly drops out of the
  // `peers` list (e.g. sender momentarily writes canvasCursor=null on a
  // pointerleave caused by a popover overlay). A grace window keeps the
  // last-known position visible across these transient gaps so the cursor
  // doesn't pop in and out of existence.
  const [cursorDisplay, setCursorDisplay] = useState({});
  // Refs (not effect-locals) so they survive effect re-runs. Otherwise
  // when deps churn (parent re-renders pass a new `currentUser` object
  // identity, etc.), the effect tears down and rebuilds with fresh empty
  // maps — but React's `cursorDisplay` state still holds stale entries
  // from the previous run. That desync produced an invisible-cursor bug
  // where state thought a peer existed but no `.cursor` element was in
  // the DOM. Keeping these as refs means peer state outlives effect deps.
  const cursorTargetsRef = useRef({});
  const cursorStateRef = useRef({});
  // Gated + rAF-coalesced `peers` commits (see peersFingerprint above). The
  // fingerprint of the last committed array; a pending array + its rAF id so a
  // burst of awareness changes (e.g. a marquee drag) collapses into one commit.
  const peersFpRef = useRef('');
  const pendingPeersRef = useRef(null);
  const peersRafRef = useRef(0);

  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw) return;
    const ALPHA = 0.35;
    const SNAP_PX = 0.5;
    const GRACE_MS = 700;
    const cursorTargets = cursorTargetsRef;
    const cursorState = cursorStateRef;
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
      // Plain object (not Map) — y-awareness yields numeric clientIDs but
      // `for…in nextCursorTargets` below stringifies keys, and Map is
      // type-strict so `userByClientId.get('123')` would miss `123`.
      // Using an object here matches nextCursorTargets' stringification.
      const userByClientId = {};
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
          cardIds:   sel?.boardId     === boardId ? (sel.cardIds   || []) : [],
          strokeIds: sel?.boardId     === boardId ? (sel.strokeIds || []) : [],
          arrowIds:  sel?.boardId     === boardId ? (sel.arrowIds  || []) : [],
          dragCards: drag?.boardId    === boardId ? (drag.cards   || []) : [],
          marquee:   marquee?.boardId === boardId ? marquee : null,
        });
        if (cursor?.boardId === boardId) {
          nextCursorTargets[clientId] = { x: cursor.x, y: cursor.y };
          userByClientId[clientId] = state.user;
        }
      });
      // Commit `peers` ONLY when the identity fingerprint actually changes
      // (selection / marquee / who's-here) — never on a bare cursor move — and
      // coalesce a burst into one rAF so a marquee drag doesn't thrash React.
      const nextPeers = [...newest.values()];
      const fp = peersFingerprint(nextPeers);
      if (fp !== peersFpRef.current) {
        peersFpRef.current = fp;
        pendingPeersRef.current = nextPeers;
        if (!peersRafRef.current) {
          peersRafRef.current = requestAnimationFrame(() => {
            peersRafRef.current = 0;
            if (pendingPeersRef.current) {
              setPeers(pendingPeersRef.current);
              pendingPeersRef.current = null;
              perf.bump('presence.setPeers');
            }
          });
        }
      }
      cursorTargets.current = nextCursorTargets;
      // Snap newcomers to their first reported position; refresh user meta
      // and lastSeen on every active broadcast.
      let displayChanged = false;
      for (const id in nextCursorTargets) {
        const t = nextCursorTargets[id];
        // Belt-and-braces: prefer userByClientId, but fall back to scanning
        // `newest` so we never insert a cursor entry without user metadata
        // (the render gates on `c?.user` and would silently drop it).
        // Stringify p.clientId since `id` is a string from `for…in`.
        const u = userByClientId[id]
          ?? [...newest.values()].find(p => String(p.clientId) === id)?.user
          ?? null;
        if (!cursorState.current[id]) {
          cursorState.current[id] = { x: t.x, y: t.y, user: u, lastSeen: now };
          displayChanged = true;
        } else {
          cursorState.current[id].lastSeen = now;
          if (u) cursorState.current[id].user = u;
        }
      }
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
      if (peersRafRef.current) { cancelAnimationFrame(peersRafRef.current); peersRafRef.current = 0; }
    };
  }, [getAwareness, boardId, selfId]);

  // Viewport-cull + hard-cap the rendered cursors so a crowded board can't
  // mount hundreds of cursor DOM nodes (the dominant cost at scale). Cursors
  // off-screen (plus a margin) are dropped; if more than the cap remain
  // on-screen we keep the most-recently-active ones. The overflow still shows
  // in the who's-here roster (PresenceStack) — it's just not drawn on canvas.
  const { CURSOR_RENDER_CAP, CURSOR_CULL_MARGIN_PX, SELECTION_PEER_CAP } = PRESENCE_TUNING;
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280;
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
  const visibleCursors = Object.entries(cursorDisplay)
    .map(([clientId, c]) => ({ clientId, c, sx: pan.x + (c?.x ?? NaN) * zoom, sy: pan.y + (c?.y ?? NaN) * zoom }))
    .filter(({ c, sx, sy }) =>
      c?.user && Number.isFinite(sx) && Number.isFinite(sy) &&
      sx >= -CURSOR_CULL_MARGIN_PX && sx <= vw + CURSOR_CULL_MARGIN_PX &&
      sy >= -CURSOR_CULL_MARGIN_PX && sy <= vh + CURSOR_CULL_MARGIN_PX)
    .sort((a, b) => (b.c.lastSeen || 0) - (a.c.lastSeen || 0))
    .slice(0, CURSOR_RENDER_CAP);
  // Selection rings/pills draw for at most the first N peers — same graceful
  // cap so a flood of selections can't blow up the pill layer / stylesheet.
  // Memoized on `peers` so its identity is stable across the ~60/s cursor-only
  // re-renders; otherwise PeerSelectionStyles' [peers] effect would rebuild the
  // injected stylesheet every frame (it only changes when selections change).
  const selectionPeers = useMemo(() => peers.slice(0, SELECTION_PEER_CAP), [peers, SELECTION_PEER_CAP]);

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
      {/* Name tags on cards a peer has selected — so you can tell WHO grabbed
          what, not just that "someone" did. Screen-space (not canvas-scaled)
          so the pill stays a constant, readable size at any zoom — same
          approach as the cursor flags. Pairs with the peer-colored ring that
          PeerSelectionStyles injects on the card itself. */}
      <div className="peer-sel-layer">
        {selectionPeers.flatMap(p => {
          if (!getCardById) return [];
          const color = p.user.color || '#5b8def';
          const name = (p.user.name || '?').split(' ')[0];
          return (p.cardIds || []).map(id => {
            const c = getCardById(id);
            if (!c) return null;
            const sx = pan.x + c.x * zoom;
            const sy = pan.y + c.y * zoom;
            if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;
            return (
              <div key={p.clientId + ':' + id}
                   className="peer-sel-pill"
                   style={{ left: sx, top: sy, background: color }}>
                {name}
              </div>
            );
          }).filter(Boolean);
        })}
      </div>
      <div className="cursors-layer">
        {visibleCursors.map(({ clientId, c, sx, sy }) => (
          <LiveCursor
            key={clientId}
            x={sx}
            y={sy}
            name={(c.user.name || '?').split(' ')[0]}
            color={c.user.color || 'var(--soleil)'}
          />
        ))}
      </div>
      <PeerSelectionStyles peers={selectionPeers} />
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
    // Hard ceiling on injected rules — a peer (or a buggy client) with a huge
    // selection can't balloon the stylesheet and stall style recalc.
    const { SELECTION_RULE_CAP } = PRESENCE_TUNING;
    for (const p of peers) {
      if (rules.length >= SELECTION_RULE_CAP) break;
      const color = p.user.color || '#ffa500';
      for (const id of p.cardIds) {
        if (rules.length >= SELECTION_RULE_CAP) break;
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
        if (rules.length >= SELECTION_RULE_CAP) break;
        rules.push(
          `g[data-stroke-idx="${idx}"] path[data-stroke-line] {`
          + ` stroke: ${color} !important;`
          + ` filter: drop-shadow(0 0 3px ${color}); }`
        );
      }
      for (const idx of (p.arrowIds || [])) {
        if (rules.length >= SELECTION_RULE_CAP) break;
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
