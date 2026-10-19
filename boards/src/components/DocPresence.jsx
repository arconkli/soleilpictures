// Live cursor + caret + selection overlay for the doc surface. Mirrors
// CanvasPresence: reads/writes a Y.Awareness instance multiplexed over
// the PartyKit socket.
//
// Awareness payload conventions (set by this component):
//   localState.user         = { id, name, color }   (set by yPartyKit.js)
//   localState.docCursor    = { boardId, pageId, x, y, u: 1 }
//   localState.docCaret     = { boardId, pageId, x, y, head }
//   localState.docSelection = { boardId, pageId, rects: [...], from, to }
//
// The caret and selection travel as DOCUMENT positions — `head` / `from` /
// `to` are Yjs relative positions (bookmarkRelPos encoding) — and each
// receiver resolves them against its own editor at render time. Pixels can't
// cross between peers: a CSS-zoomed sheet, a docked pane or a narrow window
// wraps the same text onto different lines, so a pixel offset lands on the
// wrong word. The mouse cursor is not a text position, so it stays a pixel
// offset from the sheet's top-left — but in UNZOOMED sheet px (`u: 1`), scaled
// by the receiver's own zoom.
//
// x / y / rects are still published in the old raw form so a tab running the
// previous bundle keeps drawing something until it reloads; a receiver uses
// them only when a peer sent no relative position.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LiveCursor } from './primitives.jsx';
import { encodeAnchor, resolveAnchor } from '../lib/bookmarkRelPos.js';

// Window after a peer's caret moves where we treat them as "actively
// typing" — caret stays at full opacity and pulses subtly. After this
// window the caret fades to a quieter idle state so you can tell at a
// glance who's editing vs who's just present.
const TYPING_FADE_MS = 1500;
const IDLE_FADE_MS   = 3000;
const IDLE_OPACITY   = 0.55;

// Client rects of the text between two positions in one editor.
function rangeRects(view, from, to) {
  try {
    const a = view.domAtPos(from);
    const b = view.domAtPos(to);
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    range.setEnd(b.node, b.offset);
    return Array.from(range.getClientRects()).filter(rc => rc.width > 0 && rc.height > 0);
  } catch (_) {
    return [];
  }
}

// Someone reading or editing through the doc's share (DocShareView): the
// room marks them (user.guest), and their tag says so.
const peerLabel = (user) => `${(user.name || '?').split(' ')[0]}${user.guest ? ' (guest)' : ''}`;

