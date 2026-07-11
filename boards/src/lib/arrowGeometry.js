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

// All the tunable knobs in one place. Exported (frozen) so the QA harness and
// any future tuning UI read the exact same numbers, and so tests can assert
// against them. The bare `const`s below alias into this object to keep the rest
// of the file a minimal diff.
export const ARROW_TUNING = Object.freeze({
  PAD_GROUP: 12,            // mirrors the groups-layer padding
  FAN_T_MIN: 0.14,          // keep arrows off the corners (a touch tighter than the
  FAN_T_MAX: 0.86,          //   old 0.12/0.88 now that endpoints are pushed out by STANDOFF)
  HANDLE_MIN: 28,           // cubic bezier control magnitude floor
  HANDLE_MAX: 200,          //   …and ceiling
  HANDLE_K: 0.40,           //   …× distance between anchors (curve "body")
  // Soft perpendicular bow so open-space arrows arc gently instead of going
  // dead-straight when two cards line up head-on (see buildArrowPath). Applied
  // before obstacle deflection, so crowded arrows still flatten / elbow.
  BOW_K: 0.14,              // floor bow as a fraction of chord length (~10% midpoint dip)
  BOW_MAX: 80,              // cap so long arrows don't balloon
  BOW_DIR: 1,               // default bow side for perfectly-straight pairs (±1)
  STANDOFF: 6,              // gap between a card edge and the arrow's own tail/head
  OBSTACLE_PAD: 14,         // aspirational breathing room for deflection (overridable per obstacle)
  CHECK_PAD: 2,             // hard-clip threshold — flag samples that ACTUALLY overlap a card
                            //   (separate from OBSTACLE_PAD so curves can pass close to cards)
  ELBOW_TRIGGER_PAD: 10,    // a curve must keep at least this visible gap from non-anchor
                            //   cards; if it can't, yield to a clean orthogonal elbow
  DEFLECT_ITERS: 20,        // # of repulsion passes
  DEFLECT_SAMPLES: 24,      // bezier sample points per deflection pass
  CHECK_SAMPLES: 48,        // higher-resolution sampling for the clip / clearance checks
  DEFLECT_BOOST: 3.0,       // over-push so the smoothed curve clears
  DETOUR_PAD: 24,           // obstacle inflation for the orthogonal detour (was 28)
  CORNER_RADIUS: 10,        // rounded-elbow radius (was a hard-coded 14 in buildSmoothPolyline)
  OBSTACLE_CAP: 40,         // max obstacles considered in the dense-region detour search
});

const PAD_GROUP = ARROW_TUNING.PAD_GROUP;
const FAN_T_MIN = ARROW_TUNING.FAN_T_MIN;
const FAN_T_MAX = ARROW_TUNING.FAN_T_MAX;
const HANDLE_MIN = ARROW_TUNING.HANDLE_MIN;
const HANDLE_MAX = ARROW_TUNING.HANDLE_MAX;
const HANDLE_K   = ARROW_TUNING.HANDLE_K;
const BOW_K = ARROW_TUNING.BOW_K;
const BOW_MAX = ARROW_TUNING.BOW_MAX;
const BOW_DIR = ARROW_TUNING.BOW_DIR;
const STANDOFF = ARROW_TUNING.STANDOFF;
const OBSTACLE_PAD = ARROW_TUNING.OBSTACLE_PAD;
const CHECK_PAD = ARROW_TUNING.CHECK_PAD;
const ELBOW_TRIGGER_PAD = ARROW_TUNING.ELBOW_TRIGGER_PAD;
const DEFLECT_ITERS = ARROW_TUNING.DEFLECT_ITERS;
const DEFLECT_SAMPLES = ARROW_TUNING.DEFLECT_SAMPLES;
const CHECK_SAMPLES = ARROW_TUNING.CHECK_SAMPLES;
const DEFLECT_BOOST = ARROW_TUNING.DEFLECT_BOOST;
// After repulsion, if the bezier still overlaps an obstacle (or can't keep the
// ELBOW_TRIGGER_PAD gap), fall back to an orthogonal route that's guaranteed not
// to cross any box. The detour lives in `buildOrthogonalDetour`. Avoidance is the
// user's stated invariant ("arrows should AVOID all cards at all costs").
const DETOUR_PAD = ARROW_TUNING.DETOUR_PAD;
const OBSTACLE_CAP = ARROW_TUNING.OBSTACLE_CAP;

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

