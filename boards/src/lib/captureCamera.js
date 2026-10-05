// captureCamera — the fit solver, and easing for a camera move.
//
// Two jobs, both pure, both extracted so they can be asserted without a DOM.
//
// 1. solveFit(). CanvasSurface had this same eight-line solve written out three
//    times — fitToContent, zoomToSelection, frameCards — which is three places
//    for a margin or a clamp to drift. It is one function now, taking its
//    bounds as arguments rather than importing ZOOM_MIN/ZOOM_MAX, so this
//    module stays a leaf and the canvas keeps owning its own limits.
//
// 2. Easing. A demo recording made by scroll-wheeling to a card looks like
//    somebody operating software. The same move on a timed ease looks like a
//    camera. That difference is most of what separates a product video from a
//    screen recording, and it costs one cubic.

/**
 * Solve the zoom and pan that frames `rect` inside `viewport`.
 *
 * `rect` and `viewport` are both {x, y, w, h}; rect is in board units, viewport
 * in screen pixels. Returns { zoom, pan: {x, y} } — the same shape the canvas
 * keeps in state.
 */
export function solveFit(rect, viewport, { margin = 80, zoomMin = 0.1, zoomMax = 5 } = {}) {
  const vw = Number(viewport?.w) || 0;
  const vh = Number(viewport?.h) || 0;
  const contentW = Math.max(1, Number(rect?.w) || 1);
  const contentH = Math.max(1, Number(rect?.h) || 1);
  const x0 = Number(rect?.x) || 0;
  const y0 = Number(rect?.y) || 0;

  // A margin bigger than half the viewport would ask for a negative amount of
  // space and solve to a negative zoom. Clamp it rather than trusting callers.
  const m = Math.max(0, Math.min(margin, Math.min(vw, vh) / 2 - 1));

  const zoom = Math.max(zoomMin, Math.min(zoomMax, Math.min(
    (vw - m * 2) / contentW,
    (vh - m * 2) / contentH,
  )));

  return {
    zoom,
    pan: {
      x: (vw - contentW * zoom) / 2 - x0 * zoom,
      y: (vh - contentH * zoom) / 2 - y0 * zoom,
    },
  };
}

// ── Margins ────────────────────────────────────────────────────────────────
//
// How much air to leave around what you are framing, in VIEWPORT pixels. They
// live here with solveFit because they are arguments to it, and because a
// margin that is a hand-written literal in one place and viewport-aware in
// another is precisely how a phone ended up with a "push in" that zoomed out.

/**
 * Fitting the whole board. A flat 80 on a 390pt phone is 160px of a 390px
 * screen — 41% of it — so the content it is framing shrinks to nothing.
 */
export const fitMargin = (r) => (r.width > 640 ? 80 : Math.max(16, Math.round(r.width * 0.05)));

/**
 * Framing a SELECTION, which leaves more air than fitting the whole board: the
 * point is to single something out, and a selection pressed to the viewport
 * edges reads as "the board is this" rather than "look at this".
 *
 * The flat 120 this replaces below 640 was worse than the fit case it was
 * modelled on. It left 150px of usable width on a 390pt screen, so a push-in
 * could never fill more than 38% of the frame — and once the selection was more
 * than about 43% of the board, `selection` solved a LOWER zoom than the `fit` it
 * came from. Both `punch` and `establish` are fit → hold → selection, so the
 * flagship move of the flagship takes ran backwards on a phone.
 *
 * 8% rather than fitMargin's 5% so the "more air than a fit" property survives
 * at every width — that is the whole reason this is a separate function and not
 * a shared one, and it is why the number is not round.
 */
export const selectionMargin = (r) => (r.width > 640 ? 120 : Math.max(16, Math.round(r.width * 0.08)));

/**
 * Ease-in-out cubic. Slow at both ends, quick through the middle — the shape a
 * physical camera move has, and the reason a tween reads as intent rather than
 * as a jump.
 */
export function easeInOutCubic(t) {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

const clamp01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t);

// The curve is the difference between a move that reads as a camera operator
// and one that reads as a script. Each of these does a different job, which is
// why there is more than one rather than a single "nice" default:
//
//   smooth  eases both ends — a considered move between two places
//   settle  leaves fast, lands gently — a reveal; the arrival is the beat
//   lead    starts gently, arrives quickly — good going INTO a cut
//   drift   barely accelerates at all — ambient motion behind a title
//   snap    almost all the distance immediately, then a long tail — punchy
export const EASINGS = Object.freeze({
  smooth: easeInOutCubic,
  settle: (t) => 1 - Math.pow(1 - clamp01(t), 3),
  lead:   (t) => Math.pow(clamp01(t), 3),
  drift:  (t) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2,
  snap:   (t) => 1 - Math.pow(1 - clamp01(t), 5),
});

export const DEFAULT_EASE = 'smooth';

/** Resolve an easing by name. Unknown names fall back rather than throwing —
 *  a typo in a shot list should produce a plain move, not a dead run. */
export function easingFor(name) {
  return EASINGS[name] || EASINGS[DEFAULT_EASE];
}

/**
 * Sample a camera move at normalised time `t`.
 *
 * Zoom is interpolated GEOMETRICALLY (in log space). Zoom is a multiplicative
 * quantity — 0.5→2 is the same size of move as 2→8 — so a linear blend spends
 * most of its time near the larger value and the move looks like it accelerates
 * into the target and stops dead. In log space it reads as a constant rate.
 */
export function sampleTween(from, to, t, ease = easeInOutCubic) {
  const k = ease(t);
  const z0 = Math.max(1e-6, Number(from?.zoom) || 1);
  const z1 = Math.max(1e-6, Number(to?.zoom) || 1);
  return {
    zoom: z0 * Math.pow(z1 / z0, k),
    pan: {
      x: (from?.pan?.x || 0) + ((to?.pan?.x || 0) - (from?.pan?.x || 0)) * k,
      y: (from?.pan?.y || 0) + ((to?.pan?.y || 0) - (from?.pan?.y || 0)) * k,
    },
  };
}

// Long enough to read as deliberate, short enough not to bore a viewer who has
// already understood the move.
export const CAMERA_MS = 900;
