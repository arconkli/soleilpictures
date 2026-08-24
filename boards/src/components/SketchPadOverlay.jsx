// Sketch pad overlay — a fullscreen drawing surface that opens above
// the canvas. Reuses the same stroke data shape as the inline draw
// tool (color, width, points[][]) so when the user closes the pad we
// commit the strokes back into the active board's strokes Y.Array
// via addStroke().
//
// Why have a separate pad if the canvas already supports freehand?
// The canvas conflates pan/zoom/select gestures with drawing — small
// hand sketches are cramped, and the user has to switch tools.  The
// pad is a deliberate "I'm sketching now" mode with full screen real
// estate, no other content under your cursor, and Esc to bail.
//
// Strokes are committed at the END of the session (one transaction)
// rather than streaming — keeps the Y.Doc small and avoids broadcasting
// every move tick to peers. Live cursor presence is intentionally not
// hooked up here; it's a focused individual tool.

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Undo, Redo } from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import { ColorPicker } from './ColorPicker.jsx';
import { addRecentColor } from '../lib/recentColors.js';
import { useRecentColors } from '../hooks/useRecentColors.js';
import { useFeedback } from './AppFeedback.jsx';
import { isEditableTarget } from '../lib/isEditableTarget.js';
import { pushDocUndoTarget, removeDocUndoTarget } from '../lib/overlayRouting.js';
import { registerModalOpen } from '../lib/modalGuard.js';
import { swallowContextMenu } from '../lib/contextMenuGuard.js';

// Default pen stroke + bucket fill colors. The pad SURFACE defaults to
// pure white — when the user commits, the surrounding ArtCanvasCard
// adopts whatever bg the user painted (white if untouched).
const DEFAULT_COLOR = '#0a0a0c';
const DEFAULT_BG = '#ffffff';
const DEFAULT_WIDTH = 3;
const COLOR_PRESETS = ['#0a0a0c', '#f5f5f6', '#ffa500', '#cf6a4f', '#7c5cc9', '#3fa39a', '#5b8fc7', '#10b981'];
const WIDTH_PRESETS = [1, 2, 4, 8, 14];

function strokeToPath(pts) {
  if (!pts || pts.length === 0) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += ` L${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)}`;
  return d;
}

// Logical drawing surface size for newly-created canvases. Strokes are
// stored at this resolution so the SketchPad and the resulting card use
// the exact same coordinate space — every pixel in the pad maps to a
// fixed pixel in the card. The pad is rendered larger or smaller via
// CSS while preserving this aspect ratio.
const NEW_CANVAS_W = 480;
const NEW_CANVAS_H = 360;

