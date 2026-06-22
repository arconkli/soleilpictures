// DEV-only snap/alignment-guide QA bridge (see localMode.isAlignQaMode). Pure
// snap helpers + a deterministic layout, published on window.__soleilAlignTest by
// main.jsx under ?alignqa=1 so the Playwright spec (tests/align.spec.js) can
// assert the load-bearing behaviour — far cards don't trigger guides, collinear
// lines dedupe, equal-size resize draws a dual caliper — with no backend.
//
// Tests pass an explicit `tuning` (via the `tuning()` helper) so the REAL
// culling/dedup/caliper behaviour can be verified even while the shipped
// SNAP_TUNING still has those knobs inert. Mirrors lib/arrowQa.js.
import {
  SNAP_TUNING, worldViewportRect, buildSnapTargets, computeSnap,
  buildResizeTargets, computeResizeSnap,
} from './snapGuides.js';

const card = (id, x, y, w = 120, h = 80) => ({ id, x, y, w, h });

// Deterministic layout exercising every branch:
//   A / B / Bd  — three cards on x≈0 (B exact, Bd 0.4px off)  → edge-X + dedup
//   LONE        — alone at x=-500, 3000px down                → proximity cull
//   FAR         — off-board corner                            → viewport cull
//   P1 / P2     — 24px apart in a row, with PD just below     → equal-spacing
//   RZ          — the card we resize                          → resize snapping
//   S1          — near RZ, 160×140 (distinct size)            → resize same-size (near)
//   Sf          — far, 200 wide                               → resize size proximity cull
export function seedSnapLayout() {
  return {
    cards: [
      card('A',    0,    0,    120, 80),
      card('B',    0,    200,  120, 80),
      card('Bd',   0.4,  440,  120, 80),
      card('FARCOL', 0,  5000, 120, 80),   // shares x=0 with A/B but far → span-trim
      card('LONE', -500, 3000, 120, 80),
      card('FAR',  6000, 4000, 120, 80),
      card('P1',   300,  1000, 120, 80),
      card('P2',   444,  1000, 120, 80),
      card('PD',   300,  1100, 120, 80),
      card('RZ',   1000, 300,  120, 80),
      card('S1',   1000, 0,    160, 140),
      card('Sf',   6000, 0,    200, 140),
    ],
  };
}

const byId = (cards, id) => cards.find((c) => c.id === id);

// Bounding box (minX/minY/maxX/maxY) of a single card — the shape computeSnap
// expects for the dragged group.
export function bboxOf(c) {
  return { minX: c.x, minY: c.y, maxX: c.x + c.w, maxY: c.y + c.h };
}

// Merge tuning overrides onto the shipped config so a test can drive the
// production behaviour regardless of what the shipped knobs are set to.
export function tuning(over) {
  return Object.freeze({ ...SNAP_TUNING, ...(over || {}) });
}

export function targetsFor(cards, dragId, viewport, zoom = 1, tune = SNAP_TUNING) {
  return buildSnapTargets({ cards, dragSet: new Set([dragId]), viewport, zoom, tuning: tune });
}

// Convenience: build targets + solve a move of (rawDx, rawDy) for dragging
// `dragId`. Returns computeSnap's { dx, dy, hints }.
export function moveSnap(cards, dragId, rawDx, rawDy, viewport, zoom = 1, tune = SNAP_TUNING) {
  const targets = targetsFor(cards, dragId, viewport, zoom, tune);
  return computeSnap(rawDx, rawDy, { targets, dragBBoxStart: bboxOf(byId(cards, dragId)), zoom, tuning: tune });
}

export function resizeTargetsFor(cards, selfId, viewport, zoom = 1, tune = SNAP_TUNING) {
  return buildResizeTargets({ cards, selfId, viewport, zoom, tuning: tune });
}

// Convenience: build resize targets + solve a resize of (rawDw, rawDh) for `selfId`.
export function resizeSnap(cards, selfId, rawDw, rawDh, viewport, zoom = 1, tune = SNAP_TUNING) {
  const targets = resizeTargetsFor(cards, selfId, viewport, zoom, tune);
  return computeResizeSnap(rawDw, rawDh, { card: byId(cards, selfId), targets, skip: false, skipH: false, zoom, tuning: tune });
}

export function makeSnapTestBridge() {
  return {
    SNAP_TUNING, worldViewportRect, buildSnapTargets, computeSnap,
    buildResizeTargets, computeResizeSnap,
    seedSnapLayout, bboxOf, tuning, targetsFor, moveSnap, resizeTargetsFor, resizeSnap,
  };
}
