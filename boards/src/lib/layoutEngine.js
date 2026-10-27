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
export function justifiedRows(items, {
  width, gap = LAYOUT_GAP, rowHeight = TARGET_ROW_HEIGHT,
  // How far the last, unfilled row may grow past rowHeight. A canvas drop
  // allows a little; a gallery keeps its last row at the target size.
  lastRowMaxStretch = LAST_ROW_MAX_STRETCH,
} = {}) {
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
    if (ri === rows.length - 1) h = Math.min(h, rowHeight * lastRowMaxStretch);
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
      // Laid out from (8, 8), not (0, 0): arrangeInFreeSpace floors every
      // position at 8, which pressed the first column and row 8px into the
      // second and left the grid's first gaps 16 where the rest are 24.
      return toOrigin(arrangeInFreeSpace(null, list, {
        gap, margin: 8, startBelowGap: 0,
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

// ── Groups ───────────────────────────────────────────────────────────────────
//
// A group is drawn as ONE outline round all its cards, 12px out, with its name
// 22px above that (CanvasSurface's groupOutlineEls; a test keeps these equal).
// Lay grouped cards out as one list and two groups' cards share rows: each
// outline then takes in the other group's cards, and the names land on cards.
// That is what an assistant got by adding four groups' cards in one call, and
// what Tidy up did to the board after. So grouped cards are laid out a group at
// a time, each group as its own block with room for its outline and name, and
// the blocks are then set out like cards.
export const GROUP_OUTLINE_PAD = 12;
export const GROUP_LABEL_ROOM = GROUP_OUTLINE_PAD + 22;
// Between two groups' blocks, outline to outline.
const GROUP_GAP = 48;

const groupOf = (c) => (c?.groupId ? String(c.groupId) : null);

// Positions of `items` by group, in the order each group first appears; cards
// in no group are one part more. null when nothing is grouped.
function partsByGroup(items) {
  const parts = new Map();
  items.forEach((it, i) => {
    const key = groupOf(it);
    if (!parts.has(key)) parts.set(key, []);
    parts.get(key).push(i);
  });
  if (parts.size === 1 && parts.has(null)) return null;
  return [...parts].map(([group, idx]) => ({ group, idx }));
}

// The rectangle a group's outline and name take round its cards' bounds.
function frameOf(b) {
  return {
    x: b.x - GROUP_OUTLINE_PAD,
    y: b.y - GROUP_LABEL_ROOM,
    w: b.right - b.x + 2 * GROUP_OUTLINE_PAD,
    h: b.bottom - b.y + GROUP_LABEL_ROOM + GROUP_OUTLINE_PAD,
  };
}

const overlapping = (a, b) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Blocks side by side in rows, in order, a row no wider than one and a half
// times the side of a square of the same area (or the widest block); for row
// and column, one line of them.
function setOutBlocks(blocks, layout, gap) {
  if (layout === 'row' || layout === 'column') {
    let run = 0;
    return blocks.map((b) => {
      const at = layout === 'row' ? { x: run, y: 0 } : { x: 0, y: run };
      run += (layout === 'row' ? b.w : b.h) + gap;
      return { ...b, ...at };
    });
  }
  const area = blocks.reduce((s, b) => s + b.w * b.h, 0);
  const width = Math.max(...blocks.map((b) => b.w), Math.round(Math.sqrt(area) * 1.5));
  let x = 0;
  let y = 0;
  let rowH = 0;
  return blocks.map((b) => {
    if (x > 0 && x + b.w > width) {
      x = 0;
      y += rowH + gap;
      rowH = 0;
    }
    const at = { ...b, x, y };
    x += b.w + gap;
    rowH = Math.max(rowH, b.h);
    return at;
  });
}

/**
 * relativeLayout, keeping each group's cards together: every group is laid out
 * on its own, framed with room for its outline and name, and the frames are set
 * out like cards. Cards in no group make one block more, unframed. Without
 * groups it IS relativeLayout. Returns the items in the order given, the cards'
 * top-left at (0, 0) as relativeLayout's are, so tidying a tidy board moves
 * nothing.
 */
export function relativeLayoutByGroup(items, opts = {}) {
  const list = (items || []).filter(Boolean);
  const parts = partsByGroup(list);
  if (!parts) return relativeLayout(list, opts);
  const gap = Number.isFinite(opts.gap) ? Math.max(0, opts.gap) : LAYOUT_GAP;

  const blocks = parts.map(({ group, idx }) => {
    const laid = toOrigin(relativeLayout(idx.map((i) => list[i]), opts));
    const b = blockBounds(laid);
    const left = group ? GROUP_OUTLINE_PAD : 0;
    const top = group ? GROUP_LABEL_ROOM : 0;
    return { idx, laid, left, top, w: b.w + 2 * left, h: b.h + top + left };
  });

  const out = new Array(list.length);
  for (const b of setOutBlocks(blocks, opts.layout, Math.max(gap, GROUP_GAP))) {
    b.laid.forEach((c, n) => {
      out[b.idx[n]] = { ...c, x: c.x + b.x + b.left, y: c.y + b.y + b.top };
    });
  }
  return toOrigin(out);
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
  const placed = relativeLayoutByGroup(list, { ...opts, gap });

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

  // The block lands as one piece. Each card used to be floored at 8px on its
  // own, and a board reaching left of or above the origin (a drop is centred
  // on the pointer, so most do) then had every row pressed onto one line and
  // every column onto one edge: tidying a selection piled it on itself.
  const moved = placed.map((c) => ({
    ...c,
    x: Math.round(c.x + originX),
    y: Math.round(c.y + originY),
  }));

  const avoid = opts.avoidExisting !== false;
  return avoid ? pushClearOf(solid, moved, gap) : moved;
}

// ── Align and distribute ─────────────────────────────────────────────────────
//
// The two commands every canvas has and this one did not. Its `Arrange` menu
// held only z-order, so there was no way to line four cards up by hand short of
// dragging each one and trusting the snap guides.
//
// Both preserve card SIZE — they only ever move things. Only justified resizes.

export const ALIGNMENTS = ['left', 'center-x', 'right', 'top', 'middle', 'bottom'];
export const AXES = ['horizontal', 'vertical'];

/**
 * Line a selection up on one edge of its own bounding box.
 *
 * On one edge, cards that stood side by side would land on top of one
 * another, and a picture under another is a lost picture. So a line-up is a
 * line: each card in turn, in the order they stood (reading order for a
 * column, left to right for a row), moves along it past the ones before only
 * when it would land on one. Left on a grid makes one column; cards already
 * in a line keep their spacing.
 */
export function alignCards(cards, edge, { gap = LAYOUT_GAP } = {}) {
  const solid = withGeometry(cards);
  if (solid.length < 2 || !ALIGNMENTS.includes(edge)) return [];
  const b = blockBounds(solid);
  const move = {
    left: (c) => ({ x: b.x }),
    right: (c) => ({ x: b.right - c.w }),
    'center-x': (c) => ({ x: b.x + (b.w - c.w) / 2 }),
    top: () => ({ y: b.y }),
    bottom: (c) => ({ y: b.bottom - c.h }),
    middle: (c) => ({ y: b.y + (b.h - c.h) / 2 }),
  }[edge];
  const lined = solid.map((c) => {
    const next = move(c);
    // No 8px floor here: this MOVES existing cards, and a card that
    // legitimately sits at y=0 must not be dragged down by the act of
    // aligning it — that is how distribute ended up with uneven gaps.
    return { ...c, x: Math.round(next.x ?? c.x), y: Math.round(next.y ?? c.y) };
  });
  // Lined up on a left, centre or right edge the cards stand in a column, on
  // a top, middle or bottom in a row; every pair then shares the line, so two
  // can only meet along it.
  const column = edge === 'left' || edge === 'center-x' || edge === 'right';
  const along = column ? 'y' : 'x';
  const size = column ? 'h' : 'w';
  const order = solid.map((_, i) => i).sort((i, j) => (column
    ? solid[i].y - solid[j].y || solid[i].x - solid[j].x
    : solid[i].x - solid[j].x || solid[i].y - solid[j].y));
  let end = -Infinity;
  for (const i of order) {
    const c = lined[i];
    if (c[along] < end) c[along] = Math.round(end + gap);
    end = Math.max(end, c[along] + c[size]);
  }
  return lined.filter((c, i) => c.x !== solid[i].x || c.y !== solid[i].y);
}

/**
 * Even out the GAPS along an axis, holding the two outermost cards still.
 *
 * Equal gaps rather than equal centres: with mixed card sizes, equal centres
 * leaves visibly uneven space, which is the thing the command is being asked
 * to fix.
 */
export function distributeCards(cards, axis) {
  const solid = withGeometry(cards);
  if (solid.length < 3 || !AXES.includes(axis)) return [];
  const horizontal = axis === 'horizontal';
  const pos = (c) => (horizontal ? c.x : c.y);
  const size = (c) => (horizontal ? c.w : c.h);

  const sorted = [...solid].sort((a, b) => pos(a) - pos(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = (pos(last) + size(last)) - pos(first);
  const occupied = sorted.reduce((s, c) => s + size(c), 0);
  // Negative when the cards already overlap more than the span allows; they
  // then simply sit flush rather than being pushed into a stack.
  const gap = Math.max(0, (span - occupied) / (sorted.length - 1));

  const moved = new Map();
  let run = pos(first);
  for (const c of sorted) {
    const next = Math.round(run);
    if (next !== pos(c)) moved.set(c.id, { ...c, [horizontal ? 'x' : 'y']: next });
    run += size(c) + gap;
  }
  return [...moved.values()];
}

/**
 * Lay a drop out as one block CENTRED on a point.
 *
 * What a canvas drop wants, and different from `arrange` in two ways: the block
 * is centred on the cursor rather than hung below and to the right of it, and
 * nothing is pushed clear of existing cards — the person pointed at a spot.
 *
 * Lives here rather than inline in the drop handler so the shape of a drop is
 * something a test can assert. The behaviour being protected is that twenty
 * photographs arrive as a block instead of a 5,200px strip.
 */
export function layoutDrop(items, { at, layout = DEFAULT_LAYOUT, gap } = {}) {
  const placed = relativeLayout(items, { layout, gap });
  if (!placed.length) return [];

  const minX = Math.min(...placed.map((c) => c.x));
  const minY = Math.min(...placed.map((c) => c.y));
  const width = Math.max(...placed.map((c) => c.x + c.w)) - minX;
  const height = Math.max(...placed.map((c) => c.y + c.h)) - minY;
  const originX = (Number.isFinite(at?.x) ? at.x : MARGIN) - width / 2;
  const originY = (Number.isFinite(at?.y) ? at.y : MARGIN) - height / 2;

  return placed.map((c) => ({
    ...c,
    x: Math.round(c.x - minX + originX),
    y: Math.round(c.y - minY + originY),
  }));
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

/**
 * Where grouped cards added without a position go. Cards for a group that
 * already has cards on the board land under them, else to their right, as a
 * grid, wherever the group's outline round old and new together then covers
 * nothing it didn't already: no card from outside the group, no other group's
 * outline or name. Everything else is laid out by group (grid) below the whole
 * board, as arrangeExisting puts an ungrouped batch. Returns the items in the
 * order given.
 */
export function placeGrouped(existingCards, items, opts = {}) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return [];
  const gap = Number.isFinite(opts.gap) ? Math.max(0, opts.gap) : LAYOUT_GAP;
  const settled = withGeometry(existingCards);
  const out = new Array(list.length);
  const rest = [];

  for (const { group, idx } of partsByGroup(list) || [{ group: null, idx: list.map((_, i) => i) }]) {
    const members = group ? settled.filter((c) => groupOf(c) === group) : [];
    const block = members.length
      ? toOrigin(relativeLayout(idx.map((i) => list[i]), { layout: 'grid', gap }))
      : null;
    const spot = block && besideGroup(group, members, blockBounds(block), settled, gap);
    if (!spot) {
      rest.push(...idx);
      continue;
    }
    block.forEach((c, n) => {
      const card = { ...c, x: Math.round(c.x + spot.x), y: Math.round(c.y + spot.y) };
      out[idx[n]] = card;
      settled.push(card);
    });
  }

  if (rest.length) {
    arrange(settled, rest.map((i) => list[i]), {
      layout: 'grid', gap, startBelowGap: opts.startBelowGap ?? 64,
    }).forEach((c, n) => { out[rest[n]] = c; });
  }
  return out.filter(Boolean);
}

// Under the group's cards, else to their right — the first spot where the
// group's frame round its cards and `block` (w×h) overlaps nothing outside the
// group that its frame doesn't overlap already. null when neither is clear.
function besideGroup(group, members, block, settled, gap) {
  const gb = blockBounds(members);
  const outside = settled.filter((c) => groupOf(c) !== group);
  const frames = new Map();
  for (const c of outside) {
    const g = groupOf(c);
    if (g) frames.set(g, [...(frames.get(g) || []), c]);
  }
  const obstacles = [
    ...outside,
    ...[...frames.values()].filter((m) => m.length >= 2).map((m) => frameOf(blockBounds(m))),
  ];
  const already = new Set(obstacles.filter((o) => overlapping(frameOf(gb), o)));
  for (const spot of [{ x: gb.x, y: gb.bottom + gap }, { x: gb.right + gap, y: gb.y }]) {
    const frame = frameOf({
      x: Math.min(gb.x, spot.x),
      y: Math.min(gb.y, spot.y),
      right: Math.max(gb.right, spot.x + block.w),
      bottom: Math.max(gb.bottom, spot.y + block.h),
    });
    if (obstacles.every((o) => already.has(o) || !overlapping(frame, o))) return spot;
  }
  return null;
}
