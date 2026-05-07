// Live cursor + caret + selection overlay for the doc surface. Mirrors
// CanvasPresence: reads/writes a Y.Awareness instance multiplexed over
// the PartyKit socket.
//
// Awareness payload conventions (set by this component):
//   localState.user         = { id, name, color }   (set by yPartyKit.js)
//   localState.docCursor    = { boardId, pageId, x, y }   // doc-paper-relative px
//   localState.docCaret     = { boardId, pageId, x, y }   // typing-caret px
//   localState.docSelection = { boardId, pageId, rects: [...] }
//
// Coords are in `.doc-editor-wrap` element-relative pixels. The wrap is a
// fixed-width sheet (816px) centered inside .doc-paper, so wrap-relative
// coords are identical between peers regardless of window width — peers
// no longer see each other's cursor floating off to the side because of
// different viewport widths.

import { useEffect, useRef, useState } from 'react';
import { LiveCursor } from './primitives.jsx';

// Window after a peer's caret moves where we treat them as "actively
// typing" — caret stays at full opacity and pulses subtly. After this
// window the caret fades to a quieter idle state so you can tell at a
// glance who's editing vs who's just present.
const TYPING_FADE_MS = 1500;
const IDLE_FADE_MS   = 3000;
const IDLE_OPACITY   = 0.55;