// True when any sample point along the cubic bezier ACTUALLY clips an
// obstacle — uses a tight CHECK_PAD (~2px) so curves are allowed to pass
// close to cards without forcing an orthogonal fallback. Anchor cards
// keep their own per-obstacle pad (smaller) so endpoint attachment isn't
// mis-flagged. Sample resolution is higher than the deflection loop's so
// tall-narrow obstacles between widely-spaced endpoints aren't slipped
// past.
function bezierIntersectsObstacles(s, c1, c2, e, obstacles) {
  for (let i = 1; i < CHECK_SAMPLES; i++) {
    const t = i / CHECK_SAMPLES;
    const p = bezierPoint(s, c1, c2, e, t);
    for (const ob of obstacles) {
      // Anchor cards: respect their tight per-obstacle pad. Other cards:
      // use the small CHECK_PAD so we only flag near-true overlap, not
      // any "close pass" within the aspirational deflection target.
      const pad = ob.pad != null ? ob.pad : CHECK_PAD;
      if (p.x > ob.x - pad && p.x < ob.x + ob.w + pad &&
          p.y > ob.y - pad && p.y < ob.y + ob.h + pad) {
        return true;
      }
    }
  }
  return false;
}

// Shortest distance from a point to the OUTSIDE of an axis-aligned rect.
// Returns 0 when the point is inside (or on the edge).
function pointRectDistance(px, py, r) {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
  return Math.hypot(dx, dy);
}

// Minimum gap between the curve and any NON-ANCHOR obstacle. Anchor cards
// (marked by the caller with a `pad`) are skipped so an endpoint sitting near
// its own card doesn't read as "too tight". Used to decide whether a soft curve
// keeps enough breathing room or should yield to a clean orthogonal elbow.
function bezierClearance(s, c1, c2, e, obstacles) {
  let min = Infinity;
  for (let i = 1; i < CHECK_SAMPLES; i++) {
    const t = i / CHECK_SAMPLES;
    const p = bezierPoint(s, c1, c2, e, t);
    for (const ob of obstacles) {
      if (ob.pad != null) continue; // anchor card — not an obstacle for the gap test
      const d = pointRectDistance(p.x, p.y, ob);
      if (d < min) { min = d; if (min <= 0) return 0; }
    }
  }
  return min;
}

// Cheap gate before paying for the full clearance scan: a cubic bezier is
// contained in the convex hull of its 4 control points, so if no non-anchor
// obstacle reaches the control-point bbox (inflated by the trigger gap), the
// curve is guaranteed to keep that gap and we can skip the scan entirely. Keeps
// the common open-space case as cheap as before.
function nearNonAnchorObstacle(s, c1, c2, e, obstacles) {
  const x0 = Math.min(s.x, c1.x, c2.x, e.x) - ELBOW_TRIGGER_PAD;
  const y0 = Math.min(s.y, c1.y, c2.y, e.y) - ELBOW_TRIGGER_PAD;
  const x1 = Math.max(s.x, c1.x, c2.x, e.x) + ELBOW_TRIGGER_PAD;
  const y1 = Math.max(s.y, c1.y, c2.y, e.y) + ELBOW_TRIGGER_PAD;
  for (const ob of obstacles) {
    if (ob.pad != null) continue; // anchors don't force a detour
    if (!(ob.x + ob.w < x0 || ob.x > x1 || ob.y + ob.h < y0 || ob.y > y1)) return true;
  }
  return false;
}

