// The freehand-stroke data contract, in one place.
//
// A stroke is a plain JSON object stored in three different homes — the board's
// `strokes` Y.Array, an art card's card-local `strokes`, and the SketchPad's
// session state — but it is ALWAYS the same shape:
//
//   { color, width, points: [[x, y, p?], …], brush? }
//
// The third element of a point is pen pressure in 0..1. It is OPTIONAL, and its
// absence is the normal case: every stroke drawn before pressure support, and
// every stroke drawn with a mouse or a finger, is a plain [x, y] pair. Readers
// must therefore never index blindly into point[2] — go through pointPressure().
//
// `brush` is likewise optional and defaults to 'pen'. Together these two rules
// mean every stroke ever written by an older build keeps rendering exactly as it
// did, with no migration and no version field.
//
// Coordinate space is the caller's business: board strokes are in board/world
// coords, card strokes are in card-local coords. Nothing here cares.

export const DEFAULT_STROKE_COLOR = '#f5f5f6';
export const DEFAULT_STROKE_WIDTH = 3;
export const DEFAULT_BRUSH = 'pen';

// Brush parameter sets. These are consumed by strokeRender.js; keeping them as
// data (rather than branches in the renderer) is what lets the SVG and Canvas2D
// paths stay in agreement — both read the same numbers.
//
//   thinning   how strongly pressure drives width (0 = constant width)
//   smoothing  corner rounding on the generated outline
//   streamline how much input jitter is damped before outlining
//   opacity    multiplied into the stroke's own color
//   cap        line cap for the constant-width fast path
//
// There is deliberately NO blend mode. The highlighter wanted `multiply`, and
// it is the one property the two renderers cannot agree on: SVG's
// mix-blend-mode is confined by the stroke layer's own stacking context and
// blends against transparency, while Canvas2D's globalCompositeOperation
// composites against whatever is already painted. Over a white card they
// happen to match; over an image the live canvas gives rgb(153,163,124) and the
// thumbnail rgb(90,129,124) for the same stroke. A board whose preview doesn't
// match itself is exactly what this module exists to prevent, so the
// highlighter is wide and translucent and nothing more.
export const BRUSHES = {
  pen:         { thinning: 0.55, smoothing: 0.5,  streamline: 0.42, opacity: 1,    cap: 'round' },
  marker:      { thinning: 0,    smoothing: 0.42, streamline: 0.36, opacity: 0.92, cap: 'butt'  },
  highlighter: { thinning: 0,    smoothing: 0.3,  streamline: 0.3,  opacity: 0.38, cap: 'butt'  },
  pencil:      { thinning: 0.25, smoothing: 0.6,  streamline: 0.5,  opacity: 0.85, cap: 'round' },
};

export function brushParams(stroke) {
  return BRUSHES[stroke?.brush] || BRUSHES[DEFAULT_BRUSH];
}

export function strokeColor(stroke) {
  return stroke?.color || DEFAULT_STROKE_COLOR;
}

export function strokeWidth(stroke) {
  const w = stroke?.width;
  return typeof w === 'number' && w > 0 ? w : DEFAULT_STROKE_WIDTH;
}

// Pressure for a single point. A 2-tuple (every legacy stroke, every mouse and
// finger stroke) reads as full pressure, which is what makes the constant-width
// fast path in strokeRender byte-identical to the pre-pressure renderer.
export function pointPressure(pt) {
  return (pt && pt.length > 2 && typeof pt[2] === 'number') ? pt[2] : 1;
}

// True when this stroke actually carries pressure samples. Deliberately a
// presence test, not a variance test: if the input device reported pressure we
// honour it even when the user drew at a dead-constant force. Mouse and finger
// input records no third element at all, so it lands on the fast path.
export function hasPressure(stroke) {
  const pts = stroke?.points;
  if (!Array.isArray(pts)) return false;
  for (const p of pts) {
    if (p && p.length > 2 && typeof p[2] === 'number') return true;
  }
  return false;
}

// A stroke renders through the cheap constant-width polyline path when it has no
// pressure samples AND its brush doesn't vary width. Everything else needs a
// filled outline. This predicate is the single switch both renderers consult.
export function isConstantWidth(stroke) {
  if (hasPressure(stroke)) return brushParams(stroke).thinning === 0;
  return true;
}

