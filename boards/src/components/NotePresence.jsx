// Live peer caret + selection overlay for a collaboratively-edited note.
// Adapted from DocPresence, but a note lives on the zoom/pan-transformed canvas
// (not a fixed-width paper), so:
//   - the awareness payload is discriminated by cardId (multiple notes per
//     board), and
//   - caret/selection coords are stored in the note body's OWN unscaled content
//     space (derived by dividing the on-screen offset by the element's render
//     scale = clientRect.width / offsetWidth). The overlay renders INSIDE the
//     .note, so the canvas transform re-applies pan/zoom and peers align at any
//     zoom level.
//
// Awareness payload:
//   localState.noteCaret     = { boardId, cardId, x, y }
//   localState.noteSelection = { boardId, cardId, rects: [{left,top,width,height}] }

import { useEffect, useRef, useState } from 'react';

const TYPING_FADE_MS = 1500;

// Note-body content-space coords from a viewport rect: undo the canvas zoom
// and add the body's own scroll, so the point names a spot in the TEXT, not in
// the box. A peer whose note is scrolled to a different line still draws the
// caret on the right one.
function toLocal(bodyEl, rect) {
  const br = bodyEl.getBoundingClientRect();
  const scale = bodyEl.offsetWidth ? br.width / bodyEl.offsetWidth : 1;
  const s = scale || 1;
  return {
    x: (rect.left - br.left) / s + bodyEl.scrollLeft,
    y: (rect.top - br.top) / s + bodyEl.scrollTop,
    scale: s,
  };
}

