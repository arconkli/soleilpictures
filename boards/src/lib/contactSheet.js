// Layout maths for the images Scout texts back.
//
// Two pictures, two jobs:
//
//   sheetLayout()   — a grouped contact sheet, sent BEFORE a move as the
//                     confirmation. Grouping is the point: when someone says
//                     "put these in Diner Recce" and their Bin also holds 14
//                     forgotten photos from Monday, a number ("move 20?") means
//                     nothing, but a picture with two labelled blocks makes the
//                     strays instantly obvious.
//
//   previewLayout() — the moodboard we just built, scaled to a phone-sized
//                     image. Not an approximation: we know the exact rects the
//                     layout produced, so this is what the board actually looks
//                     like.
//
// Pure geometry, no image decoding, so both can be tested without sharp.

export const SHEET_W = 1200;
const PAD = 32;
const GAP = 16;
const LABEL_H = 46;
const GROUP_GAP = 28;
const COLS = 5;
// A phone renders an attachment a few hundred px wide. Past this the sheet
// becomes unreadable scrollware rather than something you take in at a glance.
const MAX_H = 2200;

// Fit w×h inside a box, preserving aspect, never upscaling past the box.
function fit(w, h, boxW, boxH) {
  const w0 = Number(w) > 0 ? Number(w) : 4;
  const h0 = Number(h) > 0 ? Number(h) : 3;
  const s = Math.min(boxW / w0, boxH / h0);
  return { w: Math.max(1, Math.round(w0 * s)), h: Math.max(1, Math.round(h0 * s)) };
}

// groups: [{ label, dim, items: [{ width, height, ...passthrough }] }]
//
// `dim` marks a group as historical — the renderer draws it at reduced opacity,
// which is what makes "these 6 are new, those 14 are old" readable without
// reading anything.
export function sheetLayout(groups, opts = {}) {
  const cols = Math.max(1, opts.cols ?? COLS);
  const width = opts.width ?? SHEET_W;
  const cell = Math.floor((width - PAD * 2 - GAP * (cols - 1)) / cols);

  const out = [];
  let y = PAD;

  for (const g of (groups || [])) {
    const items = (g?.items || []).filter(Boolean);
    if (!items.length) continue;

    const laid = [];
    const rows = Math.ceil(items.length / cols);
    const top = y + (g.label ? LABEL_H : 0);

    items.forEach((it, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const size = fit(it.width, it.height, cell, cell);
      laid.push({
        ...it,
        // Centre inside the square cell so mixed portrait/landscape reads as a
        // grid rather than a ragged stack.
        x: PAD + col * (cell + GAP) + Math.round((cell - size.w) / 2),
        y: top + row * (cell + GAP) + Math.round((cell - size.h) / 2),
        w: size.w,
        h: size.h,
      });
    });

    out.push({
      label: g.label || null,
      dim: !!g.dim,
      count: items.length,
      labelY: y,
      items: laid,
    });

    y = top + rows * cell + (rows - 1) * GAP + GROUP_GAP;
  }

  const height = Math.max(PAD * 2 + 1, Math.min(MAX_H, y - GROUP_GAP + PAD));
  return { width, height, groups: out, cell };
}

// Scale a set of laid-out board cards into an image.
//
// `cards` carry board-space x/y/w/h. We translate the block to the origin and
// scale it to the output width, so the result is a true miniature of what lands
// on the canvas — same gaps, same column structure, same proportions.
export function previewLayout(cards, opts = {}) {
  const list = (cards || []).filter((c) => (
    Number.isFinite(c?.x) && Number.isFinite(c?.y)
    && Number.isFinite(c?.w) && Number.isFinite(c?.h) && c.w > 0 && c.h > 0
  ));
  if (!list.length) return null;

  const width = opts.width ?? SHEET_W;
  const pad = opts.pad ?? PAD;

  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const c of list) {
    minX = Math.min(minX, c.x); minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x + c.w); maxY = Math.max(maxY, c.y + c.h);
  }
  const boxW = maxX - minX;
  const boxH = maxY - minY;

  // Scale to the output width, then pull back further if that would make an
  // absurdly tall image (a single-column block of 30 photos).
  let scale = (width - pad * 2) / boxW;
  if (boxH * scale + pad * 2 > MAX_H) scale = (MAX_H - pad * 2) / boxH;

  const items = list.map((c) => ({
    ...c,
    x: Math.round(pad + (c.x - minX) * scale),
    y: Math.round(pad + (c.y - minY) * scale),
    w: Math.max(1, Math.round(c.w * scale)),
    h: Math.max(1, Math.round(c.h * scale)),
  }));

  return {
    width: Math.round(Math.min(width, boxW * scale + pad * 2)),
    height: Math.round(boxH * scale + pad * 2),
    scale,
    items,
  };
}
