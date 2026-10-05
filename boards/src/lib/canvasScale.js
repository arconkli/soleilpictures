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

/**
 * The canvas's actual settled zoom. What anything reasoning about SCREEN
 * GEOMETRY wants: how far a finger travelled, how big a hit target is, which
 * level of detail a card should draw at.
 */
export function getCanvasScale() {
  return scale;
}

/**
 * The zoom to pick an IMAGE TIER against — the settled zoom times the Capture
 * Mode boost.
 *
 * These were one function, with the boost folded into getCanvasScale(). The
 * boost is about photographing images sharply and nothing else, but the getter
 * had four callers and only two of them were about images: GridCard divides a
 * pointer delta by it, so in Capture Mode a divider dragged at half finger
 * speed and its snap window halved; ScheduleCard feeds it into a level-of-detail
 * tier and a chrome multiplier, so a card that reads as a poster in the product
 * photographed as a full calendar, with the 44pt touch floor collapsed.
 *
 * The BOOSTED read is the one with the special name, deliberately. A future
 * caller reaching for the obvious getter gets the true zoom, and this class of
 * bug cannot come back the same way.
 */
export function getImageTierScale() {
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
