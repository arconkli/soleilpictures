// Arranging cards so a pile of images reads as a composition.
//
// WHY THIS EXISTS. Layout used to happen only as a side effect: omit x and y on
// a card write and `arrangeInFreeSpace` packed the batch into a UNIFORM grid —
// one cell size for the whole lot, every item centred in its cell. That is the
// right answer for mixed content (an image, a PDF, an audio clip) and the wrong
// one for a wall of photographs, because the cell is clamped to the largest
// item and every portrait frame then sits in a hole. Meanwhile the good
// algorithm, `layoutMoodboard`, could not be reached from the API at all.
//
// So: one engine, one vocabulary of NAMED layouts, shared by the Worker, the
// canvas and the Scout ingest service. Pure and dependency-light for exactly
// that reason — esbuild, vite and plain Node all have to import it.
//
//   justified  rows of equal height, widths from each picture's real aspect,
//              flush on BOTH edges. The default, and what Flickr, Unsplash and
//              Google Photos all use, because it is the only one of these with
//              no holes in it.
//   masonry    colour-ordered, height-balanced columns (layoutMoodboard).
//   grid       uniform cells (arrangeInFreeSpace). Best for mixed KINDS.
//   row        one line, left to right.
//   column     one line, top to bottom.
//
// Both existing algorithms are called here rather than reimplemented: they are
// already correct and already covered by tests/scout-*.spec.js.

import { boundsOfCards, arrangeInFreeSpace } from './canvasGeom.js';
import { layoutMoodboard, blockBounds, withGeometry, pushClearOf } from './moodboard.js';

export const LAYOUTS = ['justified', 'masonry', 'grid', 'row', 'column'];
export const DEFAULT_LAYOUT = 'justified';

export const LAYOUT_GAP = 24;

// The height a row aims for before it is solved to fit the width. Roughly a
// third of a laptop viewport: big enough to read a frame, small enough that a
// dozen photographs are one glance rather than a scroll.
export const TARGET_ROW_HEIGHT = 260;

// How far the LAST row may be stretched above the target. A final row holding
// one photograph would otherwise be solved to the full container width and
// tower over everything above it — the single most recognisable way this
// algorithm is got wrong.
const LAST_ROW_MAX_STRETCH = 1.35;

// A picture whose aspect is outside this is almost always a broken or
// placeholder dimension, and left unclamped one of them flattens an entire row.
const MIN_ASPECT = 0.2;
const MAX_ASPECT = 5;
const FALLBACK_ASPECT = 4 / 3;

const MARGIN = 80;
const START_BELOW_GAP = 48;
const FLOOR = 8;

// What a card with no usable dimensions becomes. Matches the note default the
// API already applies in normalizeIncomingCard.
const DEFAULT_CARD_W = 280;
const DEFAULT_CARD_H = 180;

export const isLayout = (name) => LAYOUTS.includes(name);

function aspectOf(item) {
  const w = Number(item?.w);
  const h = Number(item?.h);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return FALLBACK_ASPECT;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, w / h));
}

/**
 * The width the block is solved against.
 *
 * A canvas has no edges, so unlike every web gallery that implements justified
 * rows there is no container to read this from — it is a CHOICE, and the wrong
 * choice is what turns forty photographs into a twelve-thousand-pixel strip.
 *
 * Solving for a roughly square block: total area ≈ n·rowHeight²·meanAspect, so
 * the side of an equivalent square is rowHeight·√(n·meanAspect).
 */
export function naturalWidth(items, rowHeight = TARGET_ROW_HEIGHT) {
  const n = items.length;
  if (n <= 1) return Math.round(rowHeight * aspectOf(items[0] || {}));
  const meanAspect = items.reduce((s, it) => s + aspectOf(it), 0) / n;
  return Math.round(rowHeight * Math.sqrt(n * meanAspect));
}

/**
 * Justified rows, relative to (0, 0).
 *
 * Fill a row until it is at least as wide as the container at the target
 * height, then solve the row height exactly so it lands flush:
 * `rowH = (width − (n−1)·gap) / Σaspect`. Because a row is only closed once it
 * has OVERFLOWED, every solved height is ≤ the target — rows shrink to fit and
 * never grow, so nothing ever exceeds the container.
 */
