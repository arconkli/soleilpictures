// Shared geometry helpers for the canvas — used by multi-selection
// resize and any other code that needs to reason about the union rect
// of a set of cards.

export function boundsOfCards(cards) {
  if (!cards || cards.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cards) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x + c.w > maxX) maxX = c.x + c.w;
    if (c.y + c.h > maxY) maxY = c.y + c.h;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, right: maxX, bottom: maxY };
}

// Returns the canvas-space anchor for a given handle on a bounds rect.
// The anchor is the *opposite* corner / midpoint so dragging a handle
// scales away from it.
//   handle: 'tl' 'tm' 'tr' 'mr' 'br' 'bm' 'bl' 'ml'
export function oppositeCorner(handle, bounds) {
  const { x, y, right, bottom } = bounds;
  const cx = (x + right) / 2;
  const cy = (y + bottom) / 2;
  switch (handle) {
    case 'tl': return { x: right, y: bottom, axisX: true, axisY: true };
    case 'tm': return { x: cx,    y: bottom, axisX: false, axisY: true };
    case 'tr': return { x: x,     y: bottom, axisX: true, axisY: true };
    case 'mr': return { x: x,     y: cy,     axisX: true, axisY: false };
    case 'br': return { x: x,     y: y,      axisX: true, axisY: true };
    case 'bm': return { x: cx,    y: y,      axisX: false, axisY: true };
    case 'bl': return { x: right, y: y,      axisX: true, axisY: true };
    case 'ml': return { x: right, y: cy,     axisX: true, axisY: false };
    default:   return { x: right, y: bottom, axisX: true, axisY: true };
  }
}
