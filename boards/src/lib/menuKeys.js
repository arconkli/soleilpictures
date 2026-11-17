// Where a key moves the focus in a menu (the WAI-ARIA menu's keys), for
// components/toolbar/Menu.jsx. Pure: the menu hands over its rows.

// ↓ ↑ to the next and the previous row, round from the last to the first;
// Home and End to either end. `index` is the focused row's, -1 for the menu
// itself (just opened from a press), from where ↓ is the first row and ↑ the
// last. Any other key isn't the menu's: null.
export function menuMove(key, index, count) {
  if (!count) return null;
  switch (key) {
    case 'ArrowDown': return index < 0 ? 0 : (index + 1) % count;
    case 'ArrowUp': return index < 0 ? count - 1 : (index - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

// A letter: the next row, after the focused one and round from the end, whose
// words start with it.
export function menuTypeahead(ch, labels, index) {
  const c = String(ch || '').toLowerCase();
  if (!c.trim()) return null;
  const n = labels.length;
  for (let k = 1; k <= n; k++) {
    const j = (Math.max(index, -1) + k) % n;
    if (String(labels[j] || '').trim().toLowerCase().startsWith(c)) return j;
  }
  return null;
}

// ── The one right-click menu (components/CardContextMenu.jsx) ──
// A label as typed: lower-cased for the locale, without a leading "…" or quote.
const norm = (s) => String(s ?? '').trim().replace(/^[\s…."'“”‘’«»]+/, '').toLocaleLowerCase();

// Index of the next row after `current` (wrapping) whose label starts with
// `query`; -1 = no move. A query of one letter repeated ("ss") cycles the rows
// that start with that letter. `current` may be -1 (nothing focused yet).
export function typeaheadIndex(labels, current, query) {
  const n = labels?.length || 0;
  const q = norm(query);
  if (!n || !q) return -1;
  const chars = [...q];
  const key = chars.every((c) => c === chars[0]) ? chars[0] : q;
  const start = current < 0 ? 0 : current + 1;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (norm(labels[i]).startsWith(key)) return i;
  }
  return -1;
}

// Is `point` inside the triangle from `origin` (the pointer where it left the
// row) to the flyout's near edge, top and bottom, widened by `slack` px? The
// flyout's own box counts as inside. `side` is the side of the menu the flyout
// opened on: 'right' (its near edge is rect.left) or 'left' (rect.right).
export function inSafeTriangle(point, origin, rect, side, slack = 4) {
  if (!point || !origin || !rect) return false;
  if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) return true;
  const nearX = side === 'left' ? rect.right : rect.left;
  const a = origin;
  const b = { x: nearX, y: rect.top - slack };
  const c = { x: nearX, y: rect.bottom + slack };
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(a, b, point);
  const d2 = cross(b, c, point);
  const d3 = cross(c, a, point);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// Divider rules: headers become dividers (their text is never shown); no
// divider first or last; never two in a row; a caption followed by nothing, or
// by a divider, is dropped.
export function tidyMenu(items) {
  const src = (items || []).filter(Boolean).map((it) => (it.header !== undefined ? { divider: true } : it));
  const noCaps = src.filter((it, i) => {
    if (it.caption === undefined) return true;
    const next = src[i + 1];
    return !!next && !next.divider;
  });
  const out = [];
  for (const it of noCaps) {
    if (it.divider && (!out.length || out[out.length - 1].divider)) continue;
    out.push(it);
  }
  while (out.length && out[out.length - 1].divider) out.pop();
  return out;
}