export function justifiedRows(items, { width, gap = LAYOUT_GAP, rowHeight = TARGET_ROW_HEIGHT } = {}) {
  const list = items || [];
  if (!list.length) return [];

  const aspects = list.map(aspectOf);
  const W = Math.max(rowHeight, Number(width) || naturalWidth(list, rowHeight));

  const rows = [];
  let row = [];
  let sum = 0;
  for (let i = 0; i < list.length; i++) {
    row.push(i);
    sum += aspects[i];
    if (sum * rowHeight + (row.length - 1) * gap >= W) {
      rows.push(row);
      row = [];
      sum = 0;
    }
  }
  if (row.length) rows.push(row);

  // Positions are integers, and rounding each SIZE independently is what makes
  // a tiling overlap: two neighbours can each round up and claim the same
  // pixel. With a 24px gap that is invisible; with gap 0 it is a real overlap.
  // So round the BOUNDARIES and let each width and height be the difference
  // between its own two edges — the standard way to tile exactly.
  const out = new Array(list.length);
  let y = 0;
  rows.forEach((indices, ri) => {
    const sumAspect = indices.reduce((s, i) => s + aspects[i], 0) || 1;
    const available = W - (indices.length - 1) * gap;
    let h = available / sumAspect;
    // The last row is left as it falls rather than stretched to the edge.
    if (ri === rows.length - 1) h = Math.min(h, rowHeight * LAST_ROW_MAX_STRETCH);
    h = Math.max(1, h);

    const top = Math.round(y);
    const bottom = Math.round(y + h);
    let x = 0;
    for (const i of indices) {
      const w = aspects[i] * h;
      const left = Math.round(x);
      const right = Math.round(x + w);
      out[i] = {
        ...list[i],
        x: left,
        y: top,
        w: Math.max(1, right - left),
        h: Math.max(1, bottom - top),
      };
      x += w + gap;
    }
    y += h + gap;
  });
  return out;
}

// One line. Cross-axis centring so mixed heights read as a row rather than as
// a set of things that happen to share a top edge.
function line(items, { gap = LAYOUT_GAP, vertical = false } = {}) {
  const list = items || [];
  if (!list.length) return [];
  const sizeOf = (it) => ({
    w: Number.isFinite(it?.w) && it.w > 0 ? it.w : 280,
    h: Number.isFinite(it?.h) && it.h > 0 ? it.h : 180,
  });
  const extent = Math.max(...list.map((it) => (vertical ? sizeOf(it).w : sizeOf(it).h)));
  let run = 0;
  return list.map((it) => {
    const { w, h } = sizeOf(it);
    const placed = vertical
      ? { x: Math.round((extent - w) / 2), y: Math.round(run) }
      : { x: Math.round(run), y: Math.round((extent - h) / 2) };
    run += (vertical ? h : w) + gap;
    return { ...it, ...placed, w, h };
  });
}

// Normalise a laid-out block so its top-left sits at (0, 0). Lets the two
// pre-existing algorithms — which each anchor themselves — be reused unchanged
// and then re-anchored by this module.
function toOrigin(placed) {
  const b = blockBounds(placed);
  if (!b) return placed;
  return placed.map((c) => ({ ...c, x: c.x - b.x, y: c.y - b.y }));
}

/**
 * Positions relative to (0, 0), for one named layout. Exported so a caller can
 * measure a block before deciding where to put it.
 */
