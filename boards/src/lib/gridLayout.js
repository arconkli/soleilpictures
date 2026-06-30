// Grid (modular grid-template card) layout math — the fraction-tree engine.
// Extracted so the logic is unit-testable (?gridqa=1 → window.__soleilGridTest)
// and tunable in ONE place. Mirrors lib/snapGuides.js (SNAP_TUNING) /
// lib/arrowGeometry.js (ARROW_TUNING): the frozen GRID_TUNING below is the single
// source of truth, and every export is PURE (no React, no Yjs) so the QA bridge
// and Playwright can drive it directly.
//
// A Grid's layout is a fraction TREE. Two node kinds:
//   leaf:  { id, type:'leaf', frac }                         — a content cell
//   split: { type:'row'|'col', frac, children:[node…] }      — a divided box
// Semantics:
//   'row' = children laid out side-by-side → they divide the box WIDTH; the
//           dividers between them are vertical (drag on X). Each child `frac` is
//           its share of the parent's width.
//   'col' = children stacked top-to-bottom → they divide the box HEIGHT; dividers
//           are horizontal (drag on Y). Each child `frac` is its share of height.
// The root node has no meaningful `frac` (it fills the whole card box). A Grid can
// also be a single root leaf (one cell).
//
// All rects returned are in the Grid's LOCAL coordinate space ({x,y,w,h} relative
// to the card's own box); the renderer positions them inside the card and the
// canvas transform applies pan/zoom. Distances in GRID_TUNING are SCREEN px (the
// renderer divides by zoom where a constant on-screen feel is wanted).

export const GRID_TUNING = Object.freeze({
  MIN_FRAC: 0.08,        // a cell can't drop below this share of its parent axis
  MIN_CELL_PX: 24,       // absolute floor a cell shouldn't render below
  DIVIDER_PX: 8,         // divider hit/visual thickness (÷zoom at the use site)
  GUTTER_PX: 0,          // inner gap between cells (0 = contact-sheet look);
                         //   applied as a CSS inset by the renderer, NOT here, so
                         //   computeCellRects stays an exact tiling.
  EDGE_ADD_ZONE_PX: 24,  // hover band at a Grid's outer edge that reveals the +
  SNAP_PX: 6,            // divider-drag snap radius (÷zoom): lock onto aligned
                        //   lines + the equal-split (see dividerSnapTargets)
});

// ── tree helpers ───────────────────────────────────────────────────────────

let _seq = 0;
// Default cell-id generator. App code passes its own (mirroring docState's
// nextPageId); tests pass a deterministic counter. The random suffix guarantees
// cross-Grid uniqueness so a directional-stamped copy never collides.
function defaultMkId() {
  _seq += 1;
  return 'c' + _seq + '_' + Math.random().toString(36).slice(2, 7);
}

export function cloneNode(n) {
  if (!n) return n;
  if (n.type === 'leaf') return { type: 'leaf', id: n.id, frac: n.frac };
  return { type: n.type, frac: n.frac, children: (n.children || []).map(cloneNode) };
}

// Walk a path of child indices from the root to the addressed node.
function nodeAt(node, path) {
  let n = node;
  for (const i of (path || [])) {
    if (!n || !n.children) return null;
    n = n.children[i];
  }
  return n || null;
}

const leaf = (id, frac) => ({ type: 'leaf', id, frac });

// ── geometry ───────────────────────────────────────────────────────────────

// Flat list of cell rects { id, x, y, w, h, path } in LOCAL space. Children of a
// split are normalized on the fly (frac / Σfrac) so a tree whose fracs don't
// sum to exactly 1 still tiles its box without gap or overlap.
export function computeCellRects(tree, box, _tuning = GRID_TUNING) {
  const out = [];
  const walk = (node, b, path) => {
    if (!node) return;
    if (node.type === 'leaf') { out.push({ id: node.id, x: b.x, y: b.y, w: b.w, h: b.h, path }); return; }
    const kids = node.children || [];
    const sum = kids.reduce((s, c) => s + (c.frac || 0), 0) || 1;
    if (node.type === 'row') {
      let cx = b.x;
      kids.forEach((c, i) => { const w = b.w * (c.frac || 0) / sum; walk(c, { x: cx, y: b.y, w, h: b.h }, [...path, i]); cx += w; });
    } else {
      let cy = b.y;
      kids.forEach((c, i) => { const h = b.h * (c.frac || 0) / sum; walk(c, { x: b.x, y: cy, w: b.w, h }, [...path, i]); cy += h; });
    }
  };
  walk(tree, box, []);
  return out;
}

