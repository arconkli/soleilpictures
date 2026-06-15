// DEV-only arrow-geometry QA bridge (see localMode.isArrowQaMode). Pure routing
// helpers + a deterministic crowded layout + a DOM-based SVG path sampler.
// Published on window.__soleilArrowTest by main.jsx under ?arrowqa=1 so the
// Playwright spec (tests/arrows.spec.js) can assert arrows never cross cards and
// that the smart-blend curve↔elbow switch fires. No backend, no app chrome.
import {
  computeArrowAttachments, buildArrowPath, arrowAnchorKey, ARROW_TUNING,
} from './arrowGeometry.js';

const CARD_W = 140, CARD_H = 90;
const card = (id, x, y, w = CARD_W, h = CARD_H) => ({ id, x, y, w, h });

// A deterministic layout that exercises every routing branch:
//   • A→B with a blocker dead-center on the chord  → soft deflection (stays a curve)
//   • P1→P2 with a 3×3 wall in between             → clean orthogonal elbow
//   • three F1→F2                                  → fan-out + standoff
//   • O1→O2 in open space                          → must remain a soft curve
export function seedCrowded() {
  const cards = [
    card('A', 0, 0), card('X', 300, 5), card('B', 700, 0),
    card('P1', 0, 450), card('P2', 1000, 450),
    card('g00', 300, 300), card('g10', 500, 300), card('g20', 700, 300),
    card('g01', 300, 450), card('g11', 500, 450), card('g21', 700, 450),
    card('g02', 300, 600), card('g12', 500, 600), card('g22', 700, 600),
    card('F1', 0, 850), card('F2', 320, 850),
    card('O1', 0, 1100), card('O2', 360, 1100),
  ];
  const arrows = [
    { from: 'A', to: 'B' },                                   // 0: deflect, stays curve
    { from: 'P1', to: 'P2' },                                 // 1: elbow around the wall
    { from: 'F1', to: 'F2' }, { from: 'F1', to: 'F2' }, { from: 'F1', to: 'F2' }, // 2-4: fan-out
    { from: 'O1', to: 'O2' },                                 // 5: open-space curve
  ];
  return { cards, arrows };
}

function makeCtx(cards) {
  const cardById = {};
  for (const c of cards) cardById[c.id] = c;
  return { cardById, resolveGroupBBox: () => null };
}

const refId = (ref) => (typeof ref === 'string' ? ref : ref?.id);

// Mirror CanvasSurface's arrowGeom obstacle construction for card refs: every
// card is an obstacle; the arrow's own endpoints stay in the set marked pad:1.
function obstaclesFor(arrow, cardRects) {
  if (arrow.straight) return null;
  const anchors = new Set([refId(arrow.from), refId(arrow.to)]);
  return cardRects.map(r => (anchors.has(r.id) ? { ...r, pad: 1 } : r));
}

const rectsOf = (cards) => cards.map(c => ({ id: c.id, x: c.x, y: c.y, w: c.w, h: c.h }));

export function attachmentsFor(cards, arrows, prevSides = null) {
  return computeArrowAttachments(arrows, makeCtx(cards), prevSides);
}

export function buildPathFor(cards, arrows, i) {
  const att = attachmentsFor(cards, arrows)[i];
  if (!att?.from || !att?.to) return null;
  return buildArrowPath({
    from: att.from, to: att.to,
    style: { straight: !!arrows[i].straight },
    obstacles: obstaclesFor(arrows[i], rectsOf(cards)),
  });
}

// Per-arrow built geometry + attachments for the whole seeded set — used by the
// visual harness so what it draws is exactly what the editor would draw.
export function builtArrows(cards, arrows) {
  const atts = attachmentsFor(cards, arrows);
  const cardRects = rectsOf(cards);
  return arrows.map((a, i) => {
    const att = atts[i];
    if (!att?.from || !att?.to) return null;
    const built = buildArrowPath({
      from: att.from, to: att.to,
      style: { straight: !!a.straight }, obstacles: obstaclesFor(a, cardRects),
    });
    return built ? { built, att } : null;
  });
}

// Exact SVG path sampling via a hidden <path> (handles M/L/C/Q precisely — the
// browser's own getPointAtLength, so we measure the real rendered curve).
let _sampler = null;
export function samplePath(d, n = 160) {
  if (!_sampler) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '1'); svg.setAttribute('height', '1');
    svg.style.cssText = 'position:absolute;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden';
    _sampler = document.createElementNS(NS, 'path');
    svg.appendChild(_sampler); document.body.appendChild(svg);
  }
  _sampler.setAttribute('d', d);
  const total = _sampler.getTotalLength();
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const p = _sampler.getPointAtLength((total * k) / n);
    pts.push({ x: p.x, y: p.y });
  }
  return pts;
}

// Assert no arrow path passes within `gap` px of a NON-anchor card. Returns the
// full violation list so a failure is debuggable. The two extreme samples are
// skipped (they sit at the standoff endpoints, on/near the anchor cards).
export function assertClearOfCards(cards, arrows, gap = 2) {
  const atts = attachmentsFor(cards, arrows);
  const cardRects = rectsOf(cards);
  const violations = [];
  arrows.forEach((a, i) => {
    const att = atts[i];
    if (!att?.from || !att?.to) return;
    const built = buildArrowPath({
      from: att.from, to: att.to,
      style: { straight: !!a.straight }, obstacles: obstaclesFor(a, cardRects),
    });
    if (!built) return;
    const anchors = new Set([refId(a.from), refId(a.to)]);
    const pts = samplePath(built.path, 200);
    for (let k = 1; k < pts.length - 1; k++) {
      const p = pts[k];
      for (const c of cardRects) {
        if (anchors.has(c.id)) continue;
        if (p.x > c.x - gap && p.x < c.x + c.w + gap &&
            p.y > c.y - gap && p.y < c.y + c.h + gap) {
          violations.push({ arrowIdx: i, sample: k, cardId: c.id, x: Math.round(p.x), y: Math.round(p.y) });
        }
      }
    }
  });
  return { ok: violations.length === 0, violations };
}

export function makeArrowTestBridge() {
  return {
    ARROW_TUNING, computeArrowAttachments, buildArrowPath, arrowAnchorKey,
    seedCrowded, attachmentsFor, buildPathFor, samplePath, assertClearOfCards,
  };
}
