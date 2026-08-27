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

import {
  DEFAULT_STROKE_WIDTH,
  brushParams,
  isConstantWidth,
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

export function strokeBlendMode(stroke) {
  return brushParams(stroke).blend;
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

// The `d` attribute for a stroke.
//
// Constant-width strokes stay an OPEN polyline stroked with stroke-width — the
// cheap path, byte-identical to what every build before pressure support
// produced, and still the path every mouse and finger stroke takes.
export function toPathD(stroke) {
  return polylinePathD(stroke?.points);
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
  const blend = strokeBlendMode(stroke);
  if (blend) ctx.globalCompositeOperation = blend;

  ctx.strokeStyle = strokeColor(stroke);
  ctx.lineWidth = Math.max(strokeWidth(stroke) || DEFAULT_STROKE_WIDTH, 1.2 / (ppu || 1));
  ctx.lineCap = strokeLineCap(stroke);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(offX + pts[0][0], offY + pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(offX + pts[i][0], offY + pts[i][1]);
  ctx.stroke();
  ctx.restore();
}

// Paint a whole array of strokes. Skips anything too short to be visible, which
// is the same guard all four original call sites carried.
export function drawStrokes(ctx, strokes, opts) {
  if (!Array.isArray(strokes)) return;
  for (const s of strokes) drawStroke(ctx, s, opts);
}