// Divider handles between adjacent children of every split, with the parent
// split's box extent along the drag axis (`parentExtent`) so a drag handler can
// convert a world-px delta into a frac delta: deltaFrac = deltaWorld / parentExtent.
export function collectDividers(tree, box, tuning = GRID_TUNING) {
  const out = [];
  const thick = tuning.DIVIDER_PX;
  const walk = (node, b, path) => {
    if (!node || node.type === 'leaf') return;
    const kids = node.children || [];
    const sum = kids.reduce((s, c) => s + (c.frac || 0), 0) || 1;
    if (node.type === 'row') {
      let cx = b.x;
      for (let i = 0; i < kids.length; i++) {
        const w = b.w * (kids[i].frac || 0) / sum;
        walk(kids[i], { x: cx, y: b.y, w, h: b.h }, [...path, i]);
        cx += w;
        if (i < kids.length - 1) out.push({ id: path.join('.') + '/' + i, axis: 'x', x: cx - thick / 2, y: b.y, w: thick, h: b.h, path, childIndex: i, parentExtent: b.w });
      }
    } else {
      let cy = b.y;
      for (let i = 0; i < kids.length; i++) {
        const h = b.h * (kids[i].frac || 0) / sum;
        walk(kids[i], { x: b.x, y: cy, w: b.w, h }, [...path, i]);
        cy += h;
        if (i < kids.length - 1) out.push({ id: path.join('.') + '/' + i, axis: 'y', x: b.x, y: cy - thick / 2, w: b.w, h: thick, path, childIndex: i, parentExtent: b.h });
      }
    }
  };
  walk(tree, box, []);
  return out;
}

// The shared-edge constraint that doesn't exist elsewhere in the app. Adjusts
// ONLY the two children adjacent to the dragged divider: child[childIndex] gains
// deltaFrac, child[childIndex+1] loses it, both clamped to MIN_FRAC, and their
// SUM is conserved exactly so the rest of the tree never moves. Returns a NEW
// tree; the original is untouched.
export function resizeDivider(tree, path, childIndex, deltaFrac, tuning = GRID_TUNING) {
  const next = cloneNode(tree);
  const node = nodeAt(next, path);
  if (!node || !node.children || childIndex < 0 || childIndex + 1 >= node.children.length) return tree;
  const a0 = node.children[childIndex].frac || 0;
  const b0 = node.children[childIndex + 1].frac || 0;
  const S = a0 + b0;
  if (S <= 0) return tree;
  const min = Math.min(tuning.MIN_FRAC, S / 2);
  let a = a0 + deltaFrac;
  a = Math.min(Math.max(a, min), S - min);
  node.children[childIndex].frac = a;
  node.children[childIndex + 1].frac = S - a;
  return next;
}

// In-place leaf replacement on a (mutable) clone. Handles the root being the leaf.
function replaceLeaf(root, id, fn) {
  if (root.type === 'leaf' && root.id === id) {
    const rep = fn(root);
    Object.keys(root).forEach((k) => delete root[k]);
    Object.assign(root, rep);
    return true;
  }
  if (root.children) {
    for (let i = 0; i < root.children.length; i++) {
      const c = root.children[i];
      if (c.type === 'leaf' && c.id === id) { root.children[i] = fn(c); return true; }
      if (c.children && replaceLeaf(c, id, fn)) return true;
    }
  }
  return false;
}

// Split a cell into two by replacing its leaf with a split of `orientation`
// ('row' = side-by-side / 'col' = stacked) holding the original leaf (kept id, at
// `at`) and a fresh leaf (1-at). normalizeTree then flattens a same-type nest so
// splitting a row-cell along the row reads as "added a sibling".
export function splitCell(tree, cellId, orientation, at = 0.5, mkId = defaultMkId) {
  const next = cloneNode(tree);
  const ok = replaceLeaf(next, cellId, (lf) => ({
    type: orientation === 'row' ? 'row' : 'col',
    frac: lf.frac,
    children: [leaf(lf.id, at), leaf(mkId(), 1 - at)],
  }));
  if (!ok) return tree;
  return normalizeTree(next);
}

// Remove a cell; its freed frac is redistributed proportionally to its siblings,
// and a split left with a single child collapses into that child. Returns
// { tree, removedIds } — removedIds is [cellId] on success, [] if it couldn't
// merge (e.g. the Grid is a single root cell).
export function mergeCell(tree, cellId) {
  const next = cloneNode(tree);
  const removed = [];
  const remove = (root) => {
    if (!root.children) return false;
    for (let i = 0; i < root.children.length; i++) {
      const c = root.children[i];
      if (c.type === 'leaf' && c.id === cellId) {
        if (root.children.length <= 1) return false;
        const gone = root.children.splice(i, 1)[0];
        removed.push(gone.id);
        const goneFrac = gone.frac || 0;
        const restSum = root.children.reduce((s, k) => s + (k.frac || 0), 0) || 1;
        root.children.forEach((k) => { k.frac = (k.frac || 0) + goneFrac * ((k.frac || 0) / restSum); });
        return true;
      }
      if (c.children && remove(c)) return true;
    }
    return false;
  };
  if (!remove(next)) return { tree, removedIds: [] };
  return { tree: normalizeTree(next), removedIds: removed };
}

// Remove the line (divider) at [path, childIndex]: merge the two children it
// separates by deleting child[childIndex+1] and giving its space to
// child[childIndex]. Returns { tree, removedIds } (the cells that disappeared).
export function removeDivider(tree, path, childIndex) {
  const next = cloneNode(tree);
  const node = nodeAt(next, path);
  if (!node || !node.children || childIndex < 0 || childIndex + 1 >= node.children.length) return { tree, removedIds: [] };
  const removed = leafIds(node.children[childIndex + 1]);
  const goneFrac = node.children[childIndex + 1].frac || 0;
  node.children.splice(childIndex + 1, 1);
  node.children[childIndex].frac = (node.children[childIndex].frac || 0) + goneFrac;
  return { tree: normalizeTree(next), removedIds: removed };
}