export function relativeLayout(items, opts = {}) {
  // Give every item a usable size FIRST. A card with a missing or zero
  // dimension cannot be packed — it has no extent to pack around — and the
  // layouts that preserve size (everything except justified) would otherwise
  // emit a 0×0 card sitting invisibly underneath its neighbour. Dropping it
  // instead would lose someone's card to a layout preference.
  const list = (items || []).filter(Boolean).map((it) => (
    Number.isFinite(it.w) && it.w > 0 && Number.isFinite(it.h) && it.h > 0
      ? it
      : { ...it, w: DEFAULT_CARD_W, h: DEFAULT_CARD_H }));
  if (!list.length) return [];
  const gap = Number.isFinite(opts.gap) ? Math.max(0, opts.gap) : LAYOUT_GAP;

  switch (opts.layout) {
    case 'masonry':
      // layoutMoodboard anchors itself and colour-orders on the way through.
      return toOrigin(layoutMoodboard(null, list, {
        gap, margin: 0, startBelowGap: 0, preordered: opts.preordered === true,
        ...(Number.isFinite(opts.columns) ? { maxCols: Math.max(1, opts.columns) } : {}),
      }));
    case 'grid':
      return toOrigin(arrangeInFreeSpace(null, list, {
        gap, margin: 0, startBelowGap: 0,
        ...(Number.isFinite(opts.columns) ? { maxCols: Math.max(1, opts.columns) } : {}),
      }));
    case 'row':
      return line(list, { gap, vertical: false });
    case 'column':
      return line(list, { gap, vertical: true });
    case 'justified':
    default:
      return justifiedRows(list, {
        gap,
        width: opts.width,
        rowHeight: Number.isFinite(opts.rowHeight) ? Math.max(40, opts.rowHeight) : TARGET_ROW_HEIGHT,
      });
  }
}

/**
 * Lay `items` out and place the block on the board.
 *
 * `origin`:
 *   omitted  — anchored strictly BELOW everything already on the board, which on
 *              an infinite canvas cannot overlap it without any gap search. This
 *              is what the API and the list-view drop want.
 *   {x, y}   — the block's top-left lands there.
 *
 * `avoidExisting` decides whether the block is then pushed clear of what is
 * already on the board. It defaults to true and is turned OFF only for a canvas
 * drop: the person pointed at a spot, and relocating their drop because
 * something was nearby is worse than letting it overlap. It is NOT inferred
 * from `origin` — a re-arrangement also supplies an origin and must still be
 * defended, or tidying ten cards buries the other forty.
 *
 * Returns items carrying integer x/y (and, for `justified`, recomputed w/h,
 * since fitting a row to a width IS a resize).
 */
export function arrange(existingCards, items, opts = {}) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return [];

  const gap = Number.isFinite(opts.gap) ? Math.max(0, opts.gap) : LAYOUT_GAP;
  const placed = relativeLayout(list, { ...opts, gap });

  const solid = withGeometry(existingCards);
  const at = opts.origin;
  const explicit = Number.isFinite(at?.x) && Number.isFinite(at?.y);

  let originX;
  let originY;
  if (explicit) {
    originX = at.x;
    originY = at.y;
  } else {
    const bounds = boundsOfCards(solid);
    originX = bounds ? bounds.x : MARGIN;
    originY = bounds ? bounds.bottom + (opts.startBelowGap ?? START_BELOW_GAP) : MARGIN;
  }

  const moved = placed.map((c) => ({
    ...c,
    x: Math.max(FLOOR, Math.round(c.x + originX)),
    y: Math.max(FLOOR, Math.round(c.y + originY)),
  }));

  const avoid = opts.avoidExisting !== false;
  return avoid ? pushClearOf(solid, moved, gap) : moved;
}

/**
 * Re-arrange cards that ALREADY exist, in place.
 *
 * The difference from `arrange` is the anchor: a re-arrangement should stay
 * where the cards already were rather than migrating to the bottom of the
 * board, so the block is re-anchored on its own current top-left, and the
 * cards being moved are excluded from the collision set — they are allowed to
 * occupy the space they are vacating.
 */
export function rearrange(allCards, cardIds, opts = {}) {
  const ids = new Set((cardIds || []).map(String));
  const all = withGeometry(allCards);
  const moving = all.filter((c) => ids.has(String(c.id)));
  if (!moving.length) return [];
  const staying = all.filter((c) => !ids.has(String(c.id)));

  const anchor = blockBounds(moving);
  return arrange(staying, moving, {
    ...opts,
    origin: anchor ? { x: anchor.x, y: anchor.y } : undefined,
  });
}
