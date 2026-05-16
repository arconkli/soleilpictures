// Arrow geometry — anchor resolution, cubic-bezier path math, fan-out, and
// arrowhead polygons. Shared between the editor (CanvasSurface) and the
// public read-only viewer so both render the same curves.
//
// Anchor reference forms (legacy + new are both accepted):
//   "cardId"                     legacy bare string  → card lookup
//   { type: 'card',  id }        explicit card
//   { type: 'group', id }        group bounding box (computed from members)
//   { type: 'point', x, y }      free point (no shape)
//   { x, y }                     legacy free point
//   null / undefined             missing
//
// All numeric outputs are in *board-space* coordinates. The caller is
// responsible for any pan/zoom transform.

const PAD_GROUP = 12;                  // mirrors the groups-layer padding
const FAN_T_MIN = 0.12;                // keep arrows off the corners
const FAN_T_MAX = 0.88;
const HANDLE_MIN = 32;                 // cubic bezier control magnitude floor
const HANDLE_MAX = 200;                //   …and ceiling
const HANDLE_K   = 0.42;               //   …× distance between anchors
const OBSTACLE_PAD = 14;               // breathing room around cards (default; overridable per obstacle)
const DEFLECT_ITERS = 12;              // # of repulsion passes (was 4)
const DEFLECT_SAMPLES = 24;            // bezier sample points per deflection pass
const CHECK_SAMPLES = 48;              // higher-resolution sampling for the final clip check
const DEFLECT_BOOST = 2.4;             // over-push so the smoothed curve clears (was 1.6)
// After repulsion, if the bezier still overlaps an obstacle, fall back
// to a 3-segment orthogonal route that's guaranteed not to cross the
// box. The L-shape lives in `buildOrthogonalDetour`. Avoidance is the
// user's stated invariant ("arrows should AVOID all cards at all costs").
const DETOUR_PAD = 28;

// Cubic-bezier point at parameter t.
function bezierPoint(s, c1, c2, e, t) {
  const u = 1 - t;
  return {
    x: u*u*u*s.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*e.x,
    y: u*u*u*s.y + 3*u*u*t*c1.y + 3*u*t*t*c2.y + t*t*t*e.y,
  };
}

// Push the two control points away from any obstacle the curve passes
// through, weighting the push by how close along the curve the conflict
// sits to each control point. Cheap, iterative, and visually plausible —
// doesn't guarantee no overlap in pathological dense layouts.
function deflectControlPoints(s, c1, c2, e, obstacles) {
  if (!obstacles || obstacles.length === 0) return { c1, c2 };
  for (let iter = 0; iter < DEFLECT_ITERS; iter++) {
    let dx1 = 0, dy1 = 0, dx2 = 0, dy2 = 0;
    let hit = false;
    for (let i = 1; i < DEFLECT_SAMPLES; i++) {
      const t = i / DEFLECT_SAMPLES;
      const p = bezierPoint(s, c1, c2, e, t);
      for (const ob of obstacles) {
        const pad = ob.pad != null ? ob.pad : OBSTACLE_PAD;
        const halfW = ob.w / 2 + pad;
        const halfH = ob.h / 2 + pad;
        const cx = ob.x + ob.w / 2, cy = ob.y + ob.h / 2;
        const offX = p.x - cx, offY = p.y - cy;
        if (Math.abs(offX) >= halfW || Math.abs(offY) >= halfH) continue;
        hit = true;
        // Push out through the closer face. If the curve sample is dead-
        // center on the obstacle, fall back to a perpendicular kick so we
        // don't get stuck at a stable equilibrium.
        const overX = halfW - Math.abs(offX);
        const overY = halfH - Math.abs(offY);
        let pushX = 0, pushY = 0;
        if (overX < overY) {
          pushX = (offX === 0 ? 1 : Math.sign(offX)) * overX;
        } else {
          pushY = (offY === 0 ? 1 : Math.sign(offY)) * overY;
        }
        const w1 = 1 - t, w2 = t;
        dx1 += pushX * w1 * DEFLECT_BOOST;
        dy1 += pushY * w1 * DEFLECT_BOOST;
        dx2 += pushX * w2 * DEFLECT_BOOST;
        dy2 += pushY * w2 * DEFLECT_BOOST;
      }
    }
    if (!hit) break;
    c1 = { x: c1.x + dx1, y: c1.y + dy1 };
    c2 = { x: c2.x + dx2, y: c2.y + dy2 };
  }
  return { c1, c2 };
}

