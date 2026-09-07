// reframeLayout — re-shape a whole board to fit a frame, without touching it.
//
// "Reframe for phone" solves the problem that a board authored on a 27" display
// is a wide, sparse field, and a phone sees roughly a tenth of it. The fix is
// not to zoom out until the cards are unreadable; it is to reflow the same
// cards into a column that suits the frame.
//
// THIS MODULE ONLY COMPUTES GEOMETRY. Nothing here writes. The result is
// substituted into the cards array on its way to the canvas, so the reframe is
// visible, arrows follow it, and the document never hears about it — which is
// what makes "it doesn't survive a refresh" and "it never touches the desktop
// layout" true by construction rather than by enforcement.
//
// Reuses justifiedRows() from layoutEngine, which already solves rows to a
// caller-chosen width (a canvas has no container edge to read one from — see
// its header). Deliberately does NOT mint a new entry in LAYOUTS: that array is
// a documented public vocabulary the docs gate hashes, and this is an internal
// staging tool, not a layout anyone can ask an API for.

import { justifiedRows, naturalWidth, LAYOUT_GAP, TARGET_ROW_HEIGHT } from './layoutEngine.js';
import { blockBounds } from './moodboard.js';

// Kinds that must keep their own size. A schedule card solved down to a 90px
// row is a grey smear — it is a calendar, and its content does not scale with
// its box. Grids are deliberately absent: justifiedRows preserves aspect, so a
// grid's internal cells reflow correctly when its box scales.
export const RIGID_KINDS = Object.freeze(['schedule']);

// Fallbacks matching normalizeIncomingCard's note defaults, so a card with no
// usable dimensions is packed rather than dropped or emitted 0×0.
const DEFAULT_W = 280;
const DEFAULT_H = 180;

// How far apart two cards' tops can be and still count as the same visual row
// when deriving reading order, as a fraction of the median card height.
const ROW_TOLERANCE = 0.6;

const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

// A card that spans the frame and breaks the flow around it. Same predicate the
// seed-recipe layout uses, so a board authored by scripts/seedBoard.mjs reflows
// as the editorial object it was written as rather than as a bag of pictures.
function isBandBreak(c) {
  return c?.sectionHeader === true || c?.span === 'full';
}

function isRigid(c) {
  return RIGID_KINDS.includes(c?.kind);
}

// ── Units ──────────────────────────────────────────────────────────────────
// A unit is what the packer moves: one card, or a whole group. Groups are
// atomic because their members are arranged relative to each other on purpose,
// and because the group outline the canvas draws is derived from the members'
// bounding box — keep the members coherent and the outline follows for free.

function toUnits(cards) {
  const byGroup = new Map();
  const units = [];
  cards.forEach((c, i) => {
    const gid = c?.groupId;
    if (gid) {
      let u = byGroup.get(gid);
      if (!u) {
        u = { kind: 'group', members: [], firstIndex: i, rigid: false };
        byGroup.set(gid, u);
        units.push(u);
      }
      u.members.push(c);
      u.rigid = u.rigid || isRigid(c);
      return;
    }
    units.push({ kind: 'card', members: [c], firstIndex: i, rigid: isRigid(c) });
  });

  // A "group" of one is just a card — treat it as such so it can be resized.
  for (const u of units) {
    if (u.kind === 'group' && u.members.length === 1) {
      u.kind = 'card';
      u.rigid = isRigid(u.members[0]);
    }
    const box = boxOf(u.members);
    u.x = box.x; u.y = box.y; u.w = box.w; u.h = box.h;
  }
  return units;
}

function boxOf(members) {
  const solid = members.map(m => ({
    x: num(m?.x, 0), y: num(m?.y, 0),
    w: num(m?.w, 0) > 0 ? m.w : DEFAULT_W,
    h: num(m?.h, 0) > 0 ? m.h : DEFAULT_H,
  }));
  const b = blockBounds(solid);
  return b || { x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H };
}

// Reading order, not creation order. The array arrives in Y.Map insertion order
// — i.e. the order things were made — but somebody who arranged a moodboard
// spatially expects the column to follow what they SEE. Bucket into visual rows
// with a tolerance derived from the content, then left-to-right within a row.
function readingOrder(units) {
  if (units.length < 2) return units.slice();
  const heights = units.map(u => u.h).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || DEFAULT_H;
  const tol = Math.max(1, median * ROW_TOLERANCE);
  return units.slice().sort((a, b) => {
    if (Math.abs(a.y - b.y) > tol) return a.y - b.y;
    if (a.x !== b.x) return a.x - b.x;
    // Total order: two units at the same spot must not compare equal, or the
    // sort is unstable across engines and the memo output stops being stable.
    return a.firstIndex - b.firstIndex;
  });
}

// ── The reframe ────────────────────────────────────────────────────────────

/**
 * Re-lay a board's cards into `width` board-units of horizontal space.
 *
 * Returns a NEW array in the SAME order as the input, carrying the same ids and
 * every other field untouched — only x/y/w/h change. Returns the input array by
 * identity when there is nothing to do, so a caller's memo can stay cheap.
 */
