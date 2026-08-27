// Stroke → geometry, in ONE place, with an SVG entry point and a Canvas2D one.
//
// This used to be written out four separate times: the board's strokes-layer,
// the per-card CardStrokesOverlay, the SketchPad, and renderThumbnail's Canvas2D
// pass. Four copies of "moveTo, then lineTo every point" is survivable; four
// copies of pressure-tapered outline geometry is not — and any drift between the
// live canvas and the thumbnail renderer shows up as a board whose preview
// doesn't match what the user drew.
//
// So: the live surfaces call toPathD(), the thumbnail/export renderer calls
// drawStroke(), and both resolve width, color and opacity through the same
// helpers in strokeModel.js.

import { getStroke } from 'perfect-freehand';
import {
  DEFAULT_STROKE_WIDTH,
  brushParams,
  hasPressure,
  isConstantWidth,
  pointPressure,
  strokeColor,
  strokeWidth,
} from './strokeModel.js';

// Effective alpha for a stroke: the brush's own opacity times any layer opacity
// folded in by readCardStrokes().
export function strokeOpacity(stroke) {
  const brush = brushParams(stroke).opacity;
  const layer = typeof stroke?.layerOpacity === 'number' ? stroke.layerOpacity : 1;
  return brush * layer;
}

export function strokeLineCap(stroke) {
  return brushParams(stroke).cap;
}

// ── SVG ───────────────────────────────────────────────────────────────────

// Open polyline through every point. One decimal place — enough for sub-pixel
// smoothness at any zoom, and it keeps the path string (which is rebuilt on
// every render of a live stroke) as short as possible.
export function polylinePathD(pts) {
  if (!pts || pts.length === 0) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) d += ` L${pts[i][0].toFixed(1)},${pts[i][1].toFixed(1)}`;
  return d;
}

// The outline of a pressure-varying stroke, as a closed polygon.
//
// perfect-freehand does the hard part: it walks the centreline, offsets
// perpendicular by the pressure-scaled radius at each point, and caps the ends.
// We only feed it the brush's parameters. Both renderers consume THIS, so the
// SVG on screen and the Canvas2D in a thumbnail describe the same shape.
export function outlinePoints(stroke) {
  const pts = stroke?.points || [];
  if (pts.length === 0) return [];
  const brush = brushParams(stroke);
  return getStroke(pts.map(p => [p[0], p[1], pointPressure(p)]), {
    size: strokeWidth(stroke),
    thinning: brush.thinning,
    smoothing: brush.smoothing,
    streamline: brush.streamline,
    // Only invent pressure when the device reported none. Doing it to a real
    // Pencil stroke would fight the hand that drew it.
    simulatePressure: !hasPressure(stroke),
    last: true,
  });
}

function outlinePathD(stroke) {
  const outline = outlinePoints(stroke);
  if (!outline.length) return '';
  // Quadratic segments through the midpoints — the standard way to render a
  // perfect-freehand outline without the polygon reading as faceted.
  let d = `M${outline[0][0].toFixed(2)},${outline[0][1].toFixed(2)}`;
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d += ` Q${x0.toFixed(2)},${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)},${((y0 + y1) / 2).toFixed(2)}`;
  }
  return `${d} Z`;
}

// The `d` attribute for a stroke.
//
// Constant-width strokes stay an OPEN polyline stroked with stroke-width — the
// cheap path, byte-identical to what every build before pressure support
// produced, and still the path every mouse and finger stroke takes. Only a
// stroke that actually carries pressure AND uses a brush that varies with it
// pays for outline geometry.
export function toPathD(stroke) {
  return isConstantWidth(stroke) ? polylinePathD(stroke?.points) : outlinePathD(stroke);
}

// Whether toPathD's output should be painted with `stroke` (open polyline) or
// `fill` (closed outline). Callers set fill/stroke attributes off this.
export function isFilledPath(stroke) {
  return !isConstantWidth(stroke);
}

// ── Canvas2D ──────────────────────────────────────────────────────────────

// Paint one stroke into a 2D context.
//
//   offX/offY  added to every point — card-local strokes are drawn into a
//              board-space context, so they offset by the card's origin.
//   ppu        board pixels per unit, used only to floor the line width so a
//              hairline stroke stays visible at fit-to-content scale.
export function drawStroke(ctx, stroke, { offX = 0, offY = 0, ppu = 1 } = {}) {
  const pts = stroke?.points;
  if (!Array.isArray(pts) || pts.length < 2) return;

  ctx.save();
  const alpha = strokeOpacity(stroke);
  if (alpha !== 1) ctx.globalAlpha = alpha;
  if (isConstantWidth(stroke)) {
    ctx.strokeStyle = strokeColor(stroke);
    ctx.lineWidth = Math.max(strokeWidth(stroke) || DEFAULT_STROKE_WIDTH, 1.2 / (ppu || 1));
    ctx.lineCap = strokeLineCap(stroke);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(offX + pts[0][0], offY + pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(offX + pts[i][0], offY + pts[i][1]);
    ctx.stroke();
  } else {
    // Same outline the live SVG draws, filled rather than stroked. Going
    // through outlinePoints (not the path string) keeps the two in lockstep:
    // a thumbnail that renders a pressure stroke as a flat line would not look
    // like the board it is a picture of.
    const outline = outlinePoints(stroke);
    if (outline.length) {
      ctx.fillStyle = strokeColor(stroke);
      ctx.beginPath();
      ctx.moveTo(offX + outline[0][0], offY + outline[0][1]);
      for (let i = 0; i < outline.length; i++) {
        const [x0, y0] = outline[i];
        const [x1, y1] = outline[(i + 1) % outline.length];
        ctx.quadraticCurveTo(offX + x0, offY + y0, offX + (x0 + x1) / 2, offY + (y0 + y1) / 2);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

// Paint a whole array of strokes. Skips anything too short to be visible, which
// is the same guard all four original call sites carried.
export function drawStrokes(ctx, strokes, opts) {
  if (!Array.isArray(strokes)) return;
  for (const s of strokes) drawStroke(ctx, s, opts);
}
