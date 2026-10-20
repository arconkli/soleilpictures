// The maths of keeping a chat thread where its reader is. Pure, so node
// --test can pin it; hooks/useStickToBottom.js does the DOM.

// Within this of the bottom counts as "at the bottom": new arrivals follow.
export const STICK_THRESHOLD_PX = 48;

export function distanceFromBottom({ scrollHeight, scrollTop, clientHeight }) {
  return scrollHeight - scrollTop - clientHeight;
}

export function isStuck(metrics, threshold = STICK_THRESHOLD_PX) {
  return distanceFromBottom(metrics) <= threshold;
}

// The message to hold in place while the reader is scrolled up: the first one
// still showing at the top of the view, and how far below that edge its top
// sits (negative when it straddles the edge).
//   items — [{ id, top, bottom }] in document order, page coordinates
export function pickAnchor(items, viewportTop) {
  const it = (items || []).find((i) => i.bottom > viewportTop);
  return it ? { id: it.id, offset: it.top - viewportTop } : null;
}

// How far to scroll so the anchor's top sits where it did.
export function anchorCorrection(anchor, nowTop, viewportTop) {
  if (!anchor) return 0;
  return (nowTop - viewportTop) - anchor.offset;
}