// True when any sample point along the cubic bezier sits inside (or
// within the obstacle's pad/2 of) one of the rects. Per-obstacle pad
// lets the caller mark source/target anchor cards with a tight pad
// so the curve can attach at the edge but still flags any mid-curve
// re-entry. Sample resolution (CHECK_SAMPLES) is higher than the
// deflection loop's so tall-narrow obstacles between widely-spaced
// endpoints aren't slipped past.
function bezierIntersectsObstacles(s, c1, c2, e, obstacles) {
  for (let i = 1; i < CHECK_SAMPLES; i++) {
    const t = i / CHECK_SAMPLES;
    const p = bezierPoint(s, c1, c2, e, t);
    for (const ob of obstacles) {
      const pad = (ob.pad != null ? ob.pad : OBSTACLE_PAD) * 0.5;
      if (p.x > ob.x - pad && p.x < ob.x + ob.w + pad &&
          p.y > ob.y - pad && p.y < ob.y + ob.h + pad) {
        return true;
      }
    }
  }
  return false;
}

// Build an SVG path string through N waypoints with rounded elbows. The
// path is M p0 [L pre1 Q p1 post1 L pre2 Q p2 post2 ...] L pN. Each interior
// waypoint becomes a quadratic-bezier rounded corner. Also returns the
// pre/post points for the first and last elbow so the caller can compute
// arrowhead travel directions.
function buildSmoothPolyline(points) {
  const RADIUS = 14;
  if (points.length < 2) return null;
  if (points.length === 2) {
    const [p, q] = points;
    return {
      path: `M${p.x},${p.y} L${q.x},${q.y}`,
      firstPre: p,
      lastPost: q,
    };
  }
  let d = `M${points[0].x},${points[0].y}`;
  let firstPre = null;
  let lastPost = null;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const inX = Math.sign(cur.x - prev.x);
    const inY = Math.sign(cur.y - prev.y);
    const outX = Math.sign(next.x - cur.x);
    const outY = Math.sign(next.y - cur.y);
    const preX = cur.x - inX * Math.min(RADIUS, Math.abs(cur.x - prev.x) / 2);
    const preY = cur.y - inY * Math.min(RADIUS, Math.abs(cur.y - prev.y) / 2);
    const postX = cur.x + outX * Math.min(RADIUS, Math.abs(next.x - cur.x) / 2);
    const postY = cur.y + outY * Math.min(RADIUS, Math.abs(next.y - cur.y) / 2);
    d += ` L${preX},${preY} Q${cur.x},${cur.y} ${postX},${postY}`;
    if (i === 1) firstPre = { x: preX, y: preY };
    if (i === points.length - 2) lastPost = { x: postX, y: postY };
  }
  const last = points[points.length - 1];
  d += ` L${last.x},${last.y}`;
  return { path: d, firstPre, lastPost };
}

