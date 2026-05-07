// Pick a non-overlapping position around a card's perimeter for a new
// comment bubble. Used when a comment gets placed on a card so the
// bubble doesn't accidentally land on top of a neighbouring card.
//
// Strategy: generate 8 candidate offsets (one per cardinal + diagonal)
// around the target, score each by how much it overlaps existing cards
// + existing comment bubbles, and return the offset with the lowest
// score. If everything overlaps equally, falls back to top-right.

const COMMENT_W = 240;   // matches .canvas-comment width in CSS (collapsed)
const COMMENT_H = 76;    // average preview-card height
const GAP = 12;          // gap between target card edge and bubble

function rectOverlap(a, b) {
  const dx = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const dy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return dx * dy;
}

// Returns { offsetX, offsetY } where the bubble's top-left ends up at:
//   target.x + target.w + 8 + offsetX,
//   target.y - 8 + offsetY
// (matching the rest of the comment-anchor math in CanvasComment.jsx).
//
// `target`  — { x, y, w, h } of the card we're commenting on
// `others`  — list of { x, y, w, h } of every other card on the board
// `placed`  — list of { x, y, w, h } of comment bubbles already placed
//             on this board (canvas-space)
export function pickCommentOffset({ target, others = [], placed = [] }) {
  if (!target) return { offsetX: 0, offsetY: 0 };

  // Default position the existing render code uses — top-right corner,
  // 8px above and 8px right of the card. Treat this as our (0, 0)
  // offset reference frame.
  const defaultX = target.x + target.w + 8;
  const defaultY = target.y - 8;

  // Candidate placements in canvas-space. Order = priority for ties:
  // top-right first (matches user's existing mental model), then
  // outward variations.
  const cands = [
    // Right side, top → bottom
    { x: target.x + target.w + GAP,             y: target.y - 8 },
    { x: target.x + target.w + GAP,             y: target.y + target.h / 2 - COMMENT_H / 2 },
    { x: target.x + target.w + GAP,             y: target.y + target.h - COMMENT_H + 8 },
    // Left side
    { x: target.x - COMMENT_W - GAP,            y: target.y - 8 },
    { x: target.x - COMMENT_W - GAP,            y: target.y + target.h / 2 - COMMENT_H / 2 },
    { x: target.x - COMMENT_W - GAP,            y: target.y + target.h - COMMENT_H + 8 },
    // Top side
    { x: target.x + target.w / 2 - COMMENT_W / 2, y: target.y - COMMENT_H - GAP },
    // Bottom side
    { x: target.x + target.w / 2 - COMMENT_W / 2, y: target.y + target.h + GAP },
  ];

  const scoreFor = (cand) => {
    const candRect = { x: cand.x, y: cand.y, w: COMMENT_W, h: COMMENT_H };
    let score = 0;
    for (const o of others) score += rectOverlap(candRect, o);
    for (const p of placed) score += rectOverlap(candRect, p) * 1.5; // slight pref to spread
    return score;
  };

  let best = cands[0];
  let bestScore = scoreFor(best);
  for (let i = 1; i < cands.length; i++) {
    const s = scoreFor(cands[i]);
    if (s < bestScore) { best = cands[i]; bestScore = s; }
    if (bestScore === 0) break; // perfect fit — no need to keep searching
  }

  return {
    offsetX: Math.round(best.x - defaultX),
    offsetY: Math.round(best.y - defaultY),
  };
}

// Same shape, but for group anchors. The "natural" position uses the
// group's bounding box (top-right corner, 8px above and right) — same
// math as cards, just different inputs.
export function pickCommentOffsetForGroup({ groupBBox, others = [], placed = [] }) {
  return pickCommentOffset({ target: groupBBox, others, placed });
}
