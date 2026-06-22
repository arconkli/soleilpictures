// Pure geometry for anchoring a floating canvas bubble (comment OR vote
// card) to its target. Extracted from CanvasComment.jsx so both the
// comment layer and the vote-card layer share one implementation — any
// object with { anchor_kind, anchor_id, anchor_x, anchor_y } works.
// No React, no imports: keep it pure so it's trivially testable.

export const BUBBLE_W = 240;
export const BUBBLE_H_DEFAULT = 76;  // initial estimate — replaced by ResizeObserver measurement

// Compute the bubble's position AND its anchor dot for a given item.
// Card / group anchors snap the bubble flush to one of the four sides
// of the anchored bbox — the user's offset just determines WHICH side
// (and where along it) the bubble attaches. The dot sits exactly where
// the bubble meets the card, so it visually reads as the seam between
// the two. Point / board anchors fall back to free placement (no card
// to attach to).
//
// `dim = { w, h }` — actual rendered bubble dimensions if known. The
// height varies with content; using a fixed estimate left a visible gap
// on the TOP side when the bubble was shorter. Callers measure via
// ResizeObserver and pass the live value here.
export function bubbleLayout(item, resolveCardBBox, resolveGroupBBox, base, dim) {
  const { ox, oy, ax, ay } = base;
  const W = dim?.w ?? BUBBLE_W;
  const H = dim?.h ?? BUBBLE_H_DEFAULT;
  let bbox = null;
  if (item.anchor_kind === 'card')  bbox = resolveCardBBox?.(item.anchor_id);
  if (item.anchor_kind === 'group') bbox = resolveGroupBBox?.(item.anchor_id);
  if (bbox) {
    return snapBubbleToBox(bbox, ox, oy, W, H);
  }
  if (item.anchor_kind === 'point') {
    const x = ax + ox;
    const y = ay + oy;
    return { bubble: { x, y }, dot: { x: ax, y: ay }, side: null };
  }
  return { bubble: { x: 100 + ox, y: 100 + oy }, dot: null, side: null };
}

export function snapBubbleToBox(box, ox, oy, W, H) {
  // The user's intended bubble center, treating the offsets as a
  // "preferred direction" off the card's natural top-right corner.
  const targetCx = box.x + box.w + 8 + ox + W / 2;
  const targetCy = box.y - 8 + oy + H / 2;
  const cardCx = box.x + box.w / 2;
  const cardCy = box.y + box.h / 2;
  const dx = targetCx - cardCx;
  const dy = targetCy - cardCy;
  // Aspect-ratio-aware side selection.
  const ax = Math.abs(dx) / Math.max(1, box.w / 2);
  const ay = Math.abs(dy) / Math.max(1, box.h / 2);
  let bx, by, side, dotX, dotY;
  if (ax >= ay) {
    if (dx >= 0) {                               // right side
      bx = box.x + box.w;
      by = clamp(targetCy - H / 2, box.y - 18, box.y + box.h - H + 18);
      side = 'right';
      dotX = box.x + box.w;
      dotY = by + H / 2;
    } else {                                     // left side
      bx = box.x - W;
      by = clamp(targetCy - H / 2, box.y - 18, box.y + box.h - H + 18);
      side = 'left';
      dotX = box.x;
      dotY = by + H / 2;
    }
  } else {
    if (dy >= 0) {                               // bottom side
      by = box.y + box.h;
      bx = clamp(targetCx - W / 2, box.x - 18, box.x + box.w - W + 18);
      side = 'bottom';
      dotX = bx + W / 2;
      dotY = box.y + box.h;
    } else {                                     // top side — bubble's
      // BOTTOM should sit on box.y, so top = box.y - H. H must be the
      // bubble's actual rendered height; otherwise a fixed estimate
      // leaves a visible gap.
      by = box.y - H;
      bx = clamp(targetCx - W / 2, box.x - 18, box.x + box.w - W + 18);
      side = 'top';
      dotX = bx + W / 2;
      dotY = box.y;
    }
  }
  return { bubble: { x: bx, y: by }, dot: { x: dotX, y: dotY }, side };
}

// Clamp helper.
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