// Build a 2+-segment polyline path from s to e that goes AROUND every
// obstacle. Strategy:
//   1) Inflate each obstacle by DETOUR_PAD to give breathing room.
//   2) Try a 1-elbow L: pick a corner waypoint k such that s→k and k→e
//      are both axis-aligned and obstacle-clear. Score by total length.
//   3) If no L works, try a 2-elbow Z/staircase: pick a pair k1,k2 from
//      the obstacle corners (+ endpoint axis projections) such that
//      s→k1→k2→e is fully axis-aligned and clear.
//   4) Round elbows with quadratic beziers for a tidy look.
// Returns null only if even the 2-elbow search fails (extremely rare).
function buildOrthogonalDetour(s, e, fromTangent, toTangent, obstacles) {
  // Pad each obstacle for routing.
  const obs = obstacles.map(o => ({
    x: o.x - DETOUR_PAD, y: o.y - DETOUR_PAD,
    w: o.w + DETOUR_PAD * 2, h: o.h + DETOUR_PAD * 2,
  }));
  // ── 1-elbow candidates ──────────────────────────────────────────────
  const oneElbow = [
    { x: e.x, y: s.y }, // horizontal-first
    { x: s.x, y: e.y }, // vertical-first
  ];
  for (const o of obs) {
    if (segmentIntersectsRect(s, e, o)) {
      oneElbow.push({ x: o.x - 1,       y: s.y });
      oneElbow.push({ x: o.x + o.w + 1, y: s.y });
      oneElbow.push({ x: s.x,           y: o.y - 1 });
      oneElbow.push({ x: s.x,           y: o.y + o.h + 1 });
      oneElbow.push({ x: o.x - 1,       y: e.y });
      oneElbow.push({ x: o.x + o.w + 1, y: e.y });
      oneElbow.push({ x: e.x,           y: o.y - 1 });
      oneElbow.push({ x: e.x,           y: o.y + o.h + 1 });
    }
  }
  let best = null;
  let bestLen = Infinity;
  for (const k of oneElbow) {
    if (segmentIntersectsAny(s, k, obs) || segmentIntersectsAny(k, e, obs)) continue;
    const len = Math.hypot(k.x - s.x, k.y - s.y) + Math.hypot(e.x - k.x, e.y - k.y);
    if (len < bestLen) { bestLen = len; best = k; }
  }
  let waypoints = null;
  if (best) {
    waypoints = [s, best, e];
  } else {
    // ── 2-elbow Z/staircase candidates ───────────────────────────────
    // Corner pool: each inflated obstacle's 4 corners, plus axis
    // projections that snap a corner's x or y onto the endpoints'
    // x/y so the three-segment route stays axis-aligned.
    const corners = [];
    for (const o of obs) {
      const cs = [
        { x: o.x,         y: o.y },
        { x: o.x + o.w,   y: o.y },
        { x: o.x,         y: o.y + o.h },
        { x: o.x + o.w,   y: o.y + o.h },
      ];
      for (const c of cs) {
        corners.push(c);
        // Axis-projected variants so we can link s/e to this corner
        // via a single axis-aligned segment.
        corners.push({ x: c.x, y: s.y });
        corners.push({ x: c.x, y: e.y });
        corners.push({ x: s.x, y: c.y });
        corners.push({ x: e.x, y: c.y });
      }
    }
    let bestLen2 = Infinity;
    let bestPair = null;
    for (let i = 0; i < corners.length; i++) {
      const k1 = corners[i];
      // s→k1 must be axis-aligned (either x or y matches s).
      if (k1.x !== s.x && k1.y !== s.y) continue;
      if (segmentIntersectsAny(s, k1, obs)) continue;
      const dSk1 = Math.hypot(k1.x - s.x, k1.y - s.y);
      if (dSk1 >= bestLen2) continue; // prune
      for (let j = 0; j < corners.length; j++) {
        if (i === j) continue;
        const k2 = corners[j];
        // k1→k2 must be axis-aligned.
        if (k1.x !== k2.x && k1.y !== k2.y) continue;
        // s→k1 and k1→k2 must turn (not be the same axis), else this
        // is effectively a 1-elbow we already tried.
        const seg1Horiz = (k1.y === s.y);
        const seg2Horiz = (k1.y === k2.y);
        if (seg1Horiz === seg2Horiz) continue;
        // k2→e must be axis-aligned.
        if (k2.x !== e.x && k2.y !== e.y) continue;
        if (segmentIntersectsAny(k1, k2, obs)) continue;
        if (segmentIntersectsAny(k2, e, obs)) continue;
        const len = dSk1
                  + Math.hypot(k2.x - k1.x, k2.y - k1.y)
                  + Math.hypot(e.x - k2.x, e.y - k2.y);
        if (len < bestLen2) { bestLen2 = len; bestPair = [k1, k2]; }
      }
    }
    if (bestPair) waypoints = [s, bestPair[0], bestPair[1], e];
  }
  if (!waypoints) return null;
  const smooth = buildSmoothPolyline(waypoints);
  if (!smooth) return null;
  // Travel-in direction at target = unit vector from lastPost → e.
  const tdx = e.x - smooth.lastPost.x;
  const tdy = e.y - smooth.lastPost.y;
  const tlen = Math.hypot(tdx, tdy) || 1;
  // Travel-in at source (for reverse heads) = unit vector from firstPre → s.
  const fdx = s.x - smooth.firstPre.x;
  const fdy = s.y - smooth.firstPre.y;
  const flen = Math.hypot(fdx, fdy) || 1;
  const mid = waypoints[Math.floor(waypoints.length / 2)];
  return {
    path: smooth.path,
    midPoint: { x: mid.x, y: mid.y },
    toTangentIn:   { ux: tdx / tlen, uy: tdy / tlen },
    fromTangentIn: { ux: fdx / flen, uy: fdy / flen },
  };
}