export function reframeCards(cards, opts = {}) {
  const list = Array.isArray(cards) ? cards : [];
  if (list.length < 2) return list;

  const gap = Number.isFinite(opts.gap) ? Math.max(0, opts.gap) : LAYOUT_GAP;
  const rowHeight = Number.isFinite(opts.rowHeight) ? Math.max(40, opts.rowHeight) : TARGET_ROW_HEIGHT;

  const units = toUnits(list);
  const anchor = blockBounds(units.map(u => ({ x: u.x, y: u.y, w: u.w, h: u.h })))
    || { x: 0, y: 0 };

  const width = Number.isFinite(opts.width) && opts.width > 0
    ? opts.width
    : naturalWidth(units, rowHeight);

  // Split into bands at every full-width card. A board with no section headers
  // has exactly one band, which is plain justified rows — so there is no
  // "simple mode" to choose between; the common case falls out of the general
  // one. Rigid units get a band to themselves for the same reason a header
  // does: they cannot be solved into a row without being destroyed.
  const bands = [];
  let current = null;
  for (const u of readingOrder(units)) {
    const solo = isBandBreak(u.members[0]) || u.rigid;
    if (solo) {
      bands.push({ solo: true, units: [u] });
      current = null;
    } else {
      if (!current) { current = { solo: false, units: [] }; bands.push(current); }
      current.units.push(u);
    }
  }

  // Stack the bands, solving each one to the same width.
  const placed = new Map();   // unit → { x, y, w, h } in block space
  let cursorY = 0;
  for (const band of bands) {
    if (band.solo) {
      const u = band.units[0];
      // A section header takes the full frame width; a rigid card keeps its own
      // size and is centred in the frame rather than stretched.
      const isHeader = isBandBreak(u.members[0]) && !u.rigid;
      const w = isHeader ? width : Math.min(u.w, width);
      const h = isHeader ? u.h : u.h * (w / (u.w || w));
      placed.set(u, { x: Math.round((width - w) / 2), y: Math.round(cursorY), w: Math.round(w), h: Math.round(h) });
      cursorY += h + gap;
      continue;
    }
    const rows = justifiedRows(
      band.units.map(u => ({ w: u.w, h: u.h })),
      { width, gap, rowHeight },
    );
    let bandBottom = 0;
    rows.forEach((r, i) => {
      placed.set(band.units[i], { x: r.x, y: Math.round(cursorY + r.y), w: r.w, h: r.h });
      bandBottom = Math.max(bandBottom, r.y + r.h);
    });
    cursorY += bandBottom + gap;
  }

  // Expand units back into cards, translated onto the original anchor so the
  // board reframes where it already lives rather than jumping to the origin.
  const out = new Map();
  for (const u of units) {
    const p = placed.get(u);
    if (!p) continue;
    const dx = anchor.x + p.x;
    const dy = anchor.y + p.y;

    if (u.kind === 'card') {
      const c = u.members[0];
      out.set(c, { ...c, x: dx, y: dy, w: Math.max(1, p.w), h: Math.max(1, p.h) });
      continue;
    }

    // A group scales as one rigid body. Uniform scale on the SMALLER axis, then
    // centre in the solved box: justifiedRows clamps extreme aspects, so the
    // solved box is not always exactly the group's own ratio, and stretching
    // the members to fill it would shear an arrangement somebody made by hand.
    const s = Math.min(p.w / (u.w || p.w), p.h / (u.h || p.h)) || 1;
    const insetX = (p.w - u.w * s) / 2;
    const insetY = (p.h - u.h * s) / 2;
    for (const m of u.members) {
      const mx = num(m?.x, u.x);
      const my = num(m?.y, u.y);
      const mw = num(m?.w, 0) > 0 ? m.w : DEFAULT_W;
      const mh = num(m?.h, 0) > 0 ? m.h : DEFAULT_H;
      out.set(m, {
        ...m,
        x: Math.round(dx + insetX + (mx - u.x) * s),
        y: Math.round(dy + insetY + (my - u.y) * s),
        w: Math.max(1, Math.round(mw * s)),
        h: Math.max(1, Math.round(mh * s)),
      });
    }
  }

  // Same order in, same order out — a caller substituting this for the real
  // array must not have the card list reshuffle underneath it.
  return list.map(c => out.get(c) || c);
}

/**
 * The width to solve against for a given frame, in board units.
 *
 * Derived from the board's own median card width rather than a constant,
 * reusing the reasoning already measured in CanvasSurface's phone-rescue block:
 * what matters is how many cards read ACROSS the frame, not how many pixels
 * wide it is. `cardsAcross` comes from the aspect (see captureAspect.js).
 */
export function widthForFrame(cards, cardsAcross, gap = LAYOUT_GAP) {
  const across = Number.isFinite(cardsAcross) && cardsAcross > 0 ? cardsAcross : 2.4;
  const widths = (cards || [])
    .map(c => (Number.isFinite(c?.w) && c.w > 0 ? c.w : DEFAULT_W))
    .sort((a, b) => a - b);
  const median = widths.length ? widths[Math.floor(widths.length / 2)] : DEFAULT_W;
  return Math.round(median * across + gap * Math.max(0, across - 1));
}