// ── Layers ────────────────────────────────────────────────────────────────
// An art card may carry `layers: [{ id, name, visible, opacity, strokes }]`.
// When it does, `layers` is authoritative and `card.strokes` is ignored. When it
// doesn't, the flat `card.strokes` array reads as one implicit visible layer.
//
// A card with `layers` MUST hold an empty `strokes`. Keeping a flattened mirror
// alongside would be derived data inside a CRDT: two people drawing on
// different layers each rewrite the whole mirror, last-write-wins picks one, and
// it silently stops matching the merged `layers` that everything actually
// renders from. Appending to card.strokes on a layered card is the same bug
// seen from the other side — see appendStrokeToCard.
//
// EVERY consumer that just wants "the strokes to draw for this card" goes
// through readCardStrokes(), so adding layers never required teaching the
// thumbnail renderer, the public board view or the preview worker about them.

export function cardLayers(card) {
  const layers = card?.layers;
  if (Array.isArray(layers) && layers.length) return layers;
  return [{
    id: 'base',
    name: 'Layer 1',
    visible: true,
    opacity: 1,
    strokes: Array.isArray(card?.strokes) ? card.strokes : [],
  }];
}

// Flattened, bottom-to-top, hidden layers dropped. A layer opacity below 1 is
// folded into each stroke as a `layerOpacity` field the renderers multiply in —
// this keeps the return value a plain stroke array, so callers stay simple.
export function readCardStrokes(card) {
  const layers = card?.layers;
  if (!Array.isArray(layers) || !layers.length) {
    return Array.isArray(card?.strokes) ? card.strokes : [];
  }
  const out = [];
  for (const layer of layers) {
    if (!layer || layer.visible === false) continue;
    const strokes = Array.isArray(layer.strokes) ? layer.strokes : [];
    const lo = typeof layer.opacity === 'number' ? layer.opacity : 1;
    for (const s of strokes) {
      if (!s) continue;
      out.push(lo === 1 ? s : { ...s, layerOpacity: lo });
    }
  }
  return out;
}

// ── Writing to a card ─────────────────────────────────────────────────────
// Both helpers return a PATCH for updateCard rather than mutating, and both
// exist because `layers` takes precedence over `strokes` when it is present:
// appending to `card.strokes` on a layered card writes somewhere no reader
// looks, so the stroke would land in the Y.Doc and never appear.

// Append one stroke to a card, landing it on the topmost VISIBLE layer — the
// one whose ink is on top is the one you are drawing onto.
export function appendStrokeToCard(card, stroke) {
  const layers = card?.layers;
  if (!Array.isArray(layers) || !layers.length) {
    const existing = Array.isArray(card?.strokes) ? card.strokes : [];
    return { strokes: [...existing, stroke] };
  }
  let target = -1;
  for (let i = layers.length - 1; i >= 0; i--) {
    if (layers[i] && layers[i].visible !== false) { target = i; break; }
  }
  // Every layer hidden: fall back to the top of the stack rather than dropping
  // the stroke on the floor.
  if (target < 0) target = layers.length - 1;
  const next = layers.map((l, i) => (i === target
    ? { ...l, strokes: [...(l.strokes || []), stroke] }
    : l));
  return { layers: next };
}

// Apply an eraser swipe to a card. Erases across every visible layer, since the
// user is rubbing out what they can see.
export function eraseOnCard(card, eraserPoints, radius) {
  const layers = card?.layers;
  if (!Array.isArray(layers) || !layers.length) {
    const { next, changed } = eraseStrokes(card?.strokes, eraserPoints, radius);
    return { changed, patch: changed ? { strokes: next } : null };
  }
  let changed = false;
  const next = layers.map((l) => {
    if (!l || l.visible === false) return l;
    const r = eraseStrokes(l.strokes, eraserPoints, radius);
    if (!r.changed) return l;
    changed = true;
    return { ...l, strokes: r.next };
  });
  return { changed, patch: changed ? { layers: next } : null };
}

// ── Geometry helpers ──────────────────────────────────────────────────────

export function distPointToSegment(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2)) : 0;
  const px = a.x + t * vx;
  const py = a.y + t * vy;
  return Math.hypot(p.x - px, p.y - py);
}

export function distPointToPolyline(p, points = []) {
  if (points.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    best = Math.min(best, distPointToSegment(
      p,
      { x: points[i - 1][0], y: points[i - 1][1] },
      { x: points[i][0], y: points[i][1] },
    ));
  }
  return best;
}