export function DocPresence({ getAwareness, boardId, pageId, paperRef, editor, currentUser }) {
  const [peers, setPeers] = useState([]);

  // Mirror paperRef.current into state. React refs aren't reactive, so an
  // effect that depends on `paperRef.current` would never re-run when the
  // .doc-paper element finally appears (rare, but possible during Strict
  // Mode double-mount). Polling once on mount fixes the race for free.
  const [paperEl, setPaperEl] = useState(() => paperRef?.current || null);
  useEffect(() => {
    if (paperEl) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const el = paperRef?.current;
      if (el) { setPaperEl(el); return; }
      setTimeout(tick, 100);
    };
    tick();
    return () => { cancelled = true; };
  }, [paperRef, paperEl]);

  // Per-peer typing tracking. Bumped from the awareness `change` handler
  // when a peer's docCaret xy actually moves (i.e. they're editing or
  // navigating). Used to drive the typing pulse + idle fade in render.
  const lastCaretChangeRef = useRef(new Map()); // userId → performance.now()
  const lastCaretXYRef     = useRef(new Map()); // userId → 'x,y' string

  // ── Read peers ─────────────────────────────────────────────────────────
  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw) return;
    const refresh = () => {
      const states = aw.getStates();
      const newest = new Map();
      const now = performance.now();
      states.forEach((state, clientId) => {
        if (!state?.user) return;
        // Filter self by awareness clientID (per-tab identity), not by
        // user.id — so the same account in two tabs/devices still sees
        // its other tab as a peer (useful for testing + valid production
        // case). Same-user dedup happens below by user.id.
        if (clientId === aw.clientID) return;
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
        // Detect caret movement so the receiving overlay can pulse.
        if (caret && caret.boardId === boardId && caret.pageId === pageId) {
          const sig = `${caret.x},${caret.y}`;
          const prev = lastCaretXYRef.current.get(state.user.id);
          if (prev !== sig) {
            lastCaretXYRef.current.set(state.user.id, sig);
            lastCaretChangeRef.current.set(state.user.id, now);
          }
        }
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
  }, [getAwareness, boardId, pageId]);

  // Without this, the typing pulse / idle fade only animates on awareness
  // changes — so when a peer goes idle the caret stays "active" until the
  // next event. This bumps a render every 250ms while peers are present.
  const [, tickPulse] = useState(0);
  useEffect(() => {
    if (peers.length === 0) return;
    const id = setInterval(() => tickPulse(n => (n + 1) | 0), 250);
    return () => clearInterval(id);
  }, [peers.length]);

  // ── Write our local mouse cursor (editor-wrap-relative) ────────────────
  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw || !paperEl) return;
    let pending = null;
    let timer = null;
    const flush = () => {
      timer = null;
      if (!pending) return;
      aw.setLocalStateField('docCursor', { boardId, pageId, x: pending.x, y: pending.y });
      pending = null;
    };
    const onMove = (e) => {
      const wrap = paperEl.querySelector('.doc-editor-wrap');
      if (!wrap) return;
      const wr = wrap.getBoundingClientRect();
      pending = {
        x: Math.round(e.clientX - wr.left),
        y: Math.round(e.clientY - wr.top),
      };
      if (!timer) timer = setTimeout(flush, 30);
    };
    const onLeave = () => {
      if (timer) { clearTimeout(timer); timer = null; }
      pending = null;
      aw.setLocalStateField('docCursor', null);
    };
    paperEl.addEventListener('pointermove', onMove);
    paperEl.addEventListener('pointerleave', onLeave);
    return () => {
      paperEl.removeEventListener('pointermove', onMove);
      paperEl.removeEventListener('pointerleave', onLeave);
      if (timer) clearTimeout(timer);
      try { aw.setLocalStateField('docCursor', null); } catch (_) {}
    };
  }, [getAwareness, paperEl, boardId, pageId]);

  // ── Write our caret + selection range ──────────────────────────────────
  // For each transaction or selection change we publish:
  //   docCaret = { boardId, pageId, x, y }              — head-of-cursor xy
  //   docSelection = { boardId, pageId, rects: [...] }  — list of {left,top,
  //                  width,height} for non-empty selections (drawn as a
  //                  colored band on the receiver). Empty → null.
  // lastSig is a useRef so the dedup survives effect re-runs (the editor
  // prop flips null → instance after mount, which would otherwise reset
  // the dedup to '' and re-broadcast the next transaction unnecessarily).
  const lastSigRef = useRef('');
  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw || !paperEl || !editor) return;
    const tick = () => {
      try {
        const sel = editor.state.selection;
        const view = editor.view;
        if (!view) return;
        const wrap = paperEl.querySelector('.doc-editor-wrap');
        if (!wrap) return;
        const r = wrap.getBoundingClientRect();
        const headCoords = view.coordsAtPos(sel.head);
        const x = Math.round(headCoords.left - r.left);
        const y = Math.round(headCoords.top  - r.top);
        let rects = null;
        if (!sel.empty) {
          const startCoords = view.coordsAtPos(sel.from);
          const endCoords = view.coordsAtPos(sel.to);
          const range = document.createRange();
          try {
            const fromDOM = view.domAtPos(sel.from);
            const toDOM   = view.domAtPos(sel.to);
            range.setStart(fromDOM.node, fromDOM.offset);
            range.setEnd  (toDOM.node,   toDOM.offset);
            const rs = Array.from(range.getClientRects());
            rects = rs.map(rc => ({
              left: Math.round(rc.left - r.left),
              top: Math.round(rc.top  - r.top),
              width: Math.round(rc.width),
              height: Math.round(rc.height),
            })).filter(rc => rc.width > 0 && rc.height > 0);
          } catch (_) {
            rects = [{
              left: Math.round(startCoords.left - r.left),
              top: Math.round(startCoords.top  - r.top),
              width: Math.max(2, Math.round(endCoords.left - startCoords.left)),
              height: Math.max(16, Math.round(endCoords.bottom - startCoords.top)),
            }];
          }
        }
        const sig = `${x},${y}|${rects ? rects.map(r => `${r.left},${r.top},${r.width},${r.height}`).join(';') : ''}`;
        if (sig === lastSigRef.current) return;
        lastSigRef.current = sig;
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
  }, [getAwareness, paperEl, editor, boardId, pageId]);

  // ── Render peer overlays ───────────────────────────────────────────────
  // Cursor / caret coords are stored in editor-wrap-relative space (so peers
  // render at the same content position regardless of viewport width). At
  // render time, compute the wrap's offset within the layer (.doc-paper)
  // so we shift each rendered position from wrap-relative back into paper-
  // layer-relative.
  const now = performance.now();
  let offX = 0, offY = 0;
  if (paperEl) {
    const wrap = paperEl.querySelector('.doc-editor-wrap');
    if (wrap) {
      const wr = wrap.getBoundingClientRect();
      const pr = paperEl.getBoundingClientRect();
      offX = wr.left - pr.left;
      offY = wr.top  - pr.top + paperEl.scrollTop;
    }
  }
  return (
    <div className="doc-presence-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 999990 }}>
      {peers.map(p => {
        const els = [];
        if (p.selRects && p.selRects.length) {
          for (let i = 0; i < p.selRects.length; i++) {
            const rc = p.selRects[i];
            els.push(
              <div key={'sel-' + p.clientId + '-' + i}
                   className="doc-peer-selection"
                   style={{
                     position: 'absolute',
                     left: rc.left + offX, top: rc.top + offY,
                     width: rc.width, height: rc.height,
                     background: p.user.color || '#4f8df8',
                     opacity: 0.22,
                     borderRadius: 1,
                     pointerEvents: 'none',
                     transition: 'opacity 120ms linear, transform 90ms linear',
                   }} />
            );
          }
        }
        if (p.caret) {
          const lastChange = lastCaretChangeRef.current.get(p.user.id) || 0;
          const sinceMove = now - lastChange;
          const isTyping = sinceMove < TYPING_FADE_MS;
          // After the typing window, fade caret to IDLE_OPACITY over IDLE_FADE_MS.
          const idleOpacity = isTyping
            ? 1
            : Math.max(IDLE_OPACITY, 1 - ((sinceMove - TYPING_FADE_MS) / IDLE_FADE_MS) * (1 - IDLE_OPACITY));
          els.push(
            <div key={'caret-' + p.clientId}
                 className={`doc-peer-caret ${isTyping ? 'doc-peer-caret--typing' : ''}`}
                 style={{
                   position: 'absolute',
                   left: p.caret.x + offX,
                   top: p.caret.y + offY,
                   borderLeft: `2px solid ${p.user.color || '#4f8df8'}`,
                   height: '1.2em',
                   pointerEvents: 'none',
                   opacity: idleOpacity,
                   transition: 'left 90ms linear, top 90ms linear, opacity 250ms linear',
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
                        x={p.cursor.x + offX} y={p.cursor.y + offY}
                        name={(p.user.name || '?').split(' ')[0]}
                        color={p.user.color || '#4f8df8'} />
          );
        }
        return els;
      })}
    </div>
  );
}
