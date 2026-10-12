// Drawings on a video frame, as stored on a frame comment's `annotation`
// (migration 0402). Coordinates are integers 0–10000 across the PICTURE —
// the video's own frame, not the player box around it — so a drawing lands on
// the same spot at any player size, letterboxed or not.
//
//   { v: 1, ar: <picture width / height>, items: [
//       { t: 'pen',   c: '#ff4d4f', w: 40, p: [[x, y], …] },
//       { t: 'arrow', c, w, a: [x, y], b: [x, y] },
//       { t: 'rect',  c, w, a: [x, y], b: [x, y] } ] }
//
// `w` is the stroke width in the same 0–10000 units. Pure (frameAnnotation.test.mjs).

export const SCALE = 10000;
export const MAX_ITEMS = 100;
export const MAX_POINTS = 400;
// Review colours — never the brand gold, which means "selected" in this app.
export const PEN_COLORS = ['#ff4d4f', '#ff9f1a', '#3d8bff', '#2fbf71', '#ffffff', '#111111'];

// Where a picture of aspect `ar` (w/h) sits inside a box, object-fit: contain.
export function containRect(boxW, boxH, ar) {
  if (!(boxW > 0 && boxH > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  if (!(ar > 0)) return { x: 0, y: 0, w: boxW, h: boxH };
  const boxAr = boxW / boxH;
  if (ar > boxAr) {
    const h = boxW / ar;
    return { x: 0, y: (boxH - h) / 2, w: boxW, h };
  }
  const w = boxH * ar;
  return { x: (boxW - w) / 2, y: 0, w, h: boxH };
}

const clampUnit = (v) => Math.max(0, Math.min(SCALE, Math.round(v)));

// Box pixels → picture units, and back.
export function toUnits(px, py, rect) {
  return [clampUnit(((px - rect.x) / (rect.w || 1)) * SCALE), clampUnit(((py - rect.y) / (rect.h || 1)) * SCALE)];
}
export function fromUnits(ux, uy, rect) {
  return [rect.x + (ux / SCALE) * rect.w, rect.y + (uy / SCALE) * rect.h];
}

// Ramer–Douglas–Peucker in picture units, tightening until ≤ max points.
export function simplify(points, max = MAX_POINTS) {
  if (!Array.isArray(points) || points.length <= 2) return points || [];
  let eps = 4;
  let out = points;
  for (let i = 0; i < 12 && out.length > max; i++, eps *= 2) out = rdp(points, eps);
  if (out.length > max) {
    // Still too many (a scribble): keep every k-th, and the ends.
    const k = Math.ceil(out.length / max);
    out = out.filter((_, j) => j % k === 0 || j === out.length - 1);
  }
  return out === points ? rdp(points, 4) : out;
}

function rdp(pts, eps) {
  if (pts.length <= 2) return pts;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  let far = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
    if (d > far) { far = d; idx = i; }
  }
  if (far <= eps) return [pts[0], pts[pts.length - 1]];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return [...left.slice(0, -1), ...right];
}

// A drawing made of `items`, ready to store — or null when there's nothing
// on it. Drops malformed items, clamps everything into range.
export function buildAnnotation(items, ar) {
  const out = [];
  for (const it of items || []) {
    if (!it || out.length >= MAX_ITEMS) continue;
    const c = PEN_COLORS.includes(it.c) ? it.c : PEN_COLORS[0];
    const w = Math.max(5, Math.min(400, Math.round(it.w || 40)));
    if (it.t === 'pen') {
      const p = simplify((it.p || []).filter((q) => Array.isArray(q) && q.length >= 2).map(([x, y]) => [clampUnit(x), clampUnit(y)]));
      if (p.length >= 2) out.push({ t: 'pen', c, w, p });
    } else if (it.t === 'arrow' || it.t === 'rect') {
      if (!Array.isArray(it.a) || !Array.isArray(it.b)) continue;
      const a = [clampUnit(it.a[0]), clampUnit(it.a[1])];
      const b = [clampUnit(it.b[0]), clampUnit(it.b[1])];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 20) continue;   // a click, not a shape
      out.push({ t: it.t, c, w, a, b });
    }
  }
  if (!out.length) return null;
  return { v: 1, ar: Number.isFinite(ar) && ar > 0 ? Math.round(ar * 10000) / 10000 : null, items: out };
}

// A stored drawing, made safe to render (anything unexpected dropped).
export function readAnnotation(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || !Array.isArray(raw.items)) return null;
  return buildAnnotation(raw.items, raw.ar);
}

// The head of an arrow from a to b, for drawing: two short wings.
export function arrowHead(a, b, size) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const s = size;
  return [
    [b[0] - s * Math.cos(ang - Math.PI / 7), b[1] - s * Math.sin(ang - Math.PI / 7)],
    [b[0] - s * Math.cos(ang + Math.PI / 7), b[1] - s * Math.sin(ang + Math.PI / 7)],
  ];
}
