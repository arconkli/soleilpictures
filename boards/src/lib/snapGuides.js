// Snap / alignment-guide math — extracted from CanvasSurface so the logic is
// unit-testable (?alignqa=1 → window.__soleilAlignTest) and tunable in ONE place.
// Mirrors lib/arrowGeometry.js (ARROW_TUNING): the frozen SNAP_TUNING below is the
// single source of truth and the bare `const`s alias into it to keep call sites
// terse.
//
// All coordinates returned are BOARD / WORLD space (the caller applies pan/zoom).
// Distances in SNAP_TUNING are SCREEN px and are divided by `zoom` at the use
// site so the catch radius / proximity window FEEL constant regardless of zoom.
//
// Two complaints drove this module:
//   1. Guides for cards that have nothing to do with the dragged card.
//   2. A swarm of lines when dragging a card WAY across the board.
// Both come from the old code considering every card on the board, every frame,
// with a zoom-inflated catch radius. The fixes here: a viewport gate at build
// time + a live PROXIMITY gate per frame (only cards near where the card IS),
// near-collinear dedup, and a nearest-card tie-break.

export const SNAP_TUNING = Object.freeze({
  SNAP_PX: 6,                  // edge/center/size catch radius (÷zoom → world px)
  // NOTE: the four knobs below ship INERT in this commit (extraction must be
  // behavior-identical); a follow-up flips them to the live values in comments.
  VIEWPORT_MARGIN_PX: Infinity, // → 200. Expand the viewport rect by this (screen
                                //   px) to form the candidate pool at drag start.
  PROXIMITY_PX: Infinity,       // → 400. Per-frame: drop candidates whose card is
                                //   farther than this from the LIVE dragged bbox.
  COLLINEAR_EPS_PX: 0,          // → 1. Merge targets whose coord differs by < this
                                //   so near-identical lines don't flicker/jump.
  TIE_EPS_PX: 0,                // → 0.5. Snap-distance ties → prefer nearest card.
  OVERLAP_MIN: 8,              // min cross-axis overlap for an equal-spacing pair
  SPACING_MIN: 4,             // min gap for an equal-spacing candidate
  SPACING_MAX: 1500,          // max gap for an equal-spacing candidate
  LINGER_MS: 160,             // → 90. Fade-out linger after guides clear.
  FAST_MOVE_PX: Infinity,     // → 50. Per-frame move above which guides clear now.
  SIZE_GUIDE: 'underline',    // → 'caliper'. Resize same-size indicator style.
});

const SNAP_PX = SNAP_TUNING.SNAP_PX;
const OVERLAP_MIN = SNAP_TUNING.OVERLAP_MIN;
const SPACING_MIN = SNAP_TUNING.SPACING_MIN;
const SPACING_MAX = SNAP_TUNING.SPACING_MAX;

// ── small geometry helpers ────────────────────────────────────────────────

// World-space rectangle of the visible canvas, expanded by `marginPx` SCREEN px.
// Derived as the inverse of CanvasSurface.clientToCanvas:
//   canvas.x = (clientX - rect.left - pan.x) / zoom
// so the container's left edge (clientX = rect.left) maps to (-pan.x)/zoom, and
// the right edge (clientX = rect.left + width) maps to (width - pan.x)/zoom.
export function worldViewportRect(size, pan, zoom, marginPx) {
  const m = (marginPx || 0) / zoom; // Infinity/zoom = Infinity → gate passes all
  return {
    x0: (0 - pan.x) / zoom - m,
    y0: (0 - pan.y) / zoom - m,
    x1: (size.width - pan.x) / zoom + m,
    y1: (size.height - pan.y) / zoom + m,
  };
}

const cardRect = (c) => ({ x: c.x, y: c.y, w: c.w, h: c.h });

function rectsIntersect(r, v) {
  return r.x <= v.x1 && r.x + r.w >= v.x0 && r.y <= v.y1 && r.y + r.h >= v.y0;
}