function segmentIntersectsRect(a, b, r) {
  // Cheap test: if either endpoint is inside the rect → intersects.
  if (a.x > r.x && a.x < r.x + r.w && a.y > r.y && a.y < r.y + r.h) return true;
  if (b.x > r.x && b.x < r.x + r.w && b.y > r.y && b.y < r.y + r.h) return true;
  // Liang-Barsky-style clipping for an axis-aligned rect.
  const dx = b.x - a.x, dy = b.y - a.y;
  let tmin = 0, tmax = 1;
  for (const [p, q] of [[-dx, a.x - r.x], [dx, r.x + r.w - a.x], [-dy, a.y - r.y], [dy, r.y + r.h - a.y]]) {
    if (p === 0) { if (q < 0) return false; }
    else {
      const t = q / p;
      if (p < 0) tmin = Math.max(tmin, t);
      else tmax = Math.min(tmax, t);
    }
  }
  return tmin < tmax;
}

function segmentIntersectsAny(a, b, rects) {
  for (const r of rects) if (segmentIntersectsRect(a, b, r)) return true;
  return false;
}

// Normalize a ref into one of: {kind:'shape', shape, side?}, {kind:'point', x,y}, or null.
// `ctx` provides lookups: { cardById, groupById, cardsByGroup } (any shape map).
function resolveShape(ref, ctx) {
  if (ref == null) return null;
  if (typeof ref === 'string') {
    const c = ctx.cardById?.[ref];
    if (c) return { kind: 'shape', shape: { x: c.x, y: c.y, w: c.w, h: c.h }, id: ref, type: 'card' };
    // Legacy strings could theoretically be a group id too — try.
    const g = ctx.resolveGroupBBox?.(ref);
    if (g) return { kind: 'shape', shape: g, id: ref, type: 'group' };
    return null;
  }
  if (typeof ref !== 'object') return null;
  if (ref.type === 'card' && ref.id) {
    const c = ctx.cardById?.[ref.id];
    if (!c) return null;
    return { kind: 'shape', shape: { x: c.x, y: c.y, w: c.w, h: c.h }, id: ref.id, type: 'card' };
  }
  if (ref.type === 'group' && ref.id) {
    const g = ctx.resolveGroupBBox?.(ref.id);
    if (!g) return null;
    const pad = PAD_GROUP;
    return {
      kind: 'shape',
      shape: { x: g.x - pad, y: g.y - pad, w: g.w + pad * 2, h: g.h + pad * 2 },
      id: ref.id,
      type: 'group',
    };
  }
  if (ref.type === 'point' && Number.isFinite(ref.x) && Number.isFinite(ref.y)) {
    return { kind: 'point', x: ref.x, y: ref.y };
  }
  if (Number.isFinite(ref.x) && Number.isFinite(ref.y)) {
    return { kind: 'point', x: ref.x, y: ref.y };
  }
  return null;
}

// Center of a resolved ref (shape or point). Used as the "look-at" target
// when figuring out which side of the OTHER shape an arrow exits.
function refCenter(resolved) {
  if (!resolved) return null;
  if (resolved.kind === 'point') return { x: resolved.x, y: resolved.y };
  const s = resolved.shape;
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
}