// Erasing SPLITS a stroke rather than deleting it: the source is resampled to
// ≤6px spacing, points within `radius` of the eraser polyline are dropped, and
// each surviving run of ≥2 points becomes its own stroke carrying the original
// color/width/brush. Returns [stroke] unchanged when there's nothing to do.
//
// Both drawing surfaces share this — the SketchPad used to delete whole strokes
// on contact, which meant the same gesture did two different things depending on
// which surface you were on.
export function splitStrokeByEraser(stroke, eraserPoints, radius) {
  const sourcePoints = stroke?.points || [];
  const points = [];
  for (let i = 0; i < sourcePoints.length; i++) {
    const point = sourcePoints[i];
    if (i === 0) {
      points.push(point);
      continue;
    }
    const prev = sourcePoints[i - 1];
    const dist = Math.hypot(point[0] - prev[0], point[1] - prev[1]);
    const steps = Math.max(1, Math.ceil(dist / 6));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      // Interpolate pressure alongside position so an erased-through stroke
      // keeps its taper on both surviving halves.
      const pr = prev.length > 2 || point.length > 2
        ? [Math.round((pointPressure(prev) + (pointPressure(point) - pointPressure(prev)) * t) * 1000) / 1000]
        : [];
      points.push([
        Math.round((prev[0] + (point[0] - prev[0]) * t) * 10) / 10,
        Math.round((prev[1] + (point[1] - prev[1]) * t) * 10) / 10,
        ...pr,
      ]);
    }
  }
  if (points.length < 2 || eraserPoints.length < 2) return [stroke];
  const pieces = [];
  let current = [];
  let removed = 0;
  const keepPoint = ([x, y]) => distPointToPolyline({ x, y }, eraserPoints) > radius;

  for (const point of points) {
    if (keepPoint(point)) {
      current.push(point);
      continue;
    }
    removed++;
    if (current.length > 1) pieces.push({ ...stroke, points: current });
    current = [];
  }
  if (current.length > 1) pieces.push({ ...stroke, points: current });
  // Nothing was cut: hand back the ORIGINAL object, not the resampled rebuild.
  // Otherwise every swipe that missed would still replace the stroke with a
  // denser copy of itself — permanently growing the point count of every stroke
  // near an eraser gesture, and making a miss indistinguishable from a hit.
  if (removed === 0) return [stroke];
  return pieces;
}

// Apply an eraser swipe across a whole surface's strokes.
//
// Strokes the swipe never touched are passed through BY IDENTITY, so a miss is
// a true no-op — nothing to persist, nothing to undo, and the React memos
// downstream keep their cache. splitStrokeByEraser guarantees the identity for
// us by returning the original object when it removed nothing.
//
// The bounds check in front is a cheap reject, not a correctness test: a swipe
// in one corner of a busy board shouldn't pay to resample every stroke in the
// other corner just to discover it missed.
export function eraseStrokes(strokes, eraserPoints, radius) {
  const list = Array.isArray(strokes) ? strokes : [];
  if (!list.length || !Array.isArray(eraserPoints) || eraserPoints.length < 2) {
    return { next: list, changed: false };
  }
  let eMinX = Infinity, eMinY = Infinity, eMaxX = -Infinity, eMaxY = -Infinity;
  for (const [x, y] of eraserPoints) {
    if (x < eMinX) eMinX = x;
    if (y < eMinY) eMinY = y;
    if (x > eMaxX) eMaxX = x;
    if (y > eMaxY) eMaxY = y;
  }
  const next = [];
  let changed = false;
  for (const s of list) {
    const b = strokeBounds(s);
    const pad = radius + strokeWidth(s) / 2;
    if (!b || b.maxX + pad < eMinX || b.minX - pad > eMaxX
           || b.maxY + pad < eMinY || b.minY - pad > eMaxY) {
      next.push(s);
      continue;
    }
    const pieces = splitStrokeByEraser(s, eraserPoints, radius);
    if (pieces.length === 1 && pieces[0] === s) { next.push(s); continue; }
    changed = true;
    next.push(...pieces);
  }
  return { next, changed };
}

// Axis-aligned bounds of a stroke's centreline. Callers that need the PAINTED
// bounds should pad by half the stroke width themselves (the board layer's
// strokeGeom memo already does).
export function strokeBounds(stroke) {
  const pts = stroke?.points || [];
  if (!pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

// True when any point of `stroke` falls inside the closed polygon `poly`
// ([[x,y], …]), by the even-odd ray-cast rule. Used by the lasso.
export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// A stroke is lassoed when the MAJORITY of its points fall inside the polygon.
// The same majority rule the draw tool uses to decide whether a stroke belongs
// to an art card (pickStrokeTarget), so "mostly inside" means the same thing in
// both places.
export function strokeInPolygon(stroke, poly) {
  const pts = stroke?.points || [];
  if (pts.length === 0 || poly.length < 3) return false;
  let n = 0;
  for (const [x, y] of pts) if (pointInPolygon(x, y, poly)) n++;
  return n > pts.length / 2;
}
