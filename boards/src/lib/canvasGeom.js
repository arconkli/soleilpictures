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

// Lay out a batch of NEW cards into a tidy uniform grid anchored in
// guaranteed-free canvas space — WITHOUT needing a viewport or cursor point.
// This is what makes list-view file drops possible: the list surface has no
// pan/zoom to convert a drop point, but placement can be computed purely in
// doc space. The block is anchored strictly BELOW the bounding box of the
// existing cards, so on an infinite canvas it can never overlap them (no
// expensive interior gap-search needed).
//
//   existingCards — the cluster's current cards (each with numeric x,y,w,h)
//   items         — new cards in drop/list order, each carrying intrinsic {w,h}
//   opts.gap          — px between cells (default 24)
//   opts.startBelowGap— px below existing content to start (default 48)
//   opts.maxCols      — column cap so N files never march off-screen (default 12)
//   opts.margin       — top-left origin on an EMPTY board (default 80, the
//                       x=60/y=60 default family used by addNote/addNewBoard)
//   opts.jitterX      — optional per-client x offset to de-collide two
//                       collaborators dropping at the same anchor simultaneously
//
// Returns the items with integer x/y added (list order == reading order).
export function arrangeInFreeSpace(existingCards, items, opts = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const gap = opts.gap ?? 24;
  const startBelowGap = opts.startBelowGap ?? 48;
  const maxCols = Math.max(1, opts.maxCols ?? 12);
  const margin = opts.margin ?? 80;
  const jitterX = opts.jitterX ?? 0;

  const bounds = boundsOfCards(existingCards);
  const startX = (bounds ? bounds.x : margin) + jitterX;
  const startY = bounds ? bounds.bottom + startBelowGap : margin;

  // Bounded columns — a squarish block that never marches off-screen. 5 → 3
  // cols, 100 → 10 cols, 400 → capped at 12. (Replaces the old unbounded
  // horizontal stagger that pushed the Nth file 260·N px to the right.)
  const cols = Math.max(1, Math.min(maxCols, Math.ceil(Math.sqrt(list.length))));

  // One uniform cell for the whole batch so mixed types (image 320×240,
  // pdf 300×388, video ~360×202, audio 380×130) line up in a clean matrix;
  // each item is centered in its cell so its real w/h is preserved.
  let maxW = 0, maxH = 0;
  for (const it of list) {
    if ((it.w || 0) > maxW) maxW = it.w || 0;
    if ((it.h || 0) > maxH) maxH = it.h || 0;
  }
  const cellW = Math.min(320, Math.max(120, maxW || 240));
  const cellH = Math.min(300, Math.max(100, maxH || 200));

  return list.map((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellX = startX + col * (cellW + gap);
    const cellY = startY + row * (cellH + gap);
    const w = it.w || cellW;
    const h = it.h || cellH;
    // No viewport clamp: clampDropRect keeps a drop on-screen relative to a
    // viewport, but the list has none and the region is free by construction.
    // Only floor at 8 (matches the rest of the codebase: Math.max(8, round)).
    const x = Math.max(8, Math.round(cellX + (cellW - w) / 2));
    const y = Math.max(8, Math.round(cellY + (cellH - h) / 2));
    return { ...it, x, y };
  });
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