// Shortest gap between two rects (0 when they overlap).
function rectGap(a, b) {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

function rectCenterDist(r, bbox) {
  const bcx = bbox.x + bbox.w / 2, bcy = bbox.y + bbox.h / 2;
  return Math.hypot(r.x + r.w / 2 - bcx, r.y + r.h / 2 - bcy);
}

// A candidate passes the proximity gate if ANY of its source cards is within
// `proxWorld` of the live dragged/resized bbox (Infinity → always passes).
function nearAny(rects, bbox, proxWorld) {
  if (!isFinite(proxWorld)) return true;
  for (const r of rects) if (rectGap(r, bbox) <= proxWorld) return true;
  return false;
}
function nearestGap(rects, bbox) {
  let best = Infinity;
  for (const r of rects) best = Math.min(best, rectCenterDist(r, bbox));
  return best;
}

// Collapse targets whose coordinate is within `epsWorld`, unioning their
// perpendicular bounds and keeping every contributing card rect (for the
// proximity gate). First-seen order is preserved so snap-distance ties resolve
// exactly as the pre-extraction code did (eps 0 → merge only bit-equal coords).
function dedupeTargets(raw, epsWorld) {
  const byKey = new Map();
  const order = [];
  const keyOf = (c) => (epsWorld > 0 ? Math.round(c / epsWorld) : c);
  for (const t of raw) {
    const k = keyOf(t.coord);
    let e = byKey.get(k);
    if (!e) { e = { coord: t.coord, lo: t.lo, hi: t.hi, rects: [t.rect] }; byKey.set(k, e); order.push(e); }
    else { e.lo = Math.min(e.lo, t.lo); e.hi = Math.max(e.hi, t.hi); e.rects.push(t.rect); }
  }
  return order;
}

// ── move-drag snap ────────────────────────────────────────────────────────

// Build the snap-target pool ONCE at drag start. `viewport` (from
// worldViewportRect) gates which cards are even candidates — far-off-board cards
// never enter the pool, which is what kills the cross-board swarm. The expensive
// O(N²) equal-spacing pair scan is therefore bounded to on-screen-ish cards.
export function buildSnapTargets({ cards, dragSet, viewport, zoom, tuning = SNAP_TUNING }) {
  const eps = (tuning.COLLINEAR_EPS_PX || 0) / zoom;
  const others = [];
  const rawX = []; // { coord, lo, hi, rect } — lo/hi are the perpendicular (y) span
  const rawY = [];
  for (const card of cards) {
    if (dragSet.has(card.id)) continue;
    const r = cardRect(card);
    if (!rectsIntersect(r, viewport)) continue;
    others.push(card);
    const lo = card.y, hi = card.y + card.h;
    rawX.push({ coord: card.x, lo, hi, rect: r });
    rawX.push({ coord: card.x + card.w, lo, hi, rect: r });
    rawX.push({ coord: card.x + card.w / 2, lo, hi, rect: r });
    const xlo = card.x, xhi = card.x + card.w;
    rawY.push({ coord: card.y, lo: xlo, hi: xhi, rect: r });
    rawY.push({ coord: card.y + card.h, lo: xlo, hi: xhi, rect: r });
    rawY.push({ coord: card.y + card.h / 2, lo: xlo, hi: xhi, rect: r });
  }
  const targetsX = dedupeTargets(rawX, eps);
  const targetsY = dedupeTargets(rawY, eps);

  // Equal-spacing candidates — any pair of pool cards that share a row (vertical
  // overlap) or column (horizontal overlap) with a positive gap propose
  // extending that gap on either side, so dragging into an existing rhythm
  // ("each card 24px apart") snaps cleanly. Each candidate carries the pair's
  // bounding rect for the per-frame proximity gate.
  const xSpacingCands = [];
  const ySpacingCands = [];
  const pairRect = (a, b) => ({
    x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
    w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x),
    h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y),
  });
  for (let i = 0; i < others.length; i++) {
    for (let j = i + 1; j < others.length; j++) {
      const a = others[i], b = others[j];
      const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (yOverlap > OVERLAP_MIN) {
        const left  = a.x + a.w < b.x ? a : (b.x + b.w < a.x ? b : null);
        const right = left === a ? b : (left === b ? a : null);
        if (left && right) {
          const gap = right.x - (left.x + left.w);
          if (gap >= SPACING_MIN && gap <= SPACING_MAX) {
            const cross = (Math.max(left.y, right.y) + Math.min(left.y + left.h, right.y + right.h)) / 2;
            const rect = pairRect(left, right);
            xSpacingCands.push({ targetX: right.x + right.w + gap, edgeIs: 'left',  gap, paired: { a: right.x + right.w, b: right.x + right.w + gap, cross }, rect });
            xSpacingCands.push({ targetX: left.x - gap,             edgeIs: 'right', gap, paired: { a: left.x - gap, b: left.x, cross }, rect });
          }
        }
      }
      const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      if (xOverlap > OVERLAP_MIN) {
        const top    = a.y + a.h < b.y ? a : (b.y + b.h < a.y ? b : null);
        const bottom = top === a ? b : (top === b ? a : null);
        if (top && bottom) {
          const gap = bottom.y - (top.y + top.h);
          if (gap >= SPACING_MIN && gap <= SPACING_MAX) {
            const cross = (Math.max(top.x, bottom.x) + Math.min(top.x + top.w, bottom.x + bottom.w)) / 2;
            const rect = pairRect(top, bottom);
            ySpacingCands.push({ targetY: bottom.y + bottom.h + gap, edgeIs: 'top',    gap, paired: { a: bottom.y + bottom.h, b: bottom.y + bottom.h + gap, cross }, rect });
            ySpacingCands.push({ targetY: top.y - gap,                edgeIs: 'bottom', gap, paired: { a: top.y - gap, b: top.y, cross }, rect });
          }
        }
      }
    }
  }
  return { targetsX, targetsY, xSpacingCands, ySpacingCands };
}