// Pick which side of a rect a line from its center to (tx,ty) exits through.
function sideFromCenterTo(rect, tx, ty) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return 'right';
  // Compare normalized projections — whichever axis is "further along"
  // relative to the rect's half-extent is the side the line exits.
  const ax = Math.abs(dx) / Math.max(1, rect.w / 2);
  const ay = Math.abs(dy) / Math.max(1, rect.h / 2);
  if (ax >= ay) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

// Outward unit normal of a side.
function sideNormal(side) {
  if (side === 'top')    return { ux: 0,  uy: -1 };
  if (side === 'bottom') return { ux: 0,  uy:  1 };
  if (side === 'left')   return { ux: -1, uy:  0 };
  return                        { ux:  1, uy:  0 }; // right
}

// Position along a side at parameter t in [0,1].
function sidePoint(rect, side, t) {
  const u = Math.max(0, Math.min(1, t));
  if (side === 'top')    return { x: rect.x + rect.w * u, y: rect.y };
  if (side === 'bottom') return { x: rect.x + rect.w * u, y: rect.y + rect.h };
  if (side === 'left')   return { x: rect.x,              y: rect.y + rect.h * u };
  return                        { x: rect.x + rect.w,     y: rect.y + rect.h * u }; // right
}

// For sorting fan-out arrows on a side: project the "other endpoint" onto
// the axis parallel to the side.
function sortKey(side, otherX, otherY) {
  return (side === 'top' || side === 'bottom') ? otherX : otherY;
}