// Build an SVG path string through N waypoints with rounded elbows. The
// path is M p0 [L pre1 Q p1 post1 L pre2 Q p2 post2 ...] L pN. Each interior
// waypoint becomes a quadratic-bezier rounded corner. Also returns the
// pre/post points for the first and last elbow so the caller can compute
// arrowhead travel directions.
function buildSmoothPolyline(points) {
  const RADIUS = ARROW_TUNING.CORNER_RADIUS;
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
function buildOrthogonalDetour(s, e, from, to, obstacles) {
  // Leave/enter each card along its outward normal (a short axis-aligned stub)
  // so elbows exit perpendicular to the edge like the curves do, instead of
  // starting at an arbitrary angle. Only shape endpoints get a stub (their
  // tangent is axis-aligned); free points keep their exact position. The
  // routing search below runs between the stub points; the true endpoints are
  // re-attached at the end.
  const s0 = s, e0 = e;
  const STUB = STANDOFF + ARROW_TUNING.CORNER_RADIUS;
  if (from && from.kind === 'shape' && from.tangent) {
    s = { x: s.x + from.tangent.ux * STUB, y: s.y + from.tangent.uy * STUB };
  }
  if (to && to.kind === 'shape' && to.tangent) {
    e = { x: e.x + to.tangent.ux * STUB, y: e.y + to.tangent.uy * STUB };
  }
  // Pad each obstacle for routing. Respect the per-obstacle pad so that
  // anchor cards (which the caller marks with pad=1) don't inflate to
  // DETOUR_PAD=28 and trap the endpoint inside their own inflated rect —
  // that would make every candidate L/Z segment from s fail clearance.
  const allObs = obstacles.map(o => {
    const pad = o.pad != null ? o.pad : DETOUR_PAD;
    return {
      x: o.x - pad, y: o.y - pad,
      w: o.w + pad * 2, h: o.h + pad * 2,
    };
  });
  // Drop obstacles entirely outside the routing region — they can't lie
  // on any reasonable detour between s and e, but they'd pollute the
  // corner pool and quadratically blow up the 2-elbow search on dense
  // boards. The region is the bbox of (s, e) expanded by 4× OBSTACLE_PAD.
  const RX_MIN = Math.min(s.x, e.x) - OBSTACLE_PAD * 4;
  const RX_MAX = Math.max(s.x, e.x) + OBSTACLE_PAD * 4;
  const RY_MIN = Math.min(s.y, e.y) - OBSTACLE_PAD * 4;
  const RY_MAX = Math.max(s.y, e.y) + OBSTACLE_PAD * 4;
  let obs = allObs.filter(o =>
    !(o.x + o.w < RX_MIN || o.x > RX_MAX ||
      o.y + o.h < RY_MIN || o.y > RY_MAX)
  );
  // Defensive cap on dense regions: keep the 40 obstacles whose centers
  // are closest to the chord midpoint. Avoids worst-case O(n²) blowups
  // in the 2-elbow search.
  if (obs.length > OBSTACLE_CAP) {
    const cx = (s.x + e.x) / 2, cy = (s.y + e.y) / 2;
    obs = obs
      .map(o => ({ o, d: Math.hypot(o.x + o.w / 2 - cx, o.y + o.h / 2 - cy) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, OBSTACLE_CAP)
      .map(p => p.o);
  }
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
  if (!waypoints) {
    // Last resort: walk around the bounding box of all relevant
    // obstacles. May be a long detour, but the user wants "avoid
    // cards at all costs". Try all four rails (above/below/left/right)
    // and pick the shortest one whose ALL segments are clear — the
    // vertical/horizontal exits from s/e can still cross cards if a
    // card sits between s/e and the rail, so we must check.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of obs) {
      if (o.x < minX) minX = o.x;
      if (o.y < minY) minY = o.y;
      if (o.x + o.w > maxX) maxX = o.x + o.w;
      if (o.y + o.h > maxY) maxY = o.y + o.h;
    }
    if (Number.isFinite(minX)) {
      const rails = [
        { wp: [s, { x: s.x, y: minY - 2 }, { x: e.x, y: minY - 2 }, e] },
        { wp: [s, { x: s.x, y: maxY + 2 }, { x: e.x, y: maxY + 2 }, e] },
        { wp: [s, { x: minX - 2, y: s.y }, { x: minX - 2, y: e.y }, e] },
        { wp: [s, { x: maxX + 2, y: s.y }, { x: maxX + 2, y: e.y }, e] },
      ];
      let bestRail = null;
      let bestScore = Infinity;
      for (const r of rails) {
        const w = r.wp;
        let clipped = 0;
        if (segmentIntersectsAny(w[0], w[1], obs)) clipped++;
        if (segmentIntersectsAny(w[1], w[2], obs)) clipped++;
        if (segmentIntersectsAny(w[2], w[3], obs)) clipped++;
        const len = Math.hypot(w[1].x - w[0].x, w[1].y - w[0].y) +
                    Math.hypot(w[2].x - w[1].x, w[2].y - w[1].y) +
                    Math.hypot(w[3].x - w[2].x, w[3].y - w[2].y);
        // Prefer a fully-clear rail; otherwise fall back to the least-clipping
        // one so we ALWAYS return a tidy orthogonal route rather than null —
        // null would drop the caller back onto a card-crossing bezier.
        const score = clipped * 1e7 + len;
        if (score < bestScore) { bestScore = score; bestRail = w; }
      }
      if (bestRail) waypoints = bestRail;
    }
  }
  if (!waypoints) return null;
  // Re-attach the true endpoints in front of the stub points so the path
  // actually touches the cards (each stub becomes the perpendicular exit leg).
  if (s !== s0) waypoints = [s0, ...waypoints];
  if (e !== e0) waypoints = [...waypoints, e0];
  const smooth = buildSmoothPolyline(waypoints);
  if (!smooth) return null;
  // Travel-in direction at target = unit vector from lastPost → e0.
  const tdx = e0.x - smooth.lastPost.x;
  const tdy = e0.y - smooth.lastPost.y;
  const tlen = Math.hypot(tdx, tdy) || 1;
  // Travel-in at source (for reverse heads) = unit vector from firstPre → s0.
  const fdx = s0.x - smooth.firstPre.x;
  const fdy = s0.y - smooth.firstPre.y;
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
    // Prefer a live rect (card mid-drag / mid-resize) so arrows track the
    // moving edge; fall back to the committed position. `liveRect` is absent
    // in non-gesture paths and the ?arrowqa test ctx, so behavior is identical
    // there.
    const c = ctx.liveRect?.(ref) || ctx.cardById?.[ref];
    if (c) return { kind: 'shape', shape: { x: c.x, y: c.y, w: c.w, h: c.h }, id: ref, type: 'card' };
    // Legacy strings could theoretically be a group id too — try.
    const g = ctx.resolveGroupBBox?.(ref);
    if (g) return { kind: 'shape', shape: g, id: ref, type: 'group' };
    return null;
  }
  if (typeof ref !== 'object') return null;
  if (ref.type === 'card' && ref.id) {
    const c = ctx.liveRect?.(ref.id) || ctx.cardById?.[ref.id];
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

// Hysteresis fraction (of half-extent) the freshly-computed side must win the
// previous side by before we accept a flip. Stops arrows from snapping to a new
// card side on tiny position jitter / unrelated edits.
const SIDE_HYSTERESIS = 0.15;

// Like sideFromCenterTo, but sticky: keep `prevSide` unless the raw winner pulls
// away from it by a margin. `prevSide` null/undefined ⇒ no memory ⇒ raw result
// (so first frame, and the read-only viewer, behave exactly as before).
function sideFromCenterToStable(rect, tx, ty, prevSide) {
  const raw = sideFromCenterTo(rect, tx, ty);
  if (!prevSide || prevSide === raw) return raw;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = tx - cx, dy = ty - cy;
  const halfW = Math.max(1, rect.w / 2);
  const halfH = Math.max(1, rect.h / 2);
  // Normalized outward "pull" toward each side (0 if the target is on the
  // opposite side of center for that axis).
  const pull = {
    right:  dx > 0 ?  dx / halfW : 0,
    left:   dx < 0 ? -dx / halfW : 0,
    bottom: dy > 0 ?  dy / halfH : 0,
    top:    dy < 0 ? -dy / halfH : 0,
  };
  return pull[raw] > pull[prevSide] + SIDE_HYSTERESIS ? raw : prevSide;
}

// Stable string key for an endpoint ref (card/group id, or a point's coords).
// Used to remember per-arrow state (attachment side, fan order) across renders
// even though arrows are stored index-keyed, not by id.
function refKey(ref) {
  if (ref == null) return '~';
  if (typeof ref === 'string') return `c:${ref}`;
  if (typeof ref !== 'object') return '~';
  if (ref.type === 'card' && ref.id) return `c:${ref.id}`;
  if (ref.type === 'group' && ref.id) return `g:${ref.id}`;
  if (Number.isFinite(ref.x) && Number.isFinite(ref.y)) return `p:${ref.x},${ref.y}`;
  return '~';
}
// Composite key for a whole arrow, from its two endpoint refs.
export function arrowAnchorKey(a) {
  return `${refKey(a?.from)}>${refKey(a?.to)}`;
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
export function computeArrowAttachments(arrows, ctx, prevSides = null) {
  const N = (arrows || []).length;
  // First pass: resolve refs + compute the "look-at" center used for side
  // determination. Also derive each arrow's stable anchor key for hysteresis
  // and stable fan ordering (survives the index churn of updateArrow's
  // delete+reinsert, since it's derived from the from/to refs, not the index).
  const ends = new Array(N);
  const keys = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = arrows[i] || {};
    keys[i] = arrowAnchorKey(a);
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
      const prevSide = prevSides ? prevSides.get(`${keys[i]}|${which}`) : null;
      const side = sideFromCenterToStable(self.shape, other.x, other.y, prevSide);
      const key = `${self.type}:${self.id}|${side}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({
        arrowIdx: i,
        which,                    // 'from' | 'to'
        side,
        otherX: other.x,
        otherY: other.y,
        rect: self.shape,
        aKey: keys[i],            // stable tie-break for fan ordering
      });
    };
    bucketize('from', from, toCenter);
    bucketize('to',   to,   fromCenter);
  }

  // Second pass: within each bucket, distribute attachment points. Sort by the
  // other endpoint's projected position (so the fan doesn't self-cross), with a
  // stable anchor-key tie-break so equal projections don't swap slots between
  // renders (the "wandering" the user noticed during card drags).
  for (const list of buckets.values()) {
    list.sort((a, b) => {
      const d = sortKey(a.side, a.otherX, a.otherY) - sortKey(b.side, b.otherX, b.otherY);
      if (d !== 0) return d;
      return a.aKey < b.aKey ? -1 : a.aKey > b.aKey ? 1
           : a.which < b.which ? -1 : a.which > b.which ? 1 : 0;
    });
    const n = list.length;
    for (let j = 0; j < n; j++) {
      const e = list[j];
      const t = n === 1
        ? 0.5
        : FAN_T_MIN + (FAN_T_MAX - FAN_T_MIN) * (j / (n - 1));
      const base = sidePoint(e.rect, e.side, t);
      const nrm = sideNormal(e.side);
      // Push the attachment a small STANDOFF off the card edge so the tail/head
      // (and the drag handle) float just clear of the border instead of kissing
      // it — reads as a deliberate, even gap. Fan-out arrows all shift out
      // together, so they stay evenly spaced *and* evenly gapped.
      const point = { x: base.x + nrm.ux * STANDOFF, y: base.y + nrm.uy * STANDOFF };
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

  // Expose the resolved sides (keyed by stable arrow key) so the caller can feed
  // them back as `prevSides` next render to drive the hysteresis above. Only
  // shape endpoints have a side. Attached to the array so the return shape stays
  // a plain placements list for callers that don't care (e.g. the viewer).
  const sides = new Map();
  for (let i = 0; i < N; i++) {
    const pf = placements[i]?.from, pt = placements[i]?.to;
    if (pf && pf.kind === 'shape') sides.set(`${keys[i]}|from`, pf.side);
    if (pt && pt.kind === 'shape') sides.set(`${keys[i]}|to`, pt.side);
  }
  placements.sides = sides;

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

  // Soft bow: keep arrows feeling hand-drawn even when the endpoints line up
  // head-on — that case puts both control points ON the chord, collapsing the
  // bezier to a dead-straight line. Measure the curve's natural perpendicular
  // swing, then ensure at least a gentle, length-scaled bow IN THE SAME
  // DIRECTION (defaulting to one side when the natural swing is ~0). Never
  // inverts or flattens an existing curve; only adds swing. Applied before the
  // obstacle deflection below, so a crowded arrow still flattens / elbows —
  // "curvy only when there's room" falls out for free.
  {
    const perpUx = -dy / len, perpUy = dx / len;
    const natBow = (
      (c1.x - s.x) * perpUx + (c1.y - s.y) * perpUy +
      (c2.x - e.x) * perpUx + (c2.y - e.y) * perpUy
    ) / 2;
    const targetMag = Math.min(len * BOW_K, BOW_MAX);
    const dir = natBow > 1 ? 1 : natBow < -1 ? -1 : BOW_DIR;
    const targetBow = dir * Math.max(Math.abs(natBow), targetMag);
    const add = targetBow - natBow;
    c1 = { x: c1.x + perpUx * add, y: c1.y + perpUy * add };
    c2 = { x: c2.x + perpUx * add, y: c2.y + perpUy * add };
  }

  // Deflect the curve around any card rects the caller marked as obstacles.
  if (obstacles && obstacles.length) {
    const deflected = deflectControlPoints(s, c1, c2, e, obstacles);
    c1 = deflected.c1;
    c2 = deflected.c2;
  }

  // Smart blend: a soft curve is only acceptable if it actually clears the
  // cards. Yield to a clean orthogonal elbow when the deflected curve either
  // hard-clips a card OR can't keep the ELBOW_TRIGGER_PAD breathing gap from a
  // non-anchor card (the cheap nearNonAnchorObstacle gate skips the gap scan in
  // open space, keeping the common case fast). The detour is guaranteed clear,
  // so this enforces the user's "arrows AVOID all cards" invariant while letting
  // open-space hops stay curvy.
  if (obstacles && obstacles.length) {
    const clips = bezierIntersectsObstacles(s, c1, c2, e, obstacles);
    const tooTight = !clips
      && nearNonAnchorObstacle(s, c1, c2, e, obstacles)
      && bezierClearance(s, c1, c2, e, obstacles) < ELBOW_TRIGGER_PAD;
    if (clips || tooTight) {
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

// Convenience: pixel widths per token. Nudged up slightly so 'thin' arrows
// don't disappear when zoomed out, while staying delicate.
export function arrowStrokeWidth(thickness) {
  if (thickness === 'thick') return 2.75;
  if (thickness === 'medium') return 1.9;
  return 1.25; // 'thin' or unset
}

// Convenience: arrowhead size scales with stroke width. Slightly slimmer and
// longer than before for a cleaner, more modern point.
export function arrowHeadSize(thickness) {
  if (thickness === 'thick') return { size: 13, width: 5.2 };
  if (thickness === 'medium') return { size: 11, width: 4.4 };
  return { size: 9, width: 3.6 };
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