// Per-frame snap solve. PURE: every input is explicit so the QA bridge can drive
// it. Returns { dx, dy, hints } where hints matches the SVG renderer's shape:
//   { xs:[{x,y0,y1,label?}], ys:[{y,x0,x1,label?}], spacings:[{axis,a,b,cross,gap}], sizes:[] }
export function computeSnap(rawDx, rawDy, { targets, dragBBoxStart, zoom, tuning = SNAP_TUNING }) {
  const thresh = tuning.SNAP_PX / zoom;
  const prox = isFinite(tuning.PROXIMITY_PX) ? tuning.PROXIMITY_PX / zoom : Infinity;
  const tie = (tuning.TIE_EPS_PX || 0) / zoom;
  const left   = dragBBoxStart.minX + rawDx;
  const right  = dragBBoxStart.maxX + rawDx;
  const top    = dragBBoxStart.minY + rawDy;
  const bottom = dragBBoxStart.maxY + rawDy;
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const bbox = { x: left, y: top, w: right - left, h: bottom - top };

  // Closest edge/center target per axis, with a nearest-card tie-break.
  let bestX = null, bestXDist = thresh + 0.001, bestXTarget = null;
  let bestY = null, bestYDist = thresh + 0.001, bestYTarget = null;
  const consider = (t, edges, getBest, setBest) => {
    if (!nearAny(t.rects, bbox, prox)) return;
    for (const edgeVal of edges) {
      const adjust = t.coord - edgeVal;
      const d = Math.abs(adjust);
      const { dist, target } = getBest();
      if (d < dist - tie) setBest(d, adjust, t);
      else if (tie > 0 && d < dist + tie && target && nearestGap(t.rects, bbox) < nearestGap(target.rects, bbox)) {
        setBest(Math.min(d, dist), adjust, t);
      }
    }
  };
  for (const t of targets.targetsX) {
    consider(t, [left, right, cx],
      () => ({ dist: bestXDist, target: bestXTarget }),
      (d, adj, tt) => { bestXDist = d; bestX = adj; bestXTarget = tt; });
  }
  for (const t of targets.targetsY) {
    consider(t, [top, bottom, cy],
      () => ({ dist: bestYDist, target: bestYTarget }),
      (d, adj, tt) => { bestYDist = d; bestY = adj; bestYTarget = tt; });
  }

  // Equal-spacing candidates, evaluated after edges; the tighter of the two wins
  // each axis for the snap DELTA, but a matched spacing always records its marker.
  let bestSpaceX = null, bestSpaceXDist = thresh + 0.001, bestSpaceXMeta = null;
  for (const cand of targets.xSpacingCands) {
    if (!nearAny([cand.rect], bbox, prox)) continue;
    const adjust = cand.targetX - (cand.edgeIs === 'left' ? left : right);
    const d = Math.abs(adjust);
    if (d < bestSpaceXDist) { bestSpaceXDist = d; bestSpaceX = adjust; bestSpaceXMeta = cand; }
  }
  let bestSpaceY = null, bestSpaceYDist = thresh + 0.001, bestSpaceYMeta = null;
  for (const cand of targets.ySpacingCands) {
    if (!nearAny([cand.rect], bbox, prox)) continue;
    const adjust = cand.targetY - (cand.edgeIs === 'top' ? top : bottom);
    const d = Math.abs(adjust);
    if (d < bestSpaceYDist) { bestSpaceYDist = d; bestSpaceY = adjust; bestSpaceYMeta = cand; }
  }
  if (bestSpaceX !== null && bestSpaceXDist < bestXDist) { bestX = bestSpaceX; bestXTarget = null; }
  if (bestSpaceY !== null && bestSpaceYDist < bestYDist) { bestY = bestSpaceY; bestYTarget = null; }

  const newBBox = {
    x0: left + (bestX ?? 0), x1: right + (bestX ?? 0),
    y0: top + (bestY ?? 0),  y1: bottom + (bestY ?? 0),
  };
  const xs = [];
  const ys = [];
  const spacings = [];
  if (bestXTarget) {
    xs.push({ x: bestXTarget.coord, y0: Math.min(bestXTarget.lo, newBBox.y0), y1: Math.max(bestXTarget.hi, newBBox.y1) });
  }
  if (bestYTarget) {
    ys.push({ y: bestYTarget.coord, x0: Math.min(bestYTarget.lo, newBBox.x0), x1: Math.max(bestYTarget.hi, newBBox.x1) });
  }
  if (bestSpaceXMeta && bestSpaceXDist < thresh + 0.001) {
    spacings.push({ axis: 'x', a: bestSpaceXMeta.paired.a, b: bestSpaceXMeta.paired.b, cross: bestSpaceXMeta.paired.cross, gap: Math.round(bestSpaceXMeta.gap) });
  }
  if (bestSpaceYMeta && bestSpaceYDist < thresh + 0.001) {
    spacings.push({ axis: 'y', a: bestSpaceYMeta.paired.a, b: bestSpaceYMeta.paired.b, cross: bestSpaceYMeta.paired.cross, gap: Math.round(bestSpaceYMeta.gap) });
  }
  return {
    dx: rawDx + (bestX ?? 0),
    dy: rawDy + (bestY ?? 0),
    hints: (xs.length || ys.length || spacings.length) ? { xs, ys, spacings, sizes: [] } : null,
  };
}

