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
import { X } from '../lib/icons.js';
import { Icon } from './Icon.jsx';
import { ColorPicker } from './ColorPicker.jsx';
import { addRecentColor } from '../lib/recentColors.js';
import { useRecentColors } from '../hooks/useRecentColors.js';

// Default pen stroke + bucket fill colors. The pad SURFACE defaults to
// pure white — when the user commits, the surrounding ArtCanvasCard
// adopts whatever bg the user painted (white if untouched).
const DEFAULT_COLOR = '#0a0a0c';
const DEFAULT_BG = '#ffffff';
const DEFAULT_WIDTH = 3;
const COLOR_PRESETS = ['#0a0a0c', '#f5f5f6', '#d4a04a', '#cf6a4f', '#7c5cc9', '#3fa39a', '#5b8fc7', '#10b981'];
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

  // Reset on open. Escape to close (unsaved strokes prompt). When the
  // pad opens to edit an existing art canvas, seed it with that card's
  // strokes (already in card-local coords, which we treat as pad coords)
  // and bg color so the user sees their drawing exactly as it sits on
  // the board, ready to keep working on.
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
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // If there are strokes, ask before discarding.
        if (strokes.length > 0) {
          const ok = window.confirm('Discard sketch?');
          if (!ok) return;
        }
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    if (!wrapRef.current) return;
    const { x, y } = toLogical(e.clientX, e.clientY);
    if (tool === 'bucket') {
      // Round 1 of paint bucket: click anywhere to set the WHOLE pad bg.
      // True region-fill (Canvas2D flood fill against rasterized strokes)
      // is a follow-up. The single-bg approach matches what the user gets
      // in most graphic tools when they bucket-click empty space.
      setPadBg(color);
      addRecentColor(color);
      return;
    }
    if (tool === 'eraser') {
      // Drop any stroke under the click. Cheap point-in-bbox test
      // followed by stroke-distance for accuracy.
      const HIT = Math.max(width + 6, 12);
      setStrokes(prev => prev.filter(s => !pointNearStroke(s, x, y, HIT)));
      return;
    }
    setActive({ color, width, points: [[x, y]] });
    e.target.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!wrapRef.current) return;
    if (tool === 'eraser') {
      if (e.buttons !== 1) return;
      const { x, y } = toLogical(e.clientX, e.clientY);
      const HIT = Math.max(width + 6, 12);
      setStrokes(prev => prev.filter(s => !pointNearStroke(s, x, y, HIT)));
      return;
    }
    if (!activeStroke) return;
    const { x, y } = toLogical(e.clientX, e.clientY);
    setActive(s => s ? { ...s, points: [...s.points, [x, y]] } : s);
  };

  const onPointerUp = () => {
    if (activeStroke && activeStroke.points?.length > 1) {
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
    <div className="sketchpad-bg">
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
                  className="sp-action"
                  onClick={() => setStrokes([])}
                  disabled={!strokes.length}>Clear</button>
          <span style={{ flex: 1 }} />
          <button type="button"
                  className="sp-action"
                  onClick={() => {
                    if (strokes.length && !window.confirm('Discard sketch?')) return;
                    onClose?.();
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
             onPointerUp={onPointerUp}>
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
