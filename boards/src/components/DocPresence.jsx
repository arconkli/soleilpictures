// Live cursor + caret overlay on the doc surface. Mirrors what
// CanvasPresence does for the canvas, but reads/writes the awareness
// fields docCursor / docCaret.
//
// Awareness payload conventions (set by this component):
//   localState.user      = { id, name, color }   (from ySupabase.js)
//   localState.docCursor = { boardId, pageId, x, y }   // doc-paper-relative px
//   localState.docCaret  = { boardId, pageId, x, y }   // typing-caret px
//
// Coords are in `.doc-paper` element-relative pixels. Receivers translate
// to screen by reading their own .doc-paper bounding box (peers may have
// scrolled differently, but the doc width is fixed so the X tracks
// reliably; vertical scroll is shared via Y.Doc → caret follows the
// committed text flow).

import { useEffect, useRef, useState } from 'react';
import { LiveCursor } from './primitives.jsx';

export function DocPresence({ getAwareness, boardId, pageId, paperRef, editor, currentUser }) {
  const [peers, setPeers] = useState([]);

  // ── Read peers ─────────────────────────────────────────────────────────
  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw) return;
    const refresh = () => {
      const states = aw.getStates();
      const newest = new Map();
      states.forEach((state, clientId) => {
        if (!state?.user) return;
        if (state.user.id === currentUser?.id) return;
        const cursor = state.docCursor;
        const caret  = state.docCaret;
        const onPage = (cursor?.boardId === boardId && cursor?.pageId === pageId)
                    || (caret?.boardId  === boardId && caret?.pageId  === pageId);
        if (!onPage) return;
        const meta = aw.meta?.get?.(clientId);
        const updated = meta?.lastUpdated || 0;
        const existing = newest.get(state.user.id);
        if (existing && existing.updated >= updated) return;
        newest.set(state.user.id, {
          clientId, updated,
          user: state.user,
          cursor: cursor?.boardId === boardId && cursor?.pageId === pageId ? { x: cursor.x, y: cursor.y } : null,
          caret:  caret?.boardId  === boardId && caret?.pageId  === pageId ? { x: caret.x,  y: caret.y  } : null,
        });
      });
      setPeers([...newest.values()]);
    };
    refresh();
    aw.on('change', refresh);
    return () => aw.off('change', refresh);
  }, [getAwareness, boardId, pageId, currentUser?.id]);

  // ── Write our local mouse cursor (paper-relative) ──────────────────────
  useEffect(() => {
    const aw = getAwareness?.();
    const paper = paperRef?.current;
    if (!aw || !paper) return;
    let pending = null;
    let timer = null;
    const flush = () => {
      timer = null;
      if (!pending) return;
      aw.setLocalStateField('docCursor', { boardId, pageId, x: pending.x, y: pending.y });
      pending = null;
    };
    const onMove = (e) => {
      const r = paper.getBoundingClientRect();
      pending = {
        x: Math.round(e.clientX - r.left),
        y: Math.round(e.clientY - r.top + paper.scrollTop),
      };
      if (!timer) timer = setTimeout(flush, 30);
    };
    const onLeave = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      pending = null;
      aw.setLocalStateField('docCursor', null);
    };
    paper.addEventListener('pointermove', onMove);
    paper.addEventListener('pointerleave', onLeave);
    return () => {
      paper.removeEventListener('pointermove', onMove);
      paper.removeEventListener('pointerleave', onLeave);
      if (timer) clearTimeout(timer);
      try { aw.setLocalStateField('docCursor', null); } catch (_) {}
    };
  }, [getAwareness, paperRef, boardId, pageId]);

  // ── Write our typing caret position ────────────────────────────────────
  useEffect(() => {
    const aw = getAwareness?.();
    const paper = paperRef?.current;
    if (!aw || !paper || !editor) return;
    let lastX = -1, lastY = -1;
    const tick = () => {
      try {
        const sel = editor.state.selection;
        const view = editor.view;
        if (!view) return;
        const coords = view.coordsAtPos(sel.from);
        const r = paper.getBoundingClientRect();
        const x = Math.round(coords.left - r.left);
        const y = Math.round(coords.top - r.top + paper.scrollTop);
        if (x === lastX && y === lastY) return;
        lastX = x; lastY = y;
        aw.setLocalStateField('docCaret', { boardId, pageId, x, y });
      } catch (_) {}
    };
    // Update on every transaction (including selection changes)
    const onTr = () => { tick(); };
    editor.on('transaction', onTr);
    editor.on('selectionUpdate', onTr);
    editor.on('focus', onTr);
    tick();
    return () => {
      editor.off('transaction', onTr);
      editor.off('selectionUpdate', onTr);
      editor.off('focus', onTr);
      try { aw.setLocalStateField('docCaret', null); } catch (_) {}
    };
  }, [getAwareness, paperRef, editor, boardId, pageId]);

  // ── Render peer overlays ───────────────────────────────────────────────
  return (
    <div className="doc-presence-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 999990 }}>
      {peers.map(p => {
        const els = [];
        if (p.caret) {
          els.push(
            <div key={'caret-' + p.clientId}
                 className="doc-peer-caret"
                 style={{
                   position: 'absolute',
                   left: p.caret.x,
                   top: p.caret.y,
                   borderLeft: `2px solid ${p.user.color || '#4f8df8'}`,
                   height: '1.2em',
                   pointerEvents: 'none',
                   transition: 'left 90ms linear, top 90ms linear',
                 }}>
              <span className="doc-peer-caret-label" style={{
                position: 'absolute',
                top: '-1.5em', left: '-2px',
                background: p.user.color || '#4f8df8',
                color: '#fff',
                font: '600 10px/1 var(--font-sans)',
                padding: '2px 5px',
                borderRadius: 3,
                whiteSpace: 'nowrap',
              }}>{(p.user.name || '?').split(' ')[0]}</span>
            </div>
          );
        }
        if (p.cursor) {
          els.push(
            <LiveCursor key={'cursor-' + p.clientId}
                        x={p.cursor.x} y={p.cursor.y}
                        name={(p.user.name || '?').split(' ')[0]}
                        color={p.user.color || '#4f8df8'} />
          );
        }
        return els;
      })}
    </div>
  );
}
