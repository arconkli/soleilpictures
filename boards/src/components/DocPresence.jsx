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
        const sel    = state.docSelection;
        const onPage = (cursor?.boardId === boardId && cursor?.pageId === pageId)
                    || (caret?.boardId  === boardId && caret?.pageId  === pageId)
                    || (sel?.boardId    === boardId && sel?.pageId    === pageId);
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
          selRects: sel?.boardId === boardId && sel?.pageId === pageId ? (sel.rects || []) : [],
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

  // ── Write our caret + selection range ──────────────────────────────────
  // For each transaction or selection change we publish:
  //   docCaret = { boardId, pageId, x, y }            — head-of-cursor xy
  //   docSelection = { boardId, pageId, rects: [...]} — list of { left,top,
  //                  width, height } for non-empty selections (drawn as a
  //                  colored band on the receiver). Empty → null.
  useEffect(() => {
    const aw = getAwareness?.();
    const paper = paperRef?.current;
    if (!aw || !paper || !editor) return;
    let lastSig = '';
    const tick = () => {
      try {
        const sel = editor.state.selection;
        const view = editor.view;
        if (!view) return;
        const r = paper.getBoundingClientRect();
        const headCoords = view.coordsAtPos(sel.head);
        const x = Math.round(headCoords.left - r.left);
        const y = Math.round(headCoords.top  - r.top + paper.scrollTop);
        // Build rectangles for the selection range.
        let rects = null;
        if (!sel.empty) {
          const startCoords = view.coordsAtPos(sel.from);
          const endCoords = view.coordsAtPos(sel.to);
          // Walk character positions on the same line(s) and merge into
          // line-bands. Approximation: treat as one rect per "line group"
          // by stepping through the editor DOM via getClientRects().
          const range = document.createRange();
          try {
            const fromDOM = view.domAtPos(sel.from);
            const toDOM   = view.domAtPos(sel.to);
            range.setStart(fromDOM.node, fromDOM.offset);
            range.setEnd  (toDOM.node,   toDOM.offset);
            const rs = Array.from(range.getClientRects());
            rects = rs.map(rc => ({
              left: Math.round(rc.left - r.left),
              top: Math.round(rc.top  - r.top + paper.scrollTop),
              width: Math.round(rc.width),
              height: Math.round(rc.height),
            })).filter(rc => rc.width > 0 && rc.height > 0);
          } catch (_) {
            // Fallback: a single rect from start head to end head.
            rects = [{
              left: Math.round(startCoords.left - r.left),
              top: Math.round(startCoords.top  - r.top + paper.scrollTop),
              width: Math.max(2, Math.round(endCoords.left - startCoords.left)),
              height: Math.max(16, Math.round(endCoords.bottom - startCoords.top)),
            }];
          }
        }
        const sig = `${x},${y}|${rects ? rects.map(r => `${r.left},${r.top},${r.width},${r.height}`).join(';') : ''}`;
        if (sig === lastSig) return;
        lastSig = sig;
        aw.setLocalStateField('docCaret',     { boardId, pageId, x, y });
        aw.setLocalStateField('docSelection', rects ? { boardId, pageId, rects } : null);
      } catch (_) {}
    };
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
      try { aw.setLocalStateField('docSelection', null); } catch (_) {}
    };
  }, [getAwareness, paperRef, editor, boardId, pageId]);

  // ── Render peer overlays ───────────────────────────────────────────────
  return (
    <div className="doc-presence-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 999990 }}>
      {peers.map(p => {
        const els = [];
        // Selection rectangles drawn as a translucent band in peer color
        if (p.selRects && p.selRects.length) {
          for (let i = 0; i < p.selRects.length; i++) {
            const rc = p.selRects[i];
            els.push(
              <div key={'sel-' + p.clientId + '-' + i}
                   style={{
                     position: 'absolute',
                     left: rc.left, top: rc.top,
                     width: rc.width, height: rc.height,
                     background: p.user.color || '#4f8df8',
                     opacity: 0.22,
                     borderRadius: 1,
                     pointerEvents: 'none',
                   }} />
            );
          }
        }
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
