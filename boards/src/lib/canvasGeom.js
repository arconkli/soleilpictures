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

// Clamp a card's top-left so the whole card stays inside the visible canvas
// bounds (canvas space). Guards left/top AND right/bottom so a drop near an
// edge doesn't land partly off-screen. `bounds` = { minX, minY, maxX, maxY };
// pass null to only floor at (8,8). Defensive: if bounds are smaller than the
// card, pin to the top-left edge rather than emitting negatives/NaN.
export function clampDropRect(rect, bounds) {
  const w = Math.max(0, rect?.w || 0);
  const h = Math.max(0, rect?.h || 0);
  let x = rect?.x ?? 0;
  let y = rect?.y ?? 0;
  const minX = Number.isFinite(bounds?.minX) ? bounds.minX : 8;
  const minY = Number.isFinite(bounds?.minY) ? bounds.minY : 8;
  if (bounds && Number.isFinite(bounds.maxX) && bounds.maxX - w > minX) x = Math.min(x, bounds.maxX - w);
  if (bounds && Number.isFinite(bounds.maxY) && bounds.maxY - h > minY) y = Math.min(y, bounds.maxY - h);
  x = Math.max(minX, x);
  y = Math.max(minY, y);
  return { ...rect, x: Math.round(x), y: Math.round(y), w, h };
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