// ── resize snap ───────────────────────────────────────────────────────────

// Build resize-snap targets once at drag start. Two flavours per axis: a numeric
// match (dragged w/h equals another card's w/h — the "same size as that card"
// case) and an edge landing (dragged right/bottom edge lands on another card's
// edge). Viewport-gated like the move targets.
export function buildResizeTargets({ cards, selfId, viewport, zoom, tuning = SNAP_TUNING }) {
  const wCands = []; // { value, owner, rect }
  const hCands = [];
  const rightEdgeXs = []; // { x, y0, y1, rect }
  const bottomEdgeYs = [];
  for (const other of cards) {
    if (other.id === selfId) continue;
    const r = cardRect(other);
    if (!rectsIntersect(r, viewport)) continue;
    wCands.push({ value: other.w, owner: other, rect: r });
    hCands.push({ value: other.h, owner: other, rect: r });
    rightEdgeXs.push({ x: other.x,           y0: other.y, y1: other.y + other.h, rect: r });
    rightEdgeXs.push({ x: other.x + other.w, y0: other.y, y1: other.y + other.h, rect: r });
    bottomEdgeYs.push({ y: other.y,           x0: other.x, x1: other.x + other.w, rect: r });
    bottomEdgeYs.push({ y: other.y + other.h, x0: other.x, x1: other.x + other.w, rect: r });
  }
  return { wCands, hCands, rightEdgeXs, bottomEdgeYs };
}

