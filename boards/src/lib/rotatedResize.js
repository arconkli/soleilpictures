// Resizing a rotated card (CanvasSurface onResizePointerDown).
//
// A card is drawn at (x, y, w, h) and turned about its centre by `rotation`
// degrees (CSS rotate, clockwise on screen, y down). Its resize corner is the
// card's own bottom-right, so the pointer's screen delta has to be read in the
// card's frame (dragging "outward" along the turned edge grows the card), and
// growing w/h about the centre would slide the opposite corner, so x/y move to
// keep the card's own top-left corner fixed in board space.
//
// Rotation 0 returns the input unchanged and an offset of exactly 0, so an
// unturned card resizes exactly as before.

const rad = (deg) => ((Number(deg) || 0) % 360) * Math.PI / 180;

// Screen/board delta → the card's own frame (rotate by -rotation).
export function deltaInCardFrame(dx, dy, rotation) {
  const r = rad(rotation);
  if (!r) return { dx, dy };
  const cos = Math.cos(r), sin = Math.sin(r);
  return { dx: cos * dx + sin * dy, dy: -sin * dx + cos * dy };
}

// How far x/y move when the card's size changes by (dw, dh) — the real,
// clamped change — so its own top-left corner stays where it is.
export function anchoredResizeOffset(dw, dh, rotation) {
  const r = rad(rotation);
  if (!r) return { dx: 0, dy: 0 };
  const cos = Math.cos(r), sin = Math.sin(r);
  const hw = dw / 2, hh = dh / 2;
  return { dx: cos * hw - sin * hh - hw, dy: sin * hw + cos * hh - hh };
}