// Compute attachment points for every arrow, distributing arrows that share
// the same (anchor, side) along the side. Free-point endpoints attach at
// themselves and are skipped for fan-out. Returns an array indexed parallel
// to `arrows` of objects: { from: {point, tangent, side, kind}, to: {...} }.
export function computeArrowAttachments(arrows, ctx) {
  const N = (arrows || []).length;
  // First pass: resolve refs + compute the "look-at" center used for side determination.
  const ends = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = arrows[i] || {};
    ends[i] = {
      from: resolveShape(a.from, ctx),
      to:   resolveShape(a.to,   ctx),
    };
  }

  // Build buckets per (anchorKey, side).
  // anchorKey = `${type}:${id}` for shape refs, or null for points.
  const buckets = new Map();
  const placements = new Array(N);
  for (let i = 0; i < N; i++) {
    placements[i] = { from: null, to: null };
    const { from, to } = ends[i];
    const fromCenter = refCenter(from);
    const toCenter   = refCenter(to);
    if (!fromCenter || !toCenter) continue;

    const bucketize = (which, self, other) => {
      if (!self || self.kind !== 'shape') return;
      const side = sideFromCenterTo(self.shape, other.x, other.y);
      const key = `${self.type}:${self.id}|${side}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({
        arrowIdx: i,
        which,                    // 'from' | 'to'
        side,
        otherX: other.x,
        otherY: other.y,
        rect: self.shape,
      });
    };
    bucketize('from', from, toCenter);
    bucketize('to',   to,   fromCenter);
  }

  // Second pass: within each bucket, distribute attachment points.
  for (const list of buckets.values()) {
    list.sort((a, b) => sortKey(a.side, a.otherX, a.otherY) - sortKey(b.side, b.otherX, b.otherY));
    const n = list.length;
    for (let j = 0; j < n; j++) {
      const e = list[j];
      const t = n === 1
        ? 0.5
        : FAN_T_MIN + (FAN_T_MAX - FAN_T_MIN) * (j / (n - 1));
      const point = sidePoint(e.rect, e.side, t);
      const nrm = sideNormal(e.side);
      placements[e.arrowIdx][e.which] = {
        point,
        tangent: { ux: nrm.ux, uy: nrm.uy }, // outward
        side: e.side,
        kind: 'shape',
      };
    }
  }

  // Fill in free-point endpoints (no bucket entry).
  for (let i = 0; i < N; i++) {
    const { from, to } = ends[i];
    const fromCenter = refCenter(from);
    const toCenter   = refCenter(to);
    if (!fromCenter || !toCenter) continue;

    if (from && from.kind === 'point' && !placements[i].from) {
      const dx = toCenter.x - fromCenter.x;
      const dy = toCenter.y - fromCenter.y;
      const len = Math.hypot(dx, dy) || 1;
      placements[i].from = {
        point: { x: fromCenter.x, y: fromCenter.y },
        tangent: { ux: dx / len, uy: dy / len }, // toward other end → "outward"
        side: null,
        kind: 'point',
      };
    }
    if (to && to.kind === 'point' && !placements[i].to) {
      const dx = fromCenter.x - toCenter.x;
      const dy = fromCenter.y - toCenter.y;
      const len = Math.hypot(dx, dy) || 1;
      placements[i].to = {
        point: { x: toCenter.x, y: toCenter.y },
        tangent: { ux: dx / len, uy: dy / len },
        side: null,
        kind: 'point',
      };
    }
  }

  return placements;
}

// Build the SVG path string + arrowhead direction for a single arrow given
// its already-resolved attachment endpoints. `style.straight` switches off
// the cubic-bezier curving.
//
// Returns: { path, midPoint, fromTangentIn, toTangentIn } where the *In*
// tangents are unit vectors pointing INTO the respective endpoints (i.e.
// the direction of arrow travel at that point — what arrowheads should
// face).
export function buildArrowPath({ from, to, style = {}, obstacles = null }) {
  if (!from || !to) return null;
  const s = from.point, e = to.point;
  const dx = e.x - s.x, dy = e.y - s.y;
  const len = Math.hypot(dx, dy) || 1;

  if (style.straight) {
    const ux = dx / len, uy = dy / len;
    return {
      path: `M${s.x},${s.y} L${e.x},${e.y}`,
      midPoint: { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 },
      // At target, travel direction is (ux,uy). At source, travel direction
      // (for reverse heads) is (-ux,-uy) into the source.
      toTangentIn:   { ux,  uy  },
      fromTangentIn: { ux: -ux, uy: -uy },
    };
  }

  // Cubic bezier with directional control points. The control magnitude
  // is proportional to the gap so short connections curve gently and long
  // connections sweep wider.
  const mag = Math.max(HANDLE_MIN, Math.min(HANDLE_MAX, len * HANDLE_K));
  let c1 = { x: s.x + from.tangent.ux * mag, y: s.y + from.tangent.uy * mag };
  let c2 = { x: e.x + to.tangent.ux   * mag, y: e.y + to.tangent.uy   * mag };

  // Deflect the curve around any card rects the caller marked as obstacles.
  if (obstacles && obstacles.length) {
    const deflected = deflectControlPoints(s, c1, c2, e, obstacles);
    c1 = deflected.c1;
    c2 = deflected.c2;
  }

  // If the deflected curve STILL passes through any obstacle, fall back to
  // a 3-segment orthogonal detour that's guaranteed clear. The user
  // wants "arrows should AVOID all cards at all costs" — this is the
  // hard-floor enforcement after the soft bezier repulsion gives up.
  if (obstacles && obstacles.length && bezierIntersectsObstacles(s, c1, c2, e, obstacles)) {
    const detour = buildOrthogonalDetour(s, e, from, to, obstacles);
    if (detour) {
      return {
        path: detour.path,
        midPoint: detour.midPoint,
        toTangentIn: detour.toTangentIn,
        fromTangentIn: detour.fromTangentIn,
      };
    }
  }

  const path = `M${s.x},${s.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${e.x},${e.y}`;

  // Approximate the midpoint of the bezier (t=0.5 of a cubic is the average
  // of all four points weighted: B(0.5) = (P0 + 3P1 + 3P2 + P3)/8).
  const midPoint = {
    x: (s.x + 3 * c1.x + 3 * c2.x + e.x) / 8,
    y: (s.y + 3 * c1.y + 3 * c2.y + e.y) / 8,
  };

  // Travel direction at the endpoints = direction from the control point
  // toward the endpoint (cubic bezier derivative at t=0 is 3(c1-s),
  // at t=1 is 3(e-c2)). Then normalize.
  const dx0 = c1.x - s.x, dy0 = c1.y - s.y;
  const l0 = Math.hypot(dx0, dy0) || 1;
  const dx1 = e.x - c2.x, dy1 = e.y - c2.y;
  const l1 = Math.hypot(dx1, dy1) || 1;
  return {
    path,
    midPoint,
    fromTangentIn: { ux: -dx0 / l0, uy: -dy0 / l0 }, // into source (reverse-head dir)
    toTangentIn:   { ux:  dx1 / l1, uy:  dy1 / l1 }, // into target (forward-head dir)
  };
}

// Triangle arrowhead polygon points (string) at `point` pointing along
// `tangentIn` (unit vector, direction of travel into the endpoint).
//   size = length along the tangent; width = wing half-width perpendicular.
export function arrowHeadPolygon(point, tangentIn, { size = 10, width = 4.5 } = {}) {
  const ux = tangentIn.ux, uy = tangentIn.uy;
  // Tip = point. Base center sits `size` back from the tip along -tangent.
  // The two wings sit ±width perpendicular to the tangent.
  const bx = point.x - ux * size;
  const by = point.y - uy * size;
  const px = -uy, py = ux; // perpendicular
  return `${point.x},${point.y} ${bx + px * width},${by + py * width} ${bx - px * width},${by - py * width}`;
}

// Convenience: pixel widths per token.
export function arrowStrokeWidth(thickness) {
  if (thickness === 'thick') return 2.6;
  if (thickness === 'medium') return 1.8;
  return 1.1; // 'thin' or unset
}

// Convenience: arrowhead size scales with stroke width.
export function arrowHeadSize(thickness) {
  if (thickness === 'thick') return { size: 14, width: 6.5 };
  if (thickness === 'medium') return { size: 12, width: 5.5 };
  return { size: 10, width: 4.5 };
}

// Map color token → CSS variable. The actual var values live in styles.css.
// "ink" is the default and renders against the existing ink palette.
const COLOR_TOKENS = {
  ink:    'var(--arrow-ink, var(--ink-2))',
  red:    'var(--arrow-red, #ef4444)',
  orange: 'var(--arrow-orange, #f59e0b)',
  green:  'var(--arrow-green, #10b981)',
  blue:   'var(--arrow-blue, #3b82f6)',
  purple: 'var(--arrow-purple, #a855f7)',
};
export const ARROW_COLOR_TOKENS = COLOR_TOKENS;
export const ARROW_COLOR_KEYS = Object.keys(COLOR_TOKENS);

export function arrowColor(color) {
  if (!color) return COLOR_TOKENS.ink;
  // Custom hex string from the user's color picker.
  if (typeof color === 'string' && color.startsWith('#')) return color;
  if (COLOR_TOKENS[color]) return COLOR_TOKENS[color];
  return COLOR_TOKENS.ink;
}

// True for any color value that isn't one of the named palette tokens —
// used by the popover to know whether to highlight the "+" custom swatch.
export function isCustomArrowColor(color) {
  return typeof color === 'string' && color.startsWith('#');
}

// Read head-style with backwards compat for the old `bidir` boolean.
export function arrowHeadStyle(a) {
  if (a?.head === 'none' || a?.head === 'single' || a?.head === 'double') return a.head;
  if (a?.bidir) return 'double';
  return 'single';
}

// Compare two arrow endpoint refs, treating a bare string as `{type:'card',id}`.
// Returns true if they refer to the same anchor.
export function arrowRefEquals(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const aId   = typeof a === 'string' ? a : a.id;
  const bId   = typeof b === 'string' ? b : b.id;
  const aType = typeof a === 'string' ? 'card' : (a.type || (Number.isFinite(a.x) ? 'point' : 'card'));
  const bType = typeof b === 'string' ? 'card' : (b.type || (Number.isFinite(b.x) ? 'point' : 'card'));
  if (aType !== bType) return false;
  if (aType === 'point') return a.x === b.x && a.y === b.y;
  return aId === bId;
}