// Per-frame resize solve. `card` is the card being resized (its ORIGINAL x/y/w/h).
// `skip` disables all snapping; `skipH` disables height snap (note reflow owns h).
export function computeResizeSnap(rawDw, rawDh, { card: c, targets, skip, skipH, zoom, tuning = SNAP_TUNING }) {
  if (skip) return { dw: rawDw, dh: rawDh, hints: null };
  const thresh = tuning.SNAP_PX / zoom;
  const prox = isFinite(tuning.PROXIMITY_PX) ? tuning.PROXIMITY_PX / zoom : Infinity;
  const candW = c.w + rawDw;
  const candH = c.h + rawDh;
  const candRight = c.x + c.w + rawDw;
  const candBottom = c.y + c.h + rawDh;
  const selfRect = { x: c.x, y: c.y, w: Math.max(1, candW), h: Math.max(1, candH) };

  let bestDwAdj = null, bestDwDist = thresh + 0.001, bestWMatch = null;
  let bestDhAdj = null, bestDhDist = thresh + 0.001, bestHMatch = null;
  for (const wc of targets.wCands) {
    if (rectGap(wc.rect, selfRect) > prox) continue;
    const adjust = wc.value - candW;
    const d = Math.abs(adjust);
    if (d < bestDwDist) { bestDwDist = d; bestDwAdj = adjust; bestWMatch = { kind: 'numeric', owner: wc.owner }; }
  }
  for (const re of targets.rightEdgeXs) {
    if (rectGap(re.rect, selfRect) > prox) continue;
    const adjust = re.x - candRight;
    const d = Math.abs(adjust);
    if (d < bestDwDist) { bestDwDist = d; bestDwAdj = adjust; bestWMatch = { kind: 'edge', target: re }; }
  }
  for (const hc of (skipH ? [] : targets.hCands)) {
    if (rectGap(hc.rect, selfRect) > prox) continue;
    const adjust = hc.value - candH;
    const d = Math.abs(adjust);
    if (d < bestDhDist) { bestDhDist = d; bestDhAdj = adjust; bestHMatch = { kind: 'numeric', owner: hc.owner }; }
  }
  for (const be of (skipH ? [] : targets.bottomEdgeYs)) {
    if (rectGap(be.rect, selfRect) > prox) continue;
    const adjust = be.y - candBottom;
    const d = Math.abs(adjust);
    if (d < bestDhDist) { bestDhDist = d; bestDhAdj = adjust; bestHMatch = { kind: 'edge', target: be }; }
  }
  const dw = rawDw + (bestDwAdj ?? 0);
  const dh = rawDh + (bestDhAdj ?? 0);

  const xs = [];
  const ys = [];
  const sizes = [];
  const caliper = tuning.SIZE_GUIDE === 'caliper';
  const off = 6 / zoom;
  if (bestWMatch?.kind === 'edge') {
    const t = bestWMatch.target;
    xs.push({ x: t.x, y0: Math.min(t.y0, c.y), y1: Math.max(t.y1, c.y + c.h + dh) });
  } else if (bestWMatch?.kind === 'numeric') {
    const o = bestWMatch.owner;
    if (caliper) {
      // Same-WIDTH: a matching horizontal caliper bar UNDER both cards so it
      // reads as "these two are the same size", not just a number on one card.
      sizes.push({ axis: 'w', value: Math.round(o.w), bars: [
        { a: c.x, b: c.x + candW, cross: c.y + candH + off },
        { a: o.x, b: o.x + o.w,   cross: o.y + o.h + off },
      ] });
    } else {
      ys.push({ y: o.y + o.h + off, x0: o.x, x1: o.x + o.w, label: String(o.w) });
    }
  }
  if (bestHMatch?.kind === 'edge') {
    const t = bestHMatch.target;
    ys.push({ y: t.y, x0: Math.min(t.x0, c.x), x1: Math.max(t.x1, c.x + c.w + dw) });
  } else if (bestHMatch?.kind === 'numeric') {
    const o = bestHMatch.owner;
    if (caliper) {
      // Same-HEIGHT: a vertical caliper bar to the RIGHT of both cards.
      sizes.push({ axis: 'h', value: Math.round(o.h), bars: [
        { a: c.y, b: c.y + candH, cross: c.x + candW + off },
        { a: o.y, b: o.y + o.h,   cross: o.x + o.w + off },
      ] });
    } else {
      xs.push({ x: o.x + o.w + off, y0: o.y, y1: o.y + o.h, label: String(o.h) });
    }
  }
  const hints = (xs.length || ys.length || sizes.length) ? { xs, ys, spacings: [], sizes } : null;
  return { dw, dh, hints };
}