export function SketchPadOverlay({ open, onClose, onCommitStrokes, editingCard }) {
  // The logical canvas size for the current session. When editing, we
  // adopt the existing card's bounds so strokes stay in card-local
  // coords without any rescaling on commit.
  const logicalW = editingCard?.w || NEW_CANVAS_W;
  const logicalH = editingCard?.h || NEW_CANVAS_H;
  // Tool state
  const [tool, setTool]   = useState('pen'); // 'pen' | 'eraser' | 'bucket'
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [padBg, setPadBg] = useState(DEFAULT_BG);
  const [pickerPos, setPickerPos] = useState(null);
  // Recent colors strip (per-user, persisted via lib/recentColors).
  const recentColors = useRecentColors();
  const swatchRow = (() => {
    const seen = new Set();
    const out = [];
    for (const c of [...recentColors, ...COLOR_PRESETS]) {
      if (!c || seen.has(c)) continue;
      seen.add(c);
      out.push(c);
      if (out.length >= 10) break;
    }
    return out;
  })();
  // Drawing state
  const [strokes, setStrokes]       = useState([]);
  const [activeStroke, setActive]   = useState(null);
  const wrapRef = useRef(null);
  const feedback = useFeedback();

  // ── Pad-local undo/redo ────────────────────────────────────────────────
  // The pad's drawing state is plain component state, so its history is a
  // snapshot stack of { strokes, bg } (both are updated immutably, making
  // reference snapshots safe). This is the pad's ONE undo engine — the
  // board's UndoManager never sees pad edits until Save commits them.
  // pushHistory is called once per DISCRETE change: a committed pen stroke,
  // an eraser GESTURE (pointerdown, not per hover-erase tick), a bucket
  // fill, a Clear. A tick counter forces a re-render so the toolbar
  // buttons' disabled state tracks the ref stacks.
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const [, setHistTick] = useState(0);
  const strokesLive = useRef(strokes);
  strokesLive.current = strokes;
  const padBgLive = useRef(padBg);
  padBgLive.current = padBg;
  const pushHistory = useCallback(() => {
    const snap = { strokes: strokesLive.current, bg: padBgLive.current };
    const top = undoStackRef.current[undoStackRef.current.length - 1];
    if (top && top.strokes === snap.strokes && top.bg === snap.bg) return;
    undoStackRef.current.push(snap);
    if (undoStackRef.current.length > 100) undoStackRef.current.shift();
    redoStackRef.current.length = 0;
    setHistTick(t => t + 1);
  }, []);
  const undoPad = useCallback(() => {
    const snap = undoStackRef.current.pop();
    if (!snap) return;
    redoStackRef.current.push({ strokes: strokesLive.current, bg: padBgLive.current });
    setStrokes(snap.strokes);
    setPadBg(snap.bg);
    setHistTick(t => t + 1);
  }, []);
  const redoPad = useCallback(() => {
    const snap = redoStackRef.current.pop();
    if (!snap) return;
    undoStackRef.current.push({ strokes: strokesLive.current, bg: padBgLive.current });
    setStrokes(snap.strokes);
    setPadBg(snap.bg);
    setHistTick(t => t + 1);
  }, []);
  const resetHistory = () => {
    undoStackRef.current.length = 0;
    redoStackRef.current.length = 0;
    setHistTick(t => t + 1);
  };
  // Live mirror of strokes so the discard prompt reads the CURRENT count (the
  // Escape handler is bound on [open], so a plain closure saw a stale count
  // and would close without prompting after the user drew something).
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const discardingRef = useRef(false);
  // In-app discard confirm (replaces window.confirm so it layers/traps/styles
  // correctly). Returns true to proceed. Re-entrancy guard prevents a second
  // prompt while one is already open.
  const confirmDiscard = async () => {
    if (!strokesRef.current?.length) return true;
    if (discardingRef.current) return false;
    discardingRef.current = true;
    const ok = await feedback.confirm({
      title: 'Discard sketch?',
      message: 'Your drawing will be lost.',
      confirmLabel: 'Discard',
      danger: true,
    });
    discardingRef.current = false;
    return ok;
  };

  // Reset on open. When the pad opens to edit an existing art canvas, seed
  // it with that card's strokes (already in card-local coords, which we
  // treat as pad coords) and bg color so the user sees their drawing
  // exactly as it sits on the board, ready to keep working on.
  //
  // KEYBOARD ISOLATION, learned the hard way: the pad is a fullscreen
  // portal, but window-level shortcut listeners (CanvasSurface's keydown +
  // paste) kept running underneath it — so ⌘Z in the pad UNDID CANVAS STATE
  // hidden behind the overlay, and Backspace could delete whichever cards
  // happened to be selected. This listener runs in the CAPTURE phase (so it
  // fires before every bubble-phase listener), handles the pad's own keys
  // (⌘Z/⌘⇧Z/⌘Y undo-redo, Escape → discard flow), and stops propagation of
  // EVERYTHING else so no board shortcut can act behind a modal drawing
  // surface. Editable targets (the ColorPicker hex input) pass through
  // untouched. Belt + braces: the pad also registers its undo/redo with
  // overlayRouting, so CanvasSurface's ⌘Z branch stands down even if
  // listener ordering ever changes.
  useEffect(() => {
    if (!open) return;
    if (editingCard) {
      setStrokes(Array.isArray(editingCard.strokes) ? editingCard.strokes.map(s => ({ ...s, points: s.points.map(p => [...p]) })) : []);
      setPadBg(editingCard.bg || DEFAULT_BG);
    } else {
      setStrokes([]);
      setPadBg(DEFAULT_BG);
    }
    setActive(null);
    setTool('pen');
    resetHistory();
    const padTarget = { undo: undoPad, redo: redoPad };
    pushDocUndoTarget(padTarget);
    // Counts as an open dialog too, which is what shields the board's PASTE
    // handler (the capture keydown below can't intercept paste events).
    const unregisterModal = registerModalOpen();
    const onKey = (e) => {
      if (isEditableTarget(e)) return;
      // Dialogs (the discard confirm) and popovers (ColorPicker) stack ABOVE
      // the pad and own their own keys — never intercept inside them.
      const el = e.target instanceof Element ? e.target : null;
      if (el && el.closest('[role="dialog"], .cp-pop, .toast-stack')) return;
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        undoPad();
        return;
      }
      if ((cmd && e.key === 'z' && e.shiftKey) || (cmd && e.key === 'y')) {
        e.preventDefault();
        e.stopPropagation();
        redoPad();
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        (async () => { if (await confirmDiscard()) onClose?.(); })();
        return;
      }
      // Everything else: never let a board shortcut fire behind the pad.
      // (No preventDefault — browser-native behavior like ⌘C on selected
      // text stays; only the app's window listeners are shut out.)
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true });
      unregisterModal();
      removeDocUndoTarget(padTarget);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Map a viewport-pixel coord into the pad's logical coord space so
  // strokes get stored at the resolution that will become the card.
  const toLogical = (clientX, clientY) => {
    const rect = wrapRef.current.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * logicalW,
      y: ((clientY - rect.top) / rect.height) * logicalH,
    };
  };
  // One history entry per ERASER GESTURE, pushed lazily on the first stroke
  // it actually removes (an empty swipe must not create a no-op undo step).
  const eraserPushedRef = useRef(false);
  const eraseAt = (x, y) => {
    const HIT = Math.max(width + 6, 12);
    const hits = strokesLive.current.some(s => pointNearStroke(s, x, y, HIT));
    if (!hits) return;
    if (!eraserPushedRef.current) { pushHistory(); eraserPushedRef.current = true; }
    setStrokes(prev => prev.filter(s => !pointNearStroke(s, x, y, HIT)));
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    if (!wrapRef.current) return;
    // The pad lives in a portal, so React events bubble through the
    // React tree all the way back to CanvasSurface's canvas-wrap and
    // trigger its draw handler — every pad stroke would also paint a
    // board stroke. Stop propagation here (and in move/up below).
    e.stopPropagation();
    const { x, y } = toLogical(e.clientX, e.clientY);
    if (tool === 'bucket') {
      // Round 1 of paint bucket: click anywhere to set the WHOLE pad bg.
      // True region-fill (Canvas2D flood fill against rasterized strokes)
      // is a follow-up. The single-bg approach matches what the user gets
      // in most graphic tools when they bucket-click empty space.
      if (color !== padBg) pushHistory();
      setPadBg(color);
      addRecentColor(color);
      return;
    }
    if (tool === 'eraser') {
      // Capture so dragging the eraser keeps receiving move events even when
      // the pointer leaves the pad bounds (without this, erasing stopped at
      // the edge).
      try { e.target.setPointerCapture?.(e.pointerId); } catch (_) {}
      eraserPushedRef.current = false;
      eraseAt(x, y);
      return;
    }
    setActive({ color, width, points: [[x, y]] });
    try { e.target.setPointerCapture?.(e.pointerId); } catch (_) {}
  };

  const onPointerMove = (e) => {
    if (!wrapRef.current) return;
    e.stopPropagation();
    if (tool === 'eraser') {
      if (e.buttons !== 1) return;
      const { x, y } = toLogical(e.clientX, e.clientY);
      eraseAt(x, y);
      return;
    }
    if (!activeStroke) return;
    const { x, y } = toLogical(e.clientX, e.clientY);
    setActive(s => s ? { ...s, points: [...s.points, [x, y]] } : s);
  };

  const onPointerUp = (e) => {
    e?.stopPropagation?.();
    // Always release the capture taken in onPointerDown (this also serves
    // onPointerCancel) so an interrupted gesture can't lock the pointer.
    try { e?.target?.releasePointerCapture?.(e.pointerId); } catch (_) {}
    if (activeStroke && activeStroke.points?.length > 1) {
      pushHistory(); // snapshot the pre-stroke state → ⌘Z removes this line
      setStrokes(prev => [...prev, activeStroke]);
      addRecentColor(activeStroke.color);
    }
    setActive(null);
  };

  const onCommit = useCallback(() => {
    if (!editingCard && !strokes.length && padBg === DEFAULT_BG) { onClose?.(); return; }
    // Pass the strokes (in logical coords), the chosen pad bg, and the
    // logical canvas size up — the host writes the card with these as
    // its w/h so the SketchPad and the resulting card share one
    // coordinate system. When editing an existing card we forward its
    // id so the host updates instead of creating a new one.
    onCommitStrokes?.({
      strokes,
      bg: padBg,
      editingId: editingCard?.id || null,
      canvasW: logicalW,
      canvasH: logicalH,
    });
    onClose?.();
  }, [strokes, padBg, onCommitStrokes, onClose, editingCard, logicalW, logicalH]);

  if (!open) return null;

  return createPortal(
    // The pad is a full-viewport portal on document.body, so it sits outside
    // every canvas contextmenu handler and used to leave the OS menu as the
    // only thing a right-click could produce — over a drawing surface, where
    // "Reload / Save image as…" is never the intent. swallowContextMenu still
    // defers on the colour picker's hex field.
    <div className="sketchpad-bg" onContextMenu={swallowContextMenu}>
      <div className="sketchpad-frame">
        <div className="sketchpad-toolbar">
          <button type="button"
                  className={`sp-tool ${tool === 'pen' ? 'is-active' : ''}`}
                  onClick={() => setTool('pen')}
                  title="Pen">✎</button>
          <button type="button"
                  className={`sp-tool ${tool === 'eraser' ? 'is-active' : ''}`}
                  onClick={() => setTool('eraser')}
                  title="Eraser">⌫</button>
          <button type="button"
                  className={`sp-tool ${tool === 'bucket' ? 'is-active' : ''}`}
                  onClick={() => setTool('bucket')}
                  title="Paint bucket (click pad to fill background)">●</button>
          <span className="sp-sep" />
          {swatchRow.map(c => (
            <button key={c}
                    type="button"
                    className={`sp-color ${color === c ? 'is-active' : ''}`}
                    style={{ background: c }}
                    onClick={() => { setColor(c); addRecentColor(c); }}
                    title={c} />
          ))}
          <button type="button"
                  className="sp-color sp-color-custom"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    setPickerPos({ x: r.left + r.width / 2, y: r.bottom + 8 });
                  }}
                  title="Custom color">⋯</button>
          <span className="sp-sep" />
          {WIDTH_PRESETS.map(w => (
            <button key={w}
                    type="button"
                    className={`sp-width ${width === w ? 'is-active' : ''}`}
                    onClick={() => setWidth(w)}
                    title={`${w}px`}>
              <span className="sp-width-dot" style={{
                width: Math.min(20, w + 4),
                height: Math.min(20, w + 4),
              }} />
            </button>
          ))}
          <span className="sp-sep" />
          <button type="button"
                  className="sp-tool"
                  onClick={undoPad}
                  disabled={!undoStackRef.current.length}
                  title="Undo (⌘Z)"
                  aria-label="Undo sketch change">
            <Icon as={Undo} size={14} />
          </button>
          <button type="button"
                  className="sp-tool"
                  onClick={redoPad}
                  disabled={!redoStackRef.current.length}
                  title="Redo (⌘⇧Z)"
                  aria-label="Redo sketch change">
            <Icon as={Redo} size={14} />
          </button>
          <button type="button"
                  className="sp-action"
                  onClick={() => { if (strokesLive.current.length) { pushHistory(); setStrokes([]); } }}
                  disabled={!strokes.length}>Clear</button>
          <span style={{ flex: 1 }} />
          <button type="button"
                  className="sp-action"
                  onClick={async () => {
                    if (await confirmDiscard()) onClose?.();
                  }}>Cancel</button>
          <button type="button"
                  className="sp-action sp-action-primary"
                  onClick={onCommit}
                  disabled={!editingCard && !strokes.length}>
            {editingCard ? 'Save' : 'Add to canvas'}
          </button>
          <button type="button"
                  className="sp-x"
                  onClick={() => onClose?.()}
                  aria-label="Close">
            <Icon as={X} size={14} />
          </button>
        </div>
        <div className="sketchpad-frame-body">
        <div ref={wrapRef}
             className={`sketchpad-surface ${tool === 'eraser' ? 'is-eraser' : ''} ${tool === 'bucket' ? 'is-bucket' : ''}`}
             style={{ background: padBg, aspectRatio: `${logicalW} / ${logicalH}` }}
             onPointerDown={onPointerDown}
             onPointerMove={onPointerMove}
             onPointerUp={onPointerUp}
             onPointerCancel={onPointerUp}>
          <svg className="sketchpad-svg" width="100%" height="100%"
               viewBox={`0 0 ${logicalW} ${logicalH}`}
               preserveAspectRatio="none">
            {strokes.map((s, i) => (
              <path key={i}
                    d={strokeToPath(s.points)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={s.width}
                    strokeLinecap="round"
                    strokeLinejoin="round" />
            ))}
            {activeStroke && (
              <path d={strokeToPath(activeStroke.points)}
                    fill="none"
                    stroke={activeStroke.color}
                    strokeWidth={activeStroke.width}
                    strokeLinecap="round"
                    strokeLinejoin="round" />
            )}
          </svg>
          {!strokes.length && !activeStroke && (
            <div className="sketchpad-hint">
              Sketch freely — your strokes commit to the active board when you press “Add to canvas”.
            </div>
          )}
        </div>
        </div>
      </div>
      {pickerPos && (
        <ColorPicker value={color}
                     onChange={(c) => { setColor(c); addRecentColor(c); }}
                     onClose={() => setPickerPos(null)}
                     position={pickerPos}
                     allowTransparent={false} />
      )}
    </div>,
    document.body,
  );
}

// Squared-distance from point (px, py) to the nearest segment in
// stroke. Returns true if any segment is within `hit` px.
function pointNearStroke(stroke, px, py, hit) {
  const pts = stroke?.points;
  if (!pts || pts.length < 2) return false;
  const hit2 = hit * hit;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1];
    const [x2, y2] = pts[i];
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy || 1;
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy;
    const ddx = px - cx, ddy = py - cy;
    if (ddx * ddx + ddy * ddy <= hit2) return true;
  }
  return false;
}
