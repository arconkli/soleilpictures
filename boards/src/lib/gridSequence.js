// Grid sequence math — spatial ordering + label-variable resolution. Pure (no
// React, no Yjs) so the QA bridge (?gridqa=1 → window.__soleilGridTest) and
// Playwright drive it directly. Mirrors the lib/snapGuides.js style (frozen
// SEQ_TUNING + pure exports).
//
// Order is SPATIAL: a sequence's running number is derived from where its Grids
// sit on the canvas, read in a chosen pattern. So inserting a Grid between two
// others just changes positions → recompute → everything after it renumbers,
// with no manual order list to maintain.
//   'z'     Z / reading order   — rows top→bottom, each row left→right
//   'n'     N / column-major    — columns left→right, each column top→bottom
//   'snake' boustrophedon       — like 'z' but alternate rows run right→left
//
// Label variables are inline tags a user drops into a cell; their VALUE is the
// Grid's index in its sequence (+ the sequence's startAt):
//   [#] → 1,2,3…   [##] → 01,02…   [###] → 001…   [A] → A,B,…,Z,AA…
// Literal text typed around a tag ("SHOT [#]", "Scene [#][A]") is the custom
// prefix/suffix — no separate config needed.

export const SEQ_TUNING = Object.freeze({
  ROW_EPS_PX: 40,   // y-center tolerance for banding Grids into the same row
                    //   (and x-center for columns in the 'n' pattern)
});

const centers = (grids) => grids.map((g) => ({ id: g.id, cx: g.x + g.w / 2, cy: g.y + g.h / 2 }));

// Band a sorted list into groups whose primary coord stays within eps of the
// group's first (smallest) member. Used for both rows (by cy) and columns (cx).
function band(sorted, key, eps) {
  const groups = [];
  for (const c of sorted) {
    const g = groups[groups.length - 1];
    if (g && c[key] - g.base <= eps) g.items.push(c);
    else groups.push({ base: c[key], items: [c] });
  }
  return groups;
}

// Ordered list of grid ids. `grids` = [{ id, x, y, w, h }].
export function spatialOrder(grids, pattern = 'z', tuning = SEQ_TUNING) {
  const eps = tuning.ROW_EPS_PX;
  const cs = centers(grids);
  const out = [];
  if (pattern === 'n') {
    const cols = band([...cs].sort((a, b) => a.cx - b.cx), 'cx', eps);
    for (const col of cols) {
      col.items.sort((a, b) => a.cy - b.cy);
      for (const it of col.items) out.push(it.id);
    }
    return out;
  }
  const rows = band([...cs].sort((a, b) => a.cy - b.cy), 'cy', eps);
  rows.forEach((row, ri) => {
    row.items.sort((a, b) => a.cx - b.cx);
    const items = (pattern === 'snake' && ri % 2 === 1) ? row.items.slice().reverse() : row.items;
    for (const it of items) out.push(it.id);
  });
  return out;
}

// 1→A, 26→Z, 27→AA, 28→AB … (bijective base-26).
function toAlpha(n) {
  let s = '';
  let x = n;
  while (x > 0) { x -= 1; s = String.fromCharCode(65 + (x % 26)) + s; x = Math.floor(x / 26); }
  return s || 'A';
}

// Render a 0-based index to a label string. format = { style, prefix, suffix,
// startAt }. style ∈ 'num' | 'pad2' | 'pad3' | 'alpha' (default 'num').
export function labelFor(index, format = {}) {
  const startAt = Number.isFinite(format.startAt) ? format.startAt : 1;
  const n = startAt + index;
  const style = format.style || 'num';
  let core;
  if (style === 'pad2') core = String(n).padStart(2, '0');
  else if (style === 'pad3') core = String(n).padStart(3, '0');
  else if (style === 'alpha') core = toAlpha(n);
  else core = String(n);
  return `${format.prefix || ''}${core}${format.suffix || ''}`;
}

// Substitute inline [#]/[##]/[###]/[A] tags inside a cell's text/html with the
// Grid's sequence value. Longest tokens first so [###] isn't eaten by [#].
export function resolveTagText(raw, { index = 0, format = {} } = {}) {
  const startAt = Number.isFinite(format.startAt) ? format.startAt : 1;
  return String(raw == null ? '' : raw)
    .replace(/\[###\]/g, () => labelFor(index, { style: 'pad3', startAt }))
    .replace(/\[##\]/g, () => labelFor(index, { style: 'pad2', startAt }))
    .replace(/\[#\]/g, () => labelFor(index, { style: 'num', startAt }))
    .replace(/\[A\]/g, () => labelFor(index, { style: 'alpha', startAt }));
}

// True if the text contains any recognized label tag (so the renderer only pays
// the substitution cost when needed).
export function hasLabelTag(raw) {
  return /\[#{1,3}\]|\[A\]/.test(String(raw == null ? '' : raw));
}

// Cheap memo key for spatialOrder — positions rounded so sub-px jitter doesn't
// bust the cache. Sorted so it's order-independent of the input array.
export function orderKey(grids, pattern) {
  return pattern + '|' + grids.map((g) => `${g.id}:${Math.round(g.x)}:${Math.round(g.y)}`).sort().join(',');
}
