// The two-finger camera's maths, for CanvasSurface's touch tracker. Each frame
// moves from the pair's previous midpoint and spacing to the new ones, so the
// board point under the fingers stays under them: pinch and pan in one motion.
// Past a zoom limit the board stretches with resistance in log-zoom,
// f(e) = (1 - e/E)^2 integrated in closed form, and moving back is 1:1.
// settleTarget is where the camera glides back to on release.

// How far past a zoom limit the board can stretch, in log-zoom.
export const WALL_STRETCH = Math.log(1.12);
// Two fingers closer than this (px) give no spacing, so they cause no zoom.
export const MIN_SPAN = 8;

// Log-zoom after a raw log step dL, with the soft wall. Inside the limits the
// step is 1:1; further past a limit meets resistance and never reaches E;
// moving back toward the range is always 1:1.
export function stepLogZoom(L, dL, Lmin, Lmax, E = WALL_STRETCH) {
  if (!Number.isFinite(dL) || dL === 0) return L;
  if (dL > 0) {
    if (L < Lmax) {
      const take = Math.min(dL, Lmax - L);
      L += take;
      dL -= take;
    }
    if (dL > 0) {
      const e0 = Math.max(0, L - Lmax);
      const u0 = Math.max(1 - e0 / E, 1e-9);
      const u = 1 / (1 / u0 + dL / E);
      L = Lmax + E * (1 - u);
    }
  } else {
    if (L > Lmin) {
      const take = Math.max(dL, Lmin - L);
      L += take;
      dL -= take;
    }
    if (dL < 0) {
      const e0 = Math.max(0, Lmin - L);
      const u0 = Math.max(1 - e0 / E, 1e-9);
      const u = 1 / (1 / u0 + -dL / E);
      L = Lmin - E * (1 - u);
    }
  }
  return L;
}

// The midpoint and spacing of the first two fingers; a third is ignored.
export function fingerAnchor(points) {
  if (!Array.isArray(points) || points.length === 0) return null;
  const a = points[0];
  if (points.length === 1) return { x: a.x, y: a.y, span: null };
  const b = points[1];
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, span: d < MIN_SPAN ? null : d };
}

// The camera after the fingers go from `from` to `to`. Anchors are in the same
// pixel space as pan.
export function moveCamera(cam, from, to, { min, max, stretch = WALL_STRETCH } = {}) {
  if (!from || !to) return { zoom: cam.zoom, pan: { x: cam.pan.x, y: cam.pan.y } };
  const zoom2 = from.span && to.span
    ? Math.exp(stepLogZoom(Math.log(cam.zoom), Math.log(to.span / from.span), Math.log(min), Math.log(max), stretch))
    : cam.zoom;
  // The board point under the fingers...
  const wx = (from.x - cam.pan.x) / cam.zoom;
  const wy = (from.y - cam.pan.y) / cam.zoom;
  // ...stays under them.
  return { zoom: zoom2, pan: { x: to.x - wx * zoom2, y: to.y - wy * zoom2 } };
}

// Where the camera settles after release, or null when it is already in range.
export function settleTarget(cam, at, { min, max }) {
  if (cam.zoom >= min * (1 - 1e-9) && cam.zoom <= max * (1 + 1e-9)) return null;
  const z = Math.min(max, Math.max(min, cam.zoom));
  if (!at) return { zoom: z, pan: { x: cam.pan.x, y: cam.pan.y } };
  return {
    zoom: z,
    pan: {
      x: at.x - ((at.x - cam.pan.x) / cam.zoom) * z,
      y: at.y - ((at.y - cam.pan.y) / cam.zoom) * z,
    },
  };
}
