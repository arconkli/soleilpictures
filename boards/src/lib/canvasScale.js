// canvasScale.js — the canvas's settled zoom factor + a settle event, shared
// with R2Image without prop-drilling through the card tree. The canvas zooms
// via an ancestor CSS transform, so a card's LAYOUT width never changes with
// zoom — image tier decisions need layout-width × this scale to know how many
// device pixels a card actually covers on screen. Zero imports on purpose
// (leaf module: CanvasSurface, R2Image and tests can pull it in cycle-free).
//
// Scale is written by CanvasSurface's pan/zoom layout effect (settled values
// only — mid-gesture zoom lives in refs + a direct DOM transform) and reset
// to 1 on canvas unmount so a deep zoom never leaks into the next surface's
// first mounts. emitCanvasSettle() fires at the gesture-settle commits;
// subscribers re-evaluate image tier promotion/demotion once per settle.

let scale = 1;
let captureBoost = 1;
const listeners = new Set();

export function setCanvasScale(z) {
  scale = (typeof z === 'number' && z > 0) ? z : 1;
}

// Capture Mode multiplier, applied on READ so it can never be clobbered by the
// next settle (setCanvasScale writes `scale` alone, so the two never fight).
// Reframing a board for a phone shrinks cards in BOARD units, which would
// otherwise have pickInitialTier photograph preview-tier images — the failure
// where a marketing shot looks subtly soft and nobody can say why. Boosting the
// reported scale promotes every visible image a tier or two for the shot.
export function setCaptureScaleBoost(k) {
  captureBoost = (typeof k === 'number' && k > 0) ? k : 1;
}
export function getCanvasScale() {
  return scale * captureBoost;
}

export function onCanvasSettle(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function emitCanvasSettle() {
  for (const cb of listeners) {
    try { cb(); } catch (_) { /* a listener error must not break the commit */ }
  }
}
