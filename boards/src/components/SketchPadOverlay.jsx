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
import { toPathD } from '../lib/strokeRender.js';
import { trackStroke, coalescedOf } from '../lib/pointerStroke.js';
import { eraseStrokes } from '../lib/strokeModel.js';
import { useBreakpoint } from '../hooks/useBreakpoint.js';
import { useGesture } from '@use-gesture/react';
import { Sheet } from './shell/Sheet.jsx';

// Default pen stroke + bucket fill colors. The pad SURFACE defaults to
// pure white — when the user commits, the surrounding ArtCanvasCard
// adopts whatever bg the user painted (white if untouched).
const DEFAULT_COLOR = '#0a0a0c';
const DEFAULT_BG = '#ffffff';
const DEFAULT_WIDTH = 3;
// Matches ERASER_DEFAULT_WIDTH on the board so the eraser is the same size on
// both surfaces, and the same translucent red preview swipe.
const DEFAULT_ERASER_WIDTH = 16;
const ERASER_PREVIEW_COLOR = 'rgba(239,68,68,.75)';
const COLOR_PRESETS = ['#0a0a0c', '#f5f5f6', '#ffa500', '#cf6a4f', '#7c5cc9', '#3fa39a', '#5b8fc7', '#10b981'];
const WIDTH_PRESETS = [1, 2, 4, 8, 14];
const ERASER_WIDTH_PRESETS = [8, 16, 28, 44];

// Logical drawing surface size for newly-created canvases. Strokes are
// stored at this resolution so the SketchPad and the resulting card use
// the exact same coordinate space — every pixel in the pad maps to a
// fixed pixel in the card. The pad is rendered larger or smaller via
// CSS while preserving this aspect ratio.
//
// The frame formats are the point of this card: sketching out shots for a shot
// list is what people reach for an art canvas to do, so a new one is a 16:9
// frame rather than the old 4:3 scratch pad. 2.39:1 is scope, 9:16 is vertical
// delivery, and 4:3 is still there for anyone using it as a notepad.
const ASPECTS = [
  { id: '16x9',  label: '16:9',   hint: 'Widescreen', w: 480, h: 270 },
  { id: '239x1', label: '2.39:1', hint: 'Scope',      w: 480, h: 201 },
  { id: '4x3',   label: '4:3',    hint: 'Classic',    w: 480, h: 360 },
  { id: '1x1',   label: '1:1',    hint: 'Square',     w: 420, h: 420 },
  { id: '9x16',  label: '9:16',   hint: 'Vertical',   w: 304, h: 540 },
];
const DEFAULT_ASPECT = '16x9';

const PAD_ZOOM_MIN = 1;
const PAD_ZOOM_MAX = 8;

// Keep at least this much of the frame on screen in each axis, so a pan can
// never lose the drawing off the edge with no way back except Reset.
const PAD_KEEP_VISIBLE = 0.35;

// w0/h0 are the UNTRANSFORMED size of the surface. At zoom 1 the frame is
// already fitted, so there is nothing to pan and the offset pins to zero.
function clampView({ z, x, y }, w0, h0) {
  const overX = Math.max(0, (w0 * z - w0) / 2);
  const overY = Math.max(0, (h0 * z - h0) / 2);
  const limX = overX + w0 * z * (0.5 - PAD_KEEP_VISIBLE);
  const limY = overY + h0 * z * (0.5 - PAD_KEEP_VISIBLE);
  return {
    z,
    x: Math.max(-limX, Math.min(limX, x)),
    y: Math.max(-limY, Math.min(limY, y)),
  };
}

