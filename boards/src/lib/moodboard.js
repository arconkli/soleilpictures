// Auto-moodboard layout — colour-ordered masonry.
//
// arrangeInFreeSpace() (canvasGeom.js:36) packs a burst into a uniform grid.
// That's the right answer for mixed content dropped on a canvas, but it's the
// wrong answer for a wall of photographs: every cell is clamped to the largest
// item, so a portrait frame next to a landscape frame leaves a visible hole, and
// arrival order puts a sunlit exterior beside a night interior.
//
// This module does two things instead:
//
//   1. ORDER by colour (oklab.js) so the sequence flows rather than jumps.
//   2. PACK column-major, each column taking a CONTIGUOUS run of that sequence.
//
// Column-major with contiguous runs is the key choice. Filling row-major would
// put the two most distant colours vertically adjacent at every line wrap. Going
// down each column instead means one column ≈ one colour family, and the board
// reads left-to-right as a deliberate palette sweep. Columns are balanced by
// HEIGHT rather than count, so mixed aspect ratios come out level at the bottom.
//
// Pure and dependency-light so it can run in the browser (a future "arrange
// these photos" command), in the Worker, and in the Node ingest service.

import { boundsOfCards } from './canvasGeom.js';
import { orderByColor } from './oklab.js';

const GAP = 24;
const MAX_COLS = 6;

const overlaps = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Only cards with real, finite geometry can participate in collision math. A
// card carrying NaN or a missing width would poison boundsOfCards() and make
// every subsequent placement garbage — and such a card can't render anyway.
export function withGeometry(cards) {
  return (cards || []).filter((c) => (
    Number.isFinite(c?.x) && Number.isFinite(c?.y)
    && Number.isFinite(c?.w) && Number.isFinite(c?.h)
    && c.w > 0 && c.h > 0
  ));
}

// HARD GUARANTEE that a bot write never lands on top of existing work.
//
// Layout anchors below the bounding box of what it was given, which is correct —
// but only as correct as its inputs. A card the caller filtered out, a stale
// read, or a collaborator adding cards between our read and our write can all
// leave a new card sitting on someone's existing one, and a bot write has no
// undo story. So after laying out, we verify, and push the whole batch down
// until nothing intersects.
//
// Shifting the batch as ONE unit preserves the grid the layout just produced.
// Monotonic (shift only ever grows) and iteration-bounded, so it always
// terminates even against pathological input.
export function pushClearOf(existing, placed, gap = GAP) {
  const solid = withGeometry(existing);
  if (!solid.length || !placed.length) return placed;

  let shift = 0;
  for (let pass = 0; pass < 64; pass++) {
    let push = 0;
    for (const card of placed) {
      const rect = { x: card.x, y: card.y + shift, w: card.w, h: card.h };
      for (const e of solid) {
        if (overlaps(rect, e)) push = Math.max(push, (e.y + e.h + gap) - rect.y);
      }
    }
    if (push <= 0) break;
    shift += push;
  }
  return shift > 0 ? placed.map((c) => ({ ...c, y: Math.round(c.y + shift) })) : placed;
}

// Bounding box of a laid-out block. The preview renderer needs this to know what
// area to draw, and callers need it to position a section header.
export function blockBounds(cards) {
  const solid = withGeometry(cards);
  if (!solid.length) return null;
  let x = Infinity; let y = Infinity; let r = -Infinity; let b = -Infinity;
  for (const c of solid) {
    x = Math.min(x, c.x); y = Math.min(y, c.y);
    r = Math.max(r, c.x + c.w); b = Math.max(b, c.y + c.h);
  }
  return { x, y, w: r - x, h: b - y, right: r, bottom: b };
}

// Squarish by default. ceil(sqrt(n)) gives 6→3, 12→4, 20→5; capped at 6 because
// a wider block stops reading as one object on a phone screen and starts
// marching off the side of the canvas.
export function columnCount(n, maxCols = MAX_COLS) {
  if (n <= 1) return 1;
  return Math.max(1, Math.min(maxCols, Math.ceil(Math.sqrt(n))));
}

// Split an ordered list into `cols` CONTIGUOUS chunks of roughly equal stacked
// height. Contiguity is non-negotiable — it's what keeps each column a single
// colour family. Every column is guaranteed at least one item, so we never emit
// a layout with a visible empty gutter.
export function partitionByHeight(items, cols, gap = GAP) {
  const n = items.length;
  if (cols <= 1 || n <= 1) return [items.slice()];
  const k = Math.min(cols, n);

  const total = items.reduce((s, it) => s + (it.h || 0) + gap, 0);
  const target = total / k;

  const out = [];
  let i = 0;
  for (let col = 0; col < k; col++) {
    const colsLeft = k - col - 1;
    // Reserve one item for each remaining column.
    const maxTake = n - i - colsLeft;
    if (col === k - 1) { out.push(items.slice(i)); break; }

    let taken = 0;
    let h = 0;
    // Always take at least one, then keep taking while the column is short of
    // target. Overshoot check: stop before an item that would push us further
    // past target than stopping would leave us short — that's what keeps the
    // last column from collecting every leftover.
    while (taken < maxTake) {
      const next = (items[i + taken].h || 0) + gap;
      if (taken > 0 && h + next - target > target - h) break;
      h += next;
      taken++;
      if (h >= target) break;
    }
    out.push(items.slice(i, i + Math.max(1, taken)));
    i += Math.max(1, taken);
  }
  return out;
}

// Lay out a colour-ordered masonry block below whatever is already on the board.
//
//   existingCards — current board contents (for the non-overlap anchor)
//   items         — cards with intrinsic { w, h } and optional { color } in OKLab
//   opts.reserveTop — vertical room to leave above the block (a section header)
//   opts.preordered — skip the colour sort (caller already ordered them)
//
// Returns the items with integer x/y, in COLUMN-MAJOR reading order.
export function layoutMoodboard(existingCards, items, opts = {}) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return [];

  const gap = opts.gap ?? GAP;
  const margin = opts.margin ?? 80;
  const startBelowGap = opts.startBelowGap ?? 64;
  const reserveTop = opts.reserveTop ?? 0;

  const ordered = opts.preordered ? list : orderByColor(list);

  const solid = withGeometry(existingCards);
  const bounds = boundsOfCards(solid);
  const startX = bounds ? bounds.x : margin;
  const startY = (bounds ? bounds.bottom + startBelowGap : margin) + reserveTop;

  const cols = columnCount(ordered.length, opts.maxCols ?? MAX_COLS);
  const chunks = partitionByHeight(ordered, cols, gap);

  // One uniform column width across the whole block. Per-column widths would
  // give a ragged right edge on every column boundary, which reads as broken
  // rather than as organic.
  const colW = Math.max(1, ...ordered.map((it) => it.w || 0));

  const placed = [];
  chunks.forEach((chunk, col) => {
    const x0 = startX + col * (colW + gap);
    let y = startY;
    for (const it of chunk) {
      const w = it.w || colW;
      const h = it.h || 0;
      placed.push({
        ...it,
        x: Math.max(8, Math.round(x0 + (colW - w) / 2)),
        y: Math.max(8, Math.round(y)),
      });
      y += h + gap;
    }
  });

  return pushClearOf(solid, placed, gap);
}
