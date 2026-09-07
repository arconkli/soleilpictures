// useCaptureFrame — substitute reframed geometry on the way to the canvas.
//
// The whole ephemerality of the phone reframe rests on WHERE this happens. The
// board's cards come off the Y.Doc, get reframed here, and are handed to
// CanvasSurface as a prop. The document is never told. So:
//
//   • nothing broadcasts — no collaborator sees your board rearrange
//   • nothing persists  — a refresh returns the real layout
//   • the desktop layout is untouched, because it was never written
//
// and none of those are enforced by a check that could be forgotten; they are
// true because there is no write path.
//
// Arrows follow for free. CanvasSurface syncs cardById from this prop each
// render, arrowCtx.liveRect reads cardById, and the arrowAttachments memo lists
// `cards` in its deps precisely because cardById has stable identity. So
// endpoints recompute against the reframed boxes with no second override map.
//
// ── The memo is the performance story ──────────────────────────────────────
// Key on yb.cards, which only changes on a real Y.Doc refresh. Keying on the
// array renderSurface derives (it rebuilds via .filter() every App render)
// would never hit, and the layout would re-solve on every keystroke anywhere
// in the app.
import { useDeferredValue, useMemo } from 'react';
import { reframeCards } from '../lib/reframeLayout.js';

export function useCaptureFrame(yb, { active, width, gap, rowHeight } = {}) {
  const cards = yb?.cards;

  // Dragging the width slider must not re-solve the layout 60×/s on a board
  // with hundreds of cards. React keeps painting the last committed frame
  // while the new one is computed.
  const deferredWidth = useDeferredValue(width);

  const reframed = useMemo(() => {
    if (!active || !Array.isArray(cards) || cards.length < 2) return null;
    return reframeCards(cards, { width: deferredWidth, gap, rowHeight });
  }, [active, cards, deferredWidth, gap, rowHeight]);

  // Identity is preserved when inactive, so the canvas cannot tell this hook is
  // in the path at all until it is used.
  return useMemo(() => (reframed ? { ...yb, cards: reframed } : yb), [yb, reframed]);
}