export function SketchPadOverlay({ open, onClose, onCommitStrokes, editingCard }) {
  // The logical canvas size for the current session. When editing, we
  // adopt the existing card's bounds so strokes stay in card-local
  // coords without any rescaling on commit.
  const [aspect, setAspect] = useState(DEFAULT_ASPECT);
  // Touch phones and touch tablets get the compact bar + overflow sheet. Same
  // condition App/LocalBoardsApp gate the whole mobile shell on, so the pad
  // agrees with the rest of the app about what "mobile" means.
  const { isPhone, isTablet, isTouch } = useBreakpoint();
  const compact = isPhone || (isTablet && isTouch);
  const [sheetOpen, setSheetOpen] = useState(false);
  // ── Pad zoom/pan ──────────────────────────────────────────────────────────
  // A 16:9 frame on a portrait phone is a thin band — without zoom you cannot
  // work on any detail of a shot. Pinch to zoom, two fingers to pan, both
  // applied as a transform on the drawing surface itself so toLogical's rect
  // reads them for free.
  const [view, setView] = useState({ z: 1, x: 0, y: 0 });
  const bodyRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const aspectPreset = ASPECTS.find(a => a.id === aspect) || ASPECTS[0];
  const logicalW = editingCard?.w || aspectPreset.w;
  const logicalH = editingCard?.h || aspectPreset.h;
  // Tool state
  const [tool, setTool]   = useState('pen'); // 'pen' | 'eraser' | 'bucket'
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [eraserWidth, setEraserWidth] = useState(DEFAULT_ERASER_WIDTH);
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
  // Live mirror of the in-flight stroke's points, and the teardown for the
  // window-level pointer tracking behind it. Declared up here because the
  // open/close effect below has to be able to dispose an in-flight stroke.
  const activePtsRef = useRef(null);
  const strokeDisposeRef = useRef(null);

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
    setSheetOpen(false);
    setAspect(DEFAULT_ASPECT);
    setView({ z: 1, x: 0, y: 0 });
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
      // Closing mid-stroke (Escape, or Cancel while the finger is still down)
      // must not leave trackStroke's window listeners behind. The pad renders
      // null rather than unmounting when it closes, so an unmount-only cleanup
      // would never run here.
      strokeDisposeRef.current?.();
      strokeDisposeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Map a viewport-pixel coord into the pad's logical coord space so
  // strokes get stored at the resolution that will become the card.
  //
  // This reads the surface's LIVE bounding rect, which already has the pad's
  // zoom/pan transform baked into it — so zooming in needs no extra maths here,
  // and neither does the sample threshold below. That is the whole reason the
  // transform is applied to the surface element itself rather than to a wrapper.
  const toLogical = (clientX, clientY) => {
    const rect = wrapRef.current.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * logicalW,
      y: ((clientY - rect.top) / rect.height) * logicalH,
    };
  };
  // How many LOGICAL units one screen pixel is worth right now. Points closer
  // together than about a screen pixel are invisible but still cost a path
  // segment on every render, so the sampler drops them — and the threshold has
  // to be derived from the live rect because the pad scales to fit the viewport
  // (the same 1.5px board-space filter measured in the wrong space would be
  // meaningless here).
  // Pinch to zoom, two-finger drag to pan. Configured exactly like the board
  // canvas — in particular `pointer: { capture: false }`, which is a standing
  // invariant there: use-gesture's PointerEvent fallback otherwise calls
  // setPointerCapture on every left-button press and retargets everything after
  // it. See the long comment on the canvas's useGesture config.
  useGesture(
    {
      onPinch: ({ event, origin: [ox, oy], movement: [ms], memo }) => {
        if (event?.cancelable) event.preventDefault();
        const surface = wrapRef.current;
        const body = bodyRef.current;
        if (!surface || !body) return memo;
        const start = memo || { ...viewRef.current, rect: surface.getBoundingClientRect() };
        const z = Math.max(PAD_ZOOM_MIN, Math.min(PAD_ZOOM_MAX, start.z * ms));
        // Keep the point under the fingers pinned. The fraction of the surface
        // beneath them can't change, so solve for the offset that preserves it.
        const fx = start.rect.width ? (ox - start.rect.left) / start.rect.width : 0.5;
        const fy = start.rect.height ? (oy - start.rect.top) / start.rect.height : 0.5;
        const base = body.getBoundingClientRect();
        const w0 = start.rect.width / start.z;
        const h0 = start.rect.height / start.z;
        const cx = base.left + base.width / 2;
        const cy = base.top + base.height / 2;
        setView(clampView({
          z,
          x: (ox - fx * w0 * z) - (cx - (w0 * z) / 2),
          y: (oy - fy * h0 * z) - (cy - (h0 * z) / 2),
        }, w0, h0));
        return start;
      },
      onDrag: ({ event, delta: [dx, dy], touches, pinching, pointerType }) => {
        // Two fingers pan. One finger is always a stroke — that is the whole
        // point of a drawing surface — so this never competes with drawing.
        if (pinching) return;
        if (pointerType !== 'touch') return;
        if (touches < 2) return;
        if (event?.cancelable) event.preventDefault();
        const surface = wrapRef.current;
        if (!surface) return;
        const r = surface.getBoundingClientRect();
        const v = viewRef.current;
        setView(clampView({ z: v.z, x: v.x + dx, y: v.y + dy }, r.width / v.z, r.height / v.z));
      },
    },
    {
      target: bodyRef,
      eventOptions: { passive: false },
      pinch: { scaleBounds: { min: PAD_ZOOM_MIN / 2, max: PAD_ZOOM_MAX * 2 }, rubberband: true },
      drag: { pointer: { touch: true, capture: false }, threshold: 0 },
    },
  );

  const logicalPerScreenPx = () => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return 1;
    return logicalW / rect.width;
  };

  // A second finger means the user is pinching to zoom, not drawing. The first
  // finger has already started a stroke by then, and it would keep sampling
  // through a transform that is now moving — committing a smear across the
  // frame. Same guard the board canvas needs, for the same reason.
  const armSecondTouchAbort = (pointerId, onAbort) => {
    const onDown = (ev) => {
      if (ev.pointerType !== 'touch' || ev.pointerId === pointerId) return;
      window.removeEventListener('pointerdown', onDown, true);
      strokeDisposeRef.current?.();
      strokeDisposeRef.current = null;
      onAbort();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  };

  // Points accumulate in activePtsRef, NOT in React state: setActive is called
  // once per animation frame with a copy, so a 240Hz Pencil drives one render
  // per frame instead of one per native event.
  const beginStroke = (e, startPoint) => {
    const points = [startPoint];
    activePtsRef.current = points;
    const minStep = 1.2 * logicalPerScreenPx();
    const stroke = { color, width };
    setActive({ ...stroke, points: [...points] });
    let aborted = false;
    const disarm = e.pointerType === 'touch'
      ? armSecondTouchAbort(e.pointerId, () => {
          aborted = true;
          activePtsRef.current = null;
          setActive(null);
        })
      : () => {};

    const addPoint = (clientX, clientY) => {
      const { x, y } = toLogical(clientX, clientY);
      const last = points[points.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) < minStep) return;
      points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    };

    strokeDisposeRef.current = trackStroke({
      pointerId: e.pointerId,
      onSample: (ev) => {
        // Safari and Chrome dispatch roughly one move per frame and stash the
        // high-frequency samples in getCoalescedEvents — expanding them here is
        // what keeps a Pencil line smooth without paying a render per sample.
        for (const s of coalescedOf(ev)) addPoint(s.clientX, s.clientY);
        setActive({ ...stroke, points: [...points] });
      },
      onEnd: () => {
        disarm();
        // Commit on pointercancel too. iOS fires cancel (not up) on palm
        // rejection and system gestures; discarding there would silently eat a
        // finished line, which is the board draw path's reasoning as well.
        if (!aborted && points.length > 1) {
          pushHistory(); // snapshot the pre-stroke state → ⌘Z removes this line
          setStrokes(prev => [...prev, { ...stroke, points }]);
          addRecentColor(stroke.color);
        }
        setActive(null);
        activePtsRef.current = null;
        strokeDisposeRef.current = null;
      },
    });
  };

  const beginErase = (e, startPoint) => {
    const points = [startPoint];
    const radius = Math.max(4, (eraserWidth || DEFAULT_ERASER_WIDTH) / 2);
    const minStep = 1.2 * logicalPerScreenPx();
    // A translucent red preview of the swipe, exactly like the board eraser, so
    // you can see the path you're about to cut before you lift.
    setActive({ color: ERASER_PREVIEW_COLOR, width: radius * 2, points: [...points], eraser: true });
    let aborted = false;
    const disarm = e.pointerType === 'touch'
      ? armSecondTouchAbort(e.pointerId, () => { aborted = true; setActive(null); })
      : () => {};

    const addPoint = (clientX, clientY) => {
      const { x, y } = toLogical(clientX, clientY);
      const last = points[points.length - 1];
      if (Math.hypot(x - last[0], y - last[1]) < minStep) return;
      points.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    };

    strokeDisposeRef.current = trackStroke({
      pointerId: e.pointerId,
      onSample: (ev) => {
        for (const s of coalescedOf(ev)) addPoint(s.clientX, s.clientY);
        setActive({ color: ERASER_PREVIEW_COLOR, width: radius * 2, points: [...points], eraser: true });
      },
      onEnd: () => {
        disarm();
        if (!aborted && points.length > 1) {
          // Erasing SPLITS strokes here now, the same as on the board. The pad
          // used to delete a whole stroke on contact, so the identical gesture
          // did two different things depending on which surface you were on.
          // eraseStrokes reports whether anything was actually cut, so a swipe
          // over empty space costs neither a re-render nor an undo step.
          const { next, changed } = eraseStrokes(strokesLive.current, points, radius);
          if (changed) {
            pushHistory();
            setStrokes(next);
          }
        }
        setActive(null);
        strokeDisposeRef.current = null;
      },
    });
  };

  const onPointerDown = (e) => {
    // Pen tips report button 0; some report -1 (no button change), and the
    // barrel / eraser end reports 5. Only a genuine secondary or middle click
    // should be ignored — the old `!== 0` test dropped the Pencil's barrel
    // button on the floor.
    if (e.button !== 0 && e.button !== -1 && e.button !== 5) return;
    if (!wrapRef.current) return;
    // Only the first finger draws. A second finger is a pinch, and if it were
    // allowed to open its own stroke the second-touch abort would kill the
    // first one only for the second to draw straight through the zoom.
    if (e.pointerType === 'touch' && e.isPrimary === false) return;
    // The pad lives in a portal, so React events bubble through the
    // React tree all the way back to CanvasSurface's canvas-wrap and
    // trigger its draw handler — every pad stroke would also paint a
    // board stroke. Stop propagation here.
    e.stopPropagation();
    e.preventDefault();
    const { x, y } = toLogical(e.clientX, e.clientY);
    const start = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];

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
    // Flipping an Apple Pencil / Surface Pen over erases, which is what the
    // hardware is telling us it wants (button 5 / the eraser bit in `buttons`).
    const eraserEnd = e.button === 5 || (e.buttons & 32) === 32;
    if (tool === 'eraser' || eraserEnd) { beginErase(e, start); return; }
    beginStroke(e, start);
  };

  // Escape / unmount while a stroke is in flight: tear the window listeners
  // down without committing. trackStroke's dispose is idempotent.
  useEffect(() => () => { strokeDisposeRef.current?.(); }, []);

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

  // ── Toolbar pieces ────────────────────────────────────────────────────────
  // Shared between the desktop strip and the touch sheet so the two can't drift
  // apart. On a phone the old single flex row held ~25 controls at 28px and
  // 22px — roughly half a usable touch target, and wider than the viewport.
  const activeWidth = tool === 'eraser' ? eraserWidth : width;
  const widthPresets = tool === 'eraser' ? ERASER_WIDTH_PRESETS : WIDTH_PRESETS;
  // Changing the frame rescales nothing, so it is only offered while the canvas
  // is still empty — after that it would silently crop what you've drawn.
  const canPickAspect = !editingCard && !strokes.length;

  const swatches = (
    <>
      {swatchRow.map(c => (
        <button key={c}
                type="button"
                className={`sp-color ${color === c ? 'is-active' : ''}`}
                style={{ background: c }}
                onClick={() => { setColor(c); addRecentColor(c); }}
                title={c}
                aria-label={`Colour ${c}`} />
      ))}
      <button type="button"
              className="sp-color sp-color-custom"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setPickerPos({ x: r.left + r.width / 2, y: r.bottom + 8 });
              }}
              title="Custom color"
              aria-label="Custom colour">⋯</button>
    </>
  );

  const widths = widthPresets.map(w => (
    <button key={w}
            type="button"
            className={`sp-width ${activeWidth === w ? 'is-active' : ''}`}
            onClick={() => (tool === 'eraser' ? setEraserWidth(w) : setWidth(w))}
            title={tool === 'eraser' ? `Eraser size ${w}px` : `${w}px`}
            aria-label={tool === 'eraser' ? `Eraser size ${w}` : `Stroke width ${w}`}>
      <span className="sp-width-dot" style={{
        width: Math.min(20, w + 4),
        height: Math.min(20, w + 4),
      }} />
    </button>
  ));

  const aspectButtons = ASPECTS.map(a => (
    <button key={a.id}
            type="button"
            className={`sp-aspect ${aspect === a.id ? 'is-active' : ''}`}
            onClick={() => setAspect(a.id)}
            title={a.hint}>
      <span className="sp-aspect-box" style={{ aspectRatio: `${a.w} / ${a.h}` }} />
      <span className="sp-aspect-lbl">{a.label}</span>
    </button>
  ));

  const toolButtons = (
    <>
      <button type="button"
              className={`sp-tool ${tool === 'pen' ? 'is-active' : ''}`}
              onClick={() => setTool('pen')}
              aria-label="Pen" title="Pen">✎</button>
      <button type="button"
              className={`sp-tool ${tool === 'eraser' ? 'is-active' : ''}`}
              onClick={() => setTool('eraser')}
              aria-label="Eraser" title="Eraser">⌫</button>
      <button type="button"
              className={`sp-tool ${tool === 'bucket' ? 'is-active' : ''}`}
              onClick={() => setTool('bucket')}
              aria-label="Paint bucket"
              title="Paint bucket (click pad to fill background)">●</button>
    </>
  );

  const undoRedo = (
    <>
      <button type="button"
              className="sp-tool"
              onClick={undoPad}
              disabled={!undoStackRef.current.length}
              title="Undo (⌘Z)"
              aria-label="Undo sketch change">
        <Icon as={Undo} size={16} />
      </button>
      <button type="button"
              className="sp-tool"
              onClick={redoPad}
              disabled={!redoStackRef.current.length}
              title="Redo (⌘⇧Z)"
              aria-label="Redo sketch change">
        <Icon as={Redo} size={16} />
      </button>
    </>
  );

  const clearBtn = (
    <button type="button"
            className="sp-action"
            onClick={() => { if (strokesLive.current.length) { pushHistory(); setStrokes([]); } }}
            disabled={!strokes.length}>Clear</button>
  );
  const cancelBtn = (
    <button type="button"
            className="sp-action"
            onClick={async () => { if (await confirmDiscard()) onClose?.(); }}>Cancel</button>
  );
  const commitBtn = (
    <button type="button"
            className="sp-action sp-action-primary"
            onClick={onCommit}
            disabled={!editingCard && !strokes.length}>
      {/* A phone has no room for "Add to canvas" alongside finger-sized tools —
          the full label pushed the primary action clean off the right edge. */}
      {editingCard ? 'Save' : (compact ? 'Add' : 'Add to canvas')}
    </button>
  );

  return createPortal(
    // The pad is a full-viewport portal on document.body, so it sits outside
    // every canvas contextmenu handler and used to leave the OS menu as the
    // only thing a right-click could produce — over a drawing surface, where
    // "Reload / Save image as…" is never the intent. swallowContextMenu still
    // defers on the colour picker's hex field.
    <div className={`sketchpad-bg ${compact ? 'is-compact' : ''}`} onContextMenu={swallowContextMenu}>
      <div className="sketchpad-frame">
        <div className="sketchpad-toolbar">
          {compact ? (
            // Two zones on touch: the tools scroll, the actions never do. A
            // single scrolling row put the primary button off the right edge of
            // a phone, which is the same trap the board's options bar was in.
            //
            // The swatch strip and size row live in the sheet, and the bar keeps
            // one chip showing the CURRENT colour and width — two taps to change
            // either, but every target is finger-sized and the bar fits.
            <>
              <div className="sp-bar-scroll">
                {toolButtons}
                <span className="sp-sep" />
                <button type="button"
                        className="sp-chip"
                        onClick={() => setSheetOpen('color')}
                        aria-label="Colour and size">
                  <span className="sp-chip-dot" style={{ background: color }} />
                  <span className="sp-chip-dot sp-chip-size"
                        style={{ width: Math.min(18, activeWidth + 4), height: Math.min(18, activeWidth + 4) }} />
                </button>
                {undoRedo}
                <button type="button"
                        className="sp-tool"
                        onClick={() => setSheetOpen('more')}
                        aria-label="More sketch options">⋯</button>
              </div>
              <div className="sp-bar-end">
                {commitBtn}
                {/* Leaving without committing must never be buried in a menu —
                    there is no Escape key on a touch device. */}
                <button type="button"
                        className="sp-x"
                        onClick={async () => { if (await confirmDiscard()) onClose?.(); }}
                        aria-label="Close">
                  <Icon as={X} size={16} />
                </button>
              </div>
            </>
          ) : (
            <>
              {toolButtons}
              <span className="sp-sep" />
              {swatches}
              <span className="sp-sep" />
              {widths}
              {canPickAspect && (
                <>
                  <span className="sp-sep" />
                  <div className="sp-aspects">{aspectButtons}</div>
                </>
              )}
              <span className="sp-sep" />
              {undoRedo}
              {clearBtn}
              <span style={{ flex: 1 }} />
              {cancelBtn}
              {commitBtn}
              <button type="button"
                      className="sp-x"
                      onClick={() => onClose?.()}
                      aria-label="Close">
                <Icon as={X} size={14} />
              </button>
            </>
          )}
        </div>
        <div className="sketchpad-frame-body" ref={bodyRef}>
        <div ref={wrapRef}
             className={`sketchpad-surface ${tool === 'eraser' ? 'is-eraser' : ''} ${tool === 'bucket' ? 'is-bucket' : ''}`}
             style={{
               background: padBg,
               aspectRatio: `${logicalW} / ${logicalH}`,
               transform: view.z === 1 && !view.x && !view.y
                 ? undefined
                 : `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
             }}
             onPointerDown={onPointerDown}>
          <svg className="sketchpad-svg" width="100%" height="100%"
               viewBox={`0 0 ${logicalW} ${logicalH}`}
               preserveAspectRatio="none">
            {strokes.map((s, i) => (
              <path key={i}
                    d={toPathD(s)}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={s.width}
                    strokeLinecap="round"
                    strokeLinejoin="round" />
            ))}
            {activeStroke && (
              <path d={toPathD(activeStroke)}
                    fill="none"
                    stroke={activeStroke.color}
                    strokeWidth={activeStroke.width}
                    strokeLinecap="round"
                    strokeLinejoin="round" />
            )}
          </svg>
          {!strokes.length && !activeStroke && (
            <div className="sketchpad-hint">
              {compact
                ? 'Sketch here, then press Add.'
                : 'Sketch freely — your strokes commit to the active board when you press “Add to canvas”.'}
            </div>
          )}
        </div>
        {(view.z !== 1 || view.x || view.y) && (
          <button type="button"
                  className="sp-zoom-reset"
                  onClick={() => setView({ z: 1, x: 0, y: 0 })}>
            {Math.round(view.z * 100)}% · Reset
          </button>
        )}
        </div>
      </div>
      {/* Touch overflow. Everything the compact bar couldn't hold, at full
          finger size. className lifts it above the pad's own portal z-index. */}
      {compact && sheetOpen && (
        <Sheet open
               className="sp-sheet"
               snap="half"
               title={sheetOpen === 'color' ? 'Colour & size' : 'Sketch'}
               onClose={() => setSheetOpen(false)}>
          <div className="sp-sheet-body">
            <div className="sp-sheet-group">
              <div className="sp-sheet-label">Colour</div>
              <div className="sp-sheet-row">{swatches}</div>
            </div>
            <div className="sp-sheet-group">
              <div className="sp-sheet-label">{tool === 'eraser' ? 'Eraser size' : 'Stroke width'}</div>
              <div className="sp-sheet-row">{widths}</div>
            </div>
            {canPickAspect && (
              <div className="sp-sheet-group">
                <div className="sp-sheet-label">Frame</div>
                <div className="sp-sheet-row sp-aspects">{aspectButtons}</div>
              </div>
            )}
            <div className="sp-sheet-group sp-sheet-actions">
              {clearBtn}
              {cancelBtn}
            </div>
          </div>
        </Sheet>
      )}
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