export function NotePresence({ editor, awareness, boardId, cardId }) {
  const [peers, setPeers] = useState([]);
  const lastCaretChangeRef = useRef(new Map());
  const lastCaretXYRef = useRef(new Map());

  // ── Read peers (carets/selections on THIS note) ─────────────────────────
  useEffect(() => {
    if (!awareness) return undefined;
    const refresh = () => {
      const states = awareness.getStates();
      const newest = new Map();
      const now = (typeof performance !== 'undefined' ? performance.now() : 0);
      states.forEach((state, clientId) => {
        if (!state?.user || clientId === awareness.clientID) return;
        const caret = state.noteCaret;
        const sel = state.noteSelection;
        const onNote = (caret?.boardId === boardId && caret?.cardId === cardId)
          || (sel?.boardId === boardId && sel?.cardId === cardId);
        if (!onNote) return;
        if (caret && caret.cardId === cardId) {
          const sig = `${caret.x},${caret.y}`;
          if (lastCaretXYRef.current.get(state.user.id) !== sig) {
            lastCaretXYRef.current.set(state.user.id, sig);
            lastCaretChangeRef.current.set(state.user.id, now);
          }
        }
        newest.set(state.user.id, {
          clientId,
          user: state.user,
          caret: caret?.cardId === cardId ? { x: caret.x, y: caret.y } : null,
          selRects: sel?.cardId === cardId ? (sel.rects || []) : [],
        });
      });
      setPeers([...newest.values()]);
    };
    refresh();
    awareness.on('change', refresh);
    return () => awareness.off('change', refresh);
  }, [awareness, boardId, cardId]);

  // Keep the typing pulse animating while peers are present.
  const [, tick] = useState(0);
  useEffect(() => {
    if (peers.length === 0) return undefined;
    const id = setInterval(() => tick(n => (n + 1) | 0), 300);
    return () => clearInterval(id);
  }, [peers.length]);

  // Scrolling this note moves the text under the peers' carets: redraw them.
  const hasPeers = peers.length > 0;
  useEffect(() => {
    const body = editor?.view?.dom;
    if (!body || !hasPeers) return undefined;
    const onScroll = () => tick(n => (n + 1) | 0);
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => body.removeEventListener('scroll', onScroll);
  }, [editor, hasPeers]);

  // ── Write our caret + selection (note-body-local coords) ────────────────
  const lastSigRef = useRef('');
  useEffect(() => {
    if (!awareness || !editor) return undefined;
    const publish = () => {
      try {
        const view = editor.view;
        const body = view?.dom;
        if (!body) return;
        const sel = editor.state.selection;
        const head = toLocal(body, view.coordsAtPos(sel.head));
        let rects = null;
        if (!sel.empty) {
          try {
            const fromDOM = view.domAtPos(sel.from);
            const toDOM = view.domAtPos(sel.to);
            const range = document.createRange();
            range.setStart(fromDOM.node, fromDOM.offset);
            range.setEnd(toDOM.node, toDOM.offset);
            rects = Array.from(range.getClientRects()).map((rc) => {
              const p = toLocal(body, rc);
              return { left: p.x, top: p.y, width: rc.width / p.scale, height: rc.height / p.scale };
            }).filter(rc => rc.width > 0 && rc.height > 0);
          } catch (_) { rects = null; }
        }
        const sig = `${Math.round(head.x)},${Math.round(head.y)}|${rects ? rects.length : 0}`;
        if (sig === lastSigRef.current) return;
        lastSigRef.current = sig;
        awareness.setLocalStateField('noteCaret', { boardId, cardId, x: head.x, y: head.y });
        awareness.setLocalStateField('noteSelection', rects ? { boardId, cardId, rects } : null);
      } catch (_) { /* noop */ }
    };
    const onTr = () => publish();
    editor.on('transaction', onTr);
    editor.on('selectionUpdate', onTr);
    editor.on('focus', onTr);
    publish();
    return () => {
      editor.off('transaction', onTr);
      editor.off('selectionUpdate', onTr);
      editor.off('focus', onTr);
      try { awareness.setLocalStateField('noteCaret', null); } catch (_) {}
      try { awareness.setLocalStateField('noteSelection', null); } catch (_) {}
    };
  }, [awareness, editor, boardId, cardId]);

  // ── Render peer overlays (inside .note; offset by the body's box) ───────
  // Coords are the body's content space (toLocal). The layer sits outside the
  // scroller, so an inner origin moves by the body's scroll (no transition, so
  // carets track the text while scrolling) and anything scrolled out of the
  // body's visible band is left out instead of drawn over the padding.
  const body = editor?.view?.dom;
  const offX = body?.offsetLeft || 0;
  const offY = body?.offsetTop || 0;
  const scrollX = body?.scrollLeft || 0;
  const scrollY = body?.scrollTop || 0;
  const viewH = body?.clientHeight || Infinity;
  const CARET_H = 18; // ~1.2em at the default 15px
  const now = (typeof performance !== 'undefined' ? performance.now() : 0);
  return (
    <div className="note-presence-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50 }}>
      <div style={{ position: 'absolute', left: offX - scrollX, top: offY - scrollY, width: 0, height: 0 }}>
      {peers.map((p) => {
        const els = [];
        const color = p.user.color || '#4f8df8';
        const sinceMove = now - (lastCaretChangeRef.current.get(p.user.id) || 0);
        const typing = !!p.caret && sinceMove < TYPING_FADE_MS;
        (p.selRects || []).forEach((rc, i) => {
          const top = Math.max(rc.top, scrollY);
          const bottom = Math.min(rc.top + rc.height, scrollY + viewH);
          if (bottom <= top) return;
          els.push(
            <div key={`sel-${p.clientId}-${i}`} style={{
              position: 'absolute', left: rc.left, top,
              width: rc.width, height: bottom - top, background: color, opacity: 0.22,
              borderRadius: 1, pointerEvents: 'none',
            }} />
          );
        });
        if (p.caret && p.caret.y + CARET_H > scrollY && p.caret.y < scrollY + viewH) {
          els.push(
            <div key={`caret-${p.clientId}`} style={{
              position: 'absolute', left: p.caret.x, top: p.caret.y,
              borderLeft: `2px solid ${color}`, height: '1.2em', pointerEvents: 'none',
              opacity: typing ? 1 : 0.55, transition: 'left 90ms linear, top 90ms linear, opacity 250ms linear',
            }}>
              <span style={{
                position: 'absolute', top: '-1.4em', left: '-2px', background: color, color: '#fff',
                font: '600 10px/1 var(--font-sans, sans-serif)', padding: '1px 5px', borderRadius: 3, whiteSpace: 'nowrap',
              }}>{(p.user.name || '?').split(' ')[0]}</span>
            </div>
          );
        }
        return els;
      })}
      </div>
    </div>
  );
}