export function DocPresence({ getAwareness, boardId, pageId, paperRef, editor, getEditors, zoom = 1, currentUser }) {
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

  // Read in callbacks that outlive a render (the layout pass, the writers).
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom > 0 ? zoom : 1;
  const getEditorsRef = useRef(getEditors);
  getEditorsRef.current = getEditors;
  const editorRef = useRef(editor);
  editorRef.current = editor;

  // Per-peer typing tracking. Bumped from the awareness `change` handler
  // when a peer's caret actually moves (i.e. they're editing or
  // navigating). Used to drive the typing pulse + idle fade in render.
  const lastCaretChangeRef = useRef(new Map()); // userId → performance.now()
  const lastCaretSigRef    = useRef(new Map()); // userId → caret signature

  // ── Read peers ─────────────────────────────────────────────────────────
  const peersSigRef = useRef('');
  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw) return;
    const refresh = (change) => {
      // Our own docCursor / docCaret writes fire 'change' too — every 30ms
      // of mouse movement and every keystroke. Nothing a peer sees changed.
      if (change) {
        const ids = [...(change.added || []), ...(change.updated || []), ...(change.removed || [])];
        if (ids.length && ids.every(id => id === aw.clientID)) return;
      }
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
        const here = (v) => v?.boardId === boardId && v?.pageId === pageId;
        if (!here(cursor) && !here(caret) && !here(sel)) return;
        const meta = aw.meta?.get?.(clientId);
        const updated = meta?.lastUpdated || 0;
        const existing = newest.get(state.user.id);
        if (existing && existing.updated >= updated) return;
        // Detect caret movement so the receiving overlay can pulse.
        if (here(caret)) {
          const sig = `${caret.head || ''}|${caret.x},${caret.y}`;
          if (lastCaretSigRef.current.get(state.user.id) !== sig) {
            lastCaretSigRef.current.set(state.user.id, sig);
            lastCaretChangeRef.current.set(state.user.id, now);
          }
        }
        newest.set(state.user.id, {
          clientId, updated,
          user: state.user,
          cursor: here(cursor) ? { x: cursor.x, y: cursor.y, u: !!cursor.u } : null,
          caret:  here(caret) ? { x: caret.x, y: caret.y, head: caret.head || null } : null,
          sel:    here(sel) ? { rects: sel.rects || [], from: sel.from || null, to: sel.to || null } : null,
        });
      });
      const next = [...newest.values()];
      // Skip the re-render when nothing a peer shows changed (lastUpdated
      // ticks on every heartbeat; it is bookkeeping, not display).
      const sig = JSON.stringify(next.map(p => [p.clientId, p.user, p.cursor, p.caret, p.sel]));
      if (sig === peersSigRef.current) return;
      peersSigRef.current = sig;
      setPeers(next);
    };
    refresh();
    aw.on('change', refresh);
    return () => aw.off('change', refresh);
  }, [getAwareness, boardId, pageId]);

  // The idle fade is a CSS transition (see render). The only re-render it
  // needs is at the moment a peer's typing window closes — one timeout at the
  // nearest such boundary, instead of a 250ms interval running for as long as
  // anyone shares the page. The tick is a dep so each fired boundary
  // schedules the next one: two peers whose windows close 500ms apart need
  // two timeouts, and the first one's re-render alone would not re-arm.
  const [fadeTick, setFadeTick] = useState(0);
  useEffect(() => {
    if (peers.length === 0) return undefined;
    const now = performance.now();
    let wait = Infinity;
    for (const p of peers) {
      if (!p.caret) continue;
      const left = (lastCaretChangeRef.current.get(p.user.id) || 0) + TYPING_FADE_MS - now;
      if (left > 0 && left < wait) wait = left;
    }
    if (!Number.isFinite(wait)) return undefined;
    const id = setTimeout(() => setFadeTick(n => (n + 1) | 0), wait + 16);
    return () => clearTimeout(id);
  }, [peers, fadeTick]);

  // ── Write our local mouse cursor (unzoomed sheet px) ────────────────────
  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw || !paperEl) return;
    let pending = null;
    let timer = null;
    const flush = () => {
      timer = null;
      if (!pending) return;
      aw.setLocalStateField('docCursor', { boardId, pageId, x: pending.x, y: pending.y, u: 1 });
      pending = null;
    };
    const onMove = (e) => {
      const wrap = paperEl.querySelector('.doc-editor-wrap');
      if (!wrap) return;
      const wr = wrap.getBoundingClientRect();
      const z = zoomRef.current;
      pending = {
        x: Math.round((e.clientX - wr.left) / z),
        y: Math.round((e.clientY - wr.top) / z),
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
  // Batched to one rAF per frame: the legacy pixel fields need layout reads,
  // which straight after ProseMirror's DOM write on every keystroke forced a
  // synchronous reflow. lastSig is a useRef so the dedup survives effect
  // re-runs (the editor prop flips null → instance after mount).
  const lastSigRef = useRef('');
  useEffect(() => {
    const aw = getAwareness?.();
    if (!aw || !paperEl || !editor) return;
    let raf = 0;
    const publish = () => {
      raf = 0;
      try {
        if (editor.isDestroyed) return;
        const sel = editor.state.selection;
        const view = editor.view;
        if (!view) return;
        const wrap = paperEl.querySelector('.doc-editor-wrap');
        if (!wrap) return;
        const r = wrap.getBoundingClientRect();
        const headCoords = view.coordsAtPos(sel.head);
        const x = Math.round(headCoords.left - r.left);
        const y = Math.round(headCoords.top  - r.top);
        const head = encodeAnchor(editor, sel.head);
        let rects = null, from = null, to = null;
        if (!sel.empty) {
          from = encodeAnchor(editor, sel.from);
          to = encodeAnchor(editor, sel.to);
          rects = rangeRects(view, sel.from, sel.to).map(rc => ({
            left: Math.round(rc.left - r.left),
            top: Math.round(rc.top  - r.top),
            width: Math.round(rc.width),
            height: Math.round(rc.height),
          }));
        }
        const sig = `${head}|${from}|${to}|${x},${y}|${rects ? rects.map(q => `${q.left},${q.top},${q.width},${q.height}`).join(';') : ''}`;
        if (sig === lastSigRef.current) return;
        lastSigRef.current = sig;
        aw.setLocalStateField('docCaret',     { boardId, pageId, x, y, head });
        aw.setLocalStateField('docSelection', rects ? { boardId, pageId, rects, from, to } : null);
      } catch (_) {}
    };
    const onTr = () => { if (!raf) raf = requestAnimationFrame(publish); };
    editor.on('transaction', onTr);
    editor.on('selectionUpdate', onTr);
    editor.on('focus', onTr);
    onTr();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      editor.off('transaction', onTr);
      editor.off('selectionUpdate', onTr);
      editor.off('focus', onTr);
      try { aw.setLocalStateField('docCaret', null); } catch (_) {}
      try { aw.setLocalStateField('docSelection', null); } catch (_) {}
    };
  }, [getAwareness, paperEl, editor, boardId, pageId]);

  // ── Lay out peer overlays ──────────────────────────────────────────────
  // All layout reads happen here, in one rAF-batched pass that stores plain
  // numbers — never during render. It re-runs when peers change, when our
  // own doc changes (text above a peer's caret moves it), on zoom, and when
  // the sheet resizes. Positions are relative to the overlay layer, which
  // scrolls with the paper, so scrolling needs no re-layout.
  const layerRef = useRef(null);
  const [placed, setPlaced] = useState({});
  const peersRef = useRef(peers);
  peersRef.current = peers;
  const layoutRafRef = useRef(0);
  const scheduleLayout = useRef(() => {});
  scheduleLayout.current = () => {
    if (layoutRafRef.current) return;
    layoutRafRef.current = requestAnimationFrame(() => {
      layoutRafRef.current = 0;
      const layer = layerRef.current;
      if (!layer || !paperEl) return;
      const lr = layer.getBoundingClientRect();
      const wrap = paperEl.querySelector('.doc-editor-wrap');
      const wr = wrap ? wrap.getBoundingClientRect() : lr;
      const z = zoomRef.current;
      const eds = (getEditorsRef.current?.() || []).filter(e => e && !e.isDestroyed);
      if (!eds.length && editorRef.current && !editorRef.current.isDestroyed) eds.push(editorRef.current);
      // A relative position names the fragment it belongs to, so it resolves
      // in exactly one of the page's sheet editors.
      const resolve = (enc) => {
        if (!enc) return null;
        for (const ed of eds) {
          const pos = resolveAnchor(ed, enc);
          if (pos != null) return { ed, pos };
        }
        return null;
      };
      const out = {};
      for (const p of peersRef.current) {
        const entry = { caret: null, sel: [], cursor: null };
        if (p.caret) {
          const at = resolve(p.caret.head);
          if (at) {
            try {
              const c = at.ed.view.coordsAtPos(at.pos);
              entry.caret = { left: c.left - lr.left, top: c.top - lr.top, height: Math.max(8, c.bottom - c.top) };
            } catch (_) {}
          } else if (p.caret.head == null) {
            // A peer on the previous bundle: raw px from their sheet origin.
            entry.caret = { left: wr.left - lr.left + p.caret.x, top: wr.top - lr.top + p.caret.y, height: null };
          }
        }
        if (p.sel) {
          const a = resolve(p.sel.from);
          const b = a ? resolve(p.sel.to) : null;
          if (a && b && a.ed === b.ed) {
            entry.sel = rangeRects(a.ed.view, Math.min(a.pos, b.pos), Math.max(a.pos, b.pos))
              .map(rc => ({ left: rc.left - lr.left, top: rc.top - lr.top, width: rc.width, height: rc.height }));
          } else if (p.sel.from == null) {
            entry.sel = (p.sel.rects || []).map(rc => ({
              left: wr.left - lr.left + rc.left, top: wr.top - lr.top + rc.top, width: rc.width, height: rc.height,
            }));
          }
        }
        if (p.cursor) {
          const k = p.cursor.u ? z : 1;
          entry.cursor = { left: wr.left - lr.left + p.cursor.x * k, top: wr.top - lr.top + p.cursor.y * k };
        }
        out[p.clientId] = entry;
      }
      setPlaced(out);
    });
  };
  // `editor` too: a peer's position can't resolve until a sheet editor exists.
  useLayoutEffect(() => { scheduleLayout.current(); }, [peers, zoom, paperEl, editor]);
  useEffect(() => {
    if (!paperEl || peers.length === 0) return undefined;
    const relayout = () => scheduleLayout.current();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(relayout) : null;
    ro?.observe(paperEl);
    const wrap = paperEl.querySelector('.doc-editor-wrap');
    if (wrap) ro?.observe(wrap);
    const onUpdate = () => relayout();
    editor?.on('update', onUpdate);
    return () => {
      ro?.disconnect();
      editor?.off('update', onUpdate);
    };
  }, [paperEl, editor, peers.length === 0]);
  // Reset the id too: StrictMode's mount → unmount → mount would otherwise
  // leave a cancelled id behind, and scheduleLayout would wait on it forever.
  useEffect(() => () => {
    if (layoutRafRef.current) cancelAnimationFrame(layoutRafRef.current);
    layoutRafRef.current = 0;
  }, []);

  // ── Render peer overlays ───────────────────────────────────────────────
  const now = performance.now();
  return (
    <div ref={layerRef} className="doc-presence-layer" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 999990 }}>
      {peers.map(p => {
        const at = placed[p.clientId];
        if (!at) return null;
        const els = [];
        const color = p.user.color || '#4f8df8';
        // Compute typing state up front so we can suppress this peer's
        // floating mouse cursor while their caret is actively moving —
        // otherwise you see two markers (caret + cursor) for the same
        // person at once, which is noisy.
        const lastChange = lastCaretChangeRef.current.get(p.user.id) || 0;
        const peerIsTyping = !!p.caret && (now - lastChange) < TYPING_FADE_MS;
        at.sel.forEach((rc, i) => {
          els.push(
            <div key={'sel-' + p.clientId + '-' + i}
                 className="doc-peer-selection"
                 style={{
                   position: 'absolute',
                   left: rc.left, top: rc.top,
                   width: rc.width, height: rc.height,
                   background: color,
                   opacity: 0.22,
                   borderRadius: 1,
                   pointerEvents: 'none',
                   transition: 'opacity 120ms linear, transform 90ms linear',
                 }} />
          );
        });
        if (at.caret) {
          els.push(
            <div key={'caret-' + p.clientId}
                 className={`doc-peer-caret ${peerIsTyping ? 'doc-peer-caret--typing' : ''}`}
                 style={{
                   position: 'absolute',
                   left: at.caret.left,
                   top: at.caret.top,
                   borderLeft: `2px solid ${color}`,
                   height: at.caret.height ?? '1.2em',
                   pointerEvents: 'none',
                   // Full while typing; once the typing window closes the
                   // transition eases it down to the idle level over
                   // IDLE_FADE_MS (the old 250ms interval stepped the same
                   // curve by hand).
                   opacity: peerIsTyping ? 1 : IDLE_OPACITY,
                   transition: `left 90ms linear, top 90ms linear, opacity ${peerIsTyping ? 120 : IDLE_FADE_MS}ms linear`,
                 }}>
              <span className="doc-peer-caret-label" style={{
                position: 'absolute',
                top: '-1.5em', left: '-2px',
                background: color,
                color: '#fff',
                font: '600 10px/1 var(--font-sans)',
                padding: '2px 5px',
                borderRadius: 3,
                whiteSpace: 'nowrap',
              }}>{peerLabel(p.user)}</span>
            </div>
          );
        }
        if (at.cursor && !peerIsTyping) {
          els.push(
            <LiveCursor key={'cursor-' + p.clientId}
                        x={at.cursor.left} y={at.cursor.top}
                        name={peerLabel(p.user)}
                        color={color} />
          );
        }
        return els;
      })}
    </div>
  );
}
