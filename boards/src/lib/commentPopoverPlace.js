// Where a comment thread popover (CommentInlinePopover) goes for its anchor
// rect: the commented text, or that thread's gutter dot.
//
// Below the anchor's line, flipped above when it doesn't fit, and never beside
// it. It used to open at the anchor's right edge on the same line, which hid
// the rest of the sentence being discussed — and once that position was
// clamped back from the viewport's right edge (every phone), the popover sat
// on the commented word itself.

const PAD = 8;
const GAP = 6;

export function placeCommentPopover(anchor, popH, vw, vh, maxW = 320) {
  const width = Math.min(maxW, vw - PAD * 2);
  const left = Math.min(Math.max(PAD, anchor.left), vw - width - PAD);
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - popH;
  let top;
  if (below + popH <= vh - PAD) top = below;
  else if (above >= PAD) top = above;
  // Fits neither way (a long thread on a short screen): take the roomier side
  // and stay on screen.
  else if (vh - anchor.bottom >= anchor.top) top = Math.max(PAD, Math.min(below, vh - popH - PAD));
  else top = PAD;
  return { top, left, width };
}