// Snap targets (absolute LOCAL coords along the dragged divider's axis) so a
// divider drag "locks" onto: (a) any other same-axis divider line — so columns /
// rows align across the Grid — and (b) the equal-split of the two cells it
// separates. The drag handler snaps the dragged line to the nearest within a px
// threshold. Pure → unit-testable.
export function dividerSnapTargets(tree, box, d, _tuning = GRID_TUNING) {
  const axis = d.axis;
  const lineOf = (x) => (axis === 'x' ? x.x + x.w / 2 : x.y + x.h / 2);
  const targets = new Set();
  for (const o of collectDividers(tree, box)) {
    if (o.id === d.id || o.axis !== axis) continue;
    targets.add(lineOf(o));
  }
  // Equal-split: midpoint of the union of the cells flush against this line.
  const line0 = lineOf(d);
  const c0 = axis === 'x' ? d.y : d.x;
  const c1 = axis === 'x' ? d.y + d.h : d.x + d.w;
  const start = (r) => (axis === 'x' ? r.x : r.y);
  const end = (r) => (axis === 'x' ? r.x + r.w : r.y + r.h);
  const cross0 = (r) => (axis === 'x' ? r.y : r.x);
  const cross1 = (r) => (axis === 'x' ? r.y + r.h : r.x + r.w);
  let lo = null, hi = null;
  for (const r of computeCellRects(tree, box)) {
    if (cross0(r) >= c1 - 0.5 || cross1(r) <= c0 + 0.5) continue; // not in this band
    if (Math.abs(end(r) - line0) < 1.5) lo = (lo == null) ? start(r) : Math.min(lo, start(r));
    if (Math.abs(start(r) - line0) < 1.5) hi = (hi == null) ? end(r) : Math.max(hi, end(r));
  }
  if (lo != null && hi != null) targets.add((lo + hi) / 2);
  return [...targets];
}

export function leafIds(tree) {
  const out = [];
  const w = (n) => { if (!n) return; if (n.type === 'leaf') { out.push(n.id); return; } (n.children || []).forEach(w); };
  w(tree);
  return out;
}

// Tidy a tree: flatten a split nested inside a same-type split (distributing
// frac), collapse single-child splits, and renormalize each split's children to
// sum 1. Pure — returns a new tree.
export function normalizeTree(tree, _tuning = GRID_TUNING) {
  const norm = (node) => {
    if (!node || node.type === 'leaf') return node;
    node.children = (node.children || []).map(norm);
    const flat = [];
    for (const c of node.children) {
      if (c.type === node.type && c.children) {
        const cf = c.frac || 0;
        const csum = c.children.reduce((s, k) => s + (k.frac || 0), 0) || 1;
        for (const k of c.children) flat.push({ ...k, frac: (k.frac || 0) / csum * cf });
      } else flat.push(c);
    }
    node.children = flat;
    if (node.children.length === 1) {
      const only = node.children[0];
      only.frac = node.frac;
      return only;
    }
    const sum = node.children.reduce((s, c) => s + (c.frac || 0), 0) || 1;
    node.children.forEach((c) => { c.frac = (c.frac || 0) / sum; });
    return node;
  };
  return norm(cloneNode(tree));
}

// ── presets ────────────────────────────────────────────────────────────────

export const PRESETS = Object.freeze([
  { id: 'storyboard-1-2', label: 'Storyboard · 1 top / 2 bottom' },
  { id: 'db-row-1-3', label: 'Database row · 1 left / 3 stacked' },
  { id: '2x2', label: '2 × 2' },
  { id: '3up', label: '3 across' },
  { id: 'single', label: 'Single cell' },
]);

export function presetTree(name, mkId = defaultMkId) {
  switch (name) {
    case 'storyboard-1-2':
      return { type: 'col', children: [leaf(mkId(), 0.5), { type: 'row', frac: 0.5, children: [leaf(mkId(), 0.5), leaf(mkId(), 0.5)] }] };
    case 'db-row-1-3':
      return { type: 'row', children: [leaf(mkId(), 0.5), { type: 'col', frac: 0.5, children: [leaf(mkId(), 1 / 3), leaf(mkId(), 1 / 3), leaf(mkId(), 1 / 3)] }] };
    case '2x2':
      return { type: 'row', children: [
        { type: 'col', frac: 0.5, children: [leaf(mkId(), 0.5), leaf(mkId(), 0.5)] },
        { type: 'col', frac: 0.5, children: [leaf(mkId(), 0.5), leaf(mkId(), 0.5)] },
      ] };
    case '3up':
      return { type: 'row', children: [leaf(mkId(), 1 / 3), leaf(mkId(), 1 / 3), leaf(mkId(), 1 / 3)] };
    case 'single':
    default:
      return leaf(mkId(), 1);
  }
}
