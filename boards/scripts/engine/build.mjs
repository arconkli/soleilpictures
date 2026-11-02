// build.mjs — a recipe and its photos → the board's cards, sections and arrows.
//
// The board is made from the app's own pieces, the ones lib/makeBoard.js makes
// an assistant's board from: notes written and fitted to their text
// (noteCompose, noteFit), palettes sized to their swatches, pictures at their
// true shape, sections in the API's named colours (apiCards), note tints
// (boardStyle), and `auto` laying it all out (layoutAuto). So an engine board
// is laid out the way an assistant's board is, and work on one improves the
// other.
//
// Beyond what the maker makes, a board shows the rest of the canvas's tools
// (the owner, 10-30: "use more of our tools in each board"), each as the card a
// person would add:
//   · a table: a grid card of text cells, the header row in bold
//   · a photo grid: a section marked `grid` puts its pictures in one grid card,
//     a mosaic (a hero and a strip) or, when they're captioned frames, a
//     storyboard sheet (a row of frames, their captions under them)
//   · a checklist: a note in the checklist's [x] / [ ] lines
//   · a doc: a doc card whose page is the item's Markdown (cardEncode.mjs writes
//     it with docWrite.writePages, the API's own doc writer)
//   · a script: a doc card in screenplay mode (the owner, 10-29: "we have a
//     screenplay docs feature for screenplay kinda stuff and scenes")
//   · a link: the app's link preview card, for a page links.mjs checked live
//   · arrows: between two cards the recipe names by title or caption
//   · a video, laid out as a picture of its shape; the board's first plays by
//     itself (muted), as a person sets it to
// and since 11-01 (the owner: "as many of our features as possible in here.
// so add like video, maybe audio, grids, etc"):
//   · a sound: the app's audio card, its waveform drawn from the sound
//     (sounds.mjs), its cover a picture from the board
//   · a PDF: the app's PDF card, page 1 as its picture (pdfs.mjs)
//   · a sub-cluster: a cluster of its own inside the board (a child board of
//     more pictures and a note), shown on the board as the app's cluster card
//   · tags on cards, the crew's comments and a vote (crew.mjs), and a marker
//     loop drawn round the picture the vote is on, as a person marks one up
// and the board's style (styles.mjs) sets its ground, its arrangement and the
// notes' font.
//
// Pure. Cards carry `photo: 'si.ii'` (the recipe item their picture came from)
// and no src, a photo grid `photos: [...]` and `photo` on each image cell;
// withSources() fills the srcs in, once for the stored board (r2: keys) and
// once for the staged one the shooter photographs (local files).

import { composeNoteHtml } from '../../src/lib/noteCompose.js';
import { fitNoteSize, noteContentHeight, NOTE_FIT } from '../../src/lib/noteFit.js';
import { paletteSize, readSections, readSwatches, resolveSections, sectionKey } from '../../src/lib/apiCards.js';
import { pictureShape } from '../../src/lib/makeBoard.js';
import { tintNewNotes } from '../../src/lib/boardStyle.js';
import { arrangeAuto, ARRANGEMENTS, AUTO } from '../../src/lib/layoutAuto.js';
import { GROUP_OUTLINE_PAD } from '../../src/lib/layoutEngine.js';
import { computeArrowAttachments } from '../../src/lib/arrowGeometry.js';
import { stampCard } from '../lib/cardEncode.mjs';
import { FONTS, styleNamed } from './styles.mjs';
import { CHECK } from './check.mjs';
import { snapBubbleToBox } from '../../src/lib/bubbleLayout.js';
import { crewOf } from './crew.mjs';

const span = (n) => n * AUTO.column + (n - 1) * AUTO.gap;

// A doc or a script on the board: a column wide, a page tall, so the closed
// card shows its opening lines under its name.
export const PAGE_SHAPE = Object.freeze({ w: AUTO.column, h: Math.round(AUTO.column * 1.25) });
export const SCRIPT_SHAPE = Object.freeze({ width: PAGE_SHAPE.w * 4, height: PAGE_SHAPE.h * 4 });

// A link preview: the canvas's own sizes (cards.jsx LinkCard), taller with a picture.
export const LINK_SHAPE = Object.freeze({ w: 280, h: 110 });

// A sound: the audio card's own size (cards.jsx AudioCard).
export const AUDIO_SHAPE = Object.freeze({ w: 380, h: 130 });
// A sub-cluster's card on its parent (onboardingStarter.js's).
export const CLUSTER_SHAPE = Object.freeze({ w: 280, h: 200 });
// The loop drawn round the voted picture: a red marker, a hand's width off the
// card (inside the gap to its neighbours), its end running on past its start.
export const MARKUP = Object.freeze({ color: '#e5484d', width: 5, brush: 'marker', pad: 11, radius: 26, step: 14, wobble: 3, overrun: 0.12 });

// The size the app gives a bubble beside a card (bubbleLayout.js measures it
// once drawn): a comment is BUBBLE_W wide with a two-line preview, a little
// taller with its reply count; a vote is its label (up to 160px) and two
// buttons. `outside`: what a bubble reaching past the board's edge costs, per
// unit of area, against covering a card (1): little, since the shots frame it in.
export const BUBBLE = Object.freeze({ comment: { w: 240, h: 76 }, thread: { w: 240, h: 92 }, voteH: 34, voteButtons: 112,
  voteLabelPx: 6.5, voteLabelMax: 160, outside: 0.25, bubbles: 1.5 });
export const voteSize = (label) => ({ w: Math.min(BUBBLE.voteLabelMax, Math.ceil(String(label || '').length * BUBBLE.voteLabelPx)) + BUBBLE.voteButtons, h: BUBBLE.voteH });

const area = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Where a comment or vote bubble sits beside its card, and the offset that
 * puts it there. The app draws a bubble flush against one side of its card
 * (bubbleLayout.js snapBubbleToBox), so each side is tried at its start,
 * middle and end, and the spot that covers least wins: other cards and
 * section labels count in full, other bubbles half again, and whatever
 * reaches past `edge` (the board's cards) a quarter. Ties keep the app's
 * order: right, left, below, above. Pure.
 *   box: the card; size: { w, h }; obstacles: rects; placed: bubbles already placed
 * → { offset: { x, y }, rect: { x, y, w, h }, side }
 */
export function placeBubble(box, size, { obstacles = [], placed = [], edge = null } = {}) {
  let best = null;
  for (const s of bubbleSpots(box, size)) {
    let covers = 0;
    for (const o of obstacles) covers += area(s.rect, o);
    for (const p of placed) covers += BUBBLE.bubbles * area(s.rect, p);
    const score = covers + (edge ? BUBBLE.outside * (size.w * size.h - area(s.rect, edge)) : 0);
    if (!best || score < best.score) best = { ...s, score, covers };
  }
  return best;
}

/**
 * The spots placeBubble tries, in the app's order, each with the offset that
 * puts it there: on each side its start, middle and end, then the two the app
 * lets reach 18px past the card's corners (to clear a tag strip, say). Pure.
 */
export function bubbleSpots(box, { w, h }) {
  // oy: the bubble's top at box.y - 8 + oy (clamped to box.y - 18 … box.y + box.h - h + 18)
  const ys = [0, box.h / 2 - h / 2 + 8, box.h - h + 16, -10, box.h - h + 26];
  // ox for a bubble below or above: its left at box.x + box.w + 8 + ox (clamped to box.x - 18 … box.x + box.w - w + 18)
  const xs = [-box.w - 8, -box.w / 2 - w / 2 - 8, -w - 8, -w + 10, -box.w - 26];
  const cands = [
    ...ys.map((oy) => ({ want: 'right', ox: 0, oy })),
    ...ys.map((oy) => ({ want: 'left', ox: -(box.w + 16 + w), oy })),
    ...xs.map((ox) => ({ want: 'bottom', ox, oy: 2 * box.h + 2 * h })),
    ...xs.map((ox) => ({ want: 'top', ox, oy: -(2 * box.h + 2 * h) })),
  ];
  const out = [];
  for (const c of cands) {
    const offset = { x: Math.round(c.ox), y: Math.round(c.oy) };
    const snap = snapBubbleToBox(box, offset.x, offset.y, w, h);
    if (snap.side === c.want) out.push({ offset, rect: { x: snap.bubble.x, y: snap.bubble.y, w, h }, side: snap.side });
  }
  return out;
}

/**
 * The strip of tags under a card, as CanvasSurface draws it: 6px under the
 * card, up to four chips (9.5px type, a dot, 120px at most) 4px apart. → a
 * rect, or null with no tags.
 */
export const TAG_CHIP = Object.freeze({ below: 6, h: 18, gap: 4, base: 28, perChar: 5.5, max: 120, shown: 4, minStrip: 180 });
export function tagStrip(card, names) {
  if (!names.length) return null;
  const w = names.slice(0, TAG_CHIP.shown).reduce((n, t, i) => n + (i ? TAG_CHIP.gap : 0) + Math.min(TAG_CHIP.max, TAG_CHIP.base + TAG_CHIP.perChar * t.length), 0);
  const room = Math.max(card.w, TAG_CHIP.minStrip);
  const rows = Math.ceil(w / room);
  return { x: card.x, y: card.y + card.h + TAG_CHIP.below, w: Math.min(w, room), h: rows * TAG_CHIP.h + (rows - 1) * TAG_CHIP.gap };
}

/**
 * What the vote's red loop rings: its card, and the card's tag strip when it
 * has one, since a loop MARKUP.pad off the card runs straight through the chips.
 * → a box for markerLoop.
 */
export function loopBox(card, strip = null) {
  if (!strip) return { x: card.x, y: card.y, w: card.w, h: card.h };
  return { x: card.x, y: card.y, w: Math.max(card.w, strip.x + strip.w - card.x), h: strip.y + strip.h - card.y };
}
// How far under a loop's box the next card must start: the pad, the wobble, the
// stroke and a little air.
export const LOOP_REACH = MARKUP.pad + MARKUP.wobble + MARKUP.width + 6;

/** Where a bubble at `offset` beside `box` is drawn (snapBubbleToBox). */
export const bubbleRect = (box, offset, { w, h }) => ({ ...snapBubbleToBox(box, offset.x, offset.y, w, h).bubble, w, h });

/**
 * On a board set close, a bubble covers a neighbour on every side. Room is
 * made in its card's column instead, as an arrow's is (openRoom): for a bubble
 * below, the rest of the column moves down; for one above, the card itself
 * and the rest of its column. Each spot below and above is tried, least
 * moving first; `ok(cards)` vets the board each would make (arrows still
 * reading, say). → { cards, offset } or null when no room can be made.
 *   cover(rect, cards): what the bubble at rect would cover on those cards
 */
export function bubbleRoom(cards, cardId, size, { cover, ok = () => true }) {
  const box = cards.find((c) => c.id === cardId);
  const gap = AUTO.gap;
  const tries = [];
  for (const s of bubbleSpots(box, size)) {
    if (s.side !== 'bottom' && s.side !== 'top') continue;
    const x0 = Math.min(s.rect.x, box.x);
    const x1 = Math.max(s.rect.x + s.rect.w, box.x + box.w);
    const line = s.side === 'bottom' ? box.y + box.h : box.y;
    const span = (c) => c.x < x1 && c.x + c.w > x0;
    const dy = s.side === 'bottom'
      ? Math.max(0, ...cards.filter((c) => c.groupId === box.groupId && c.y >= line - 1 && span(c)).map((c) => s.rect.y + s.rect.h + gap - c.y))
      : Math.max(0, ...cards.filter((c) => c.id !== cardId && c.y < box.y && span(c)).map((c) => c.y + c.h + gap - s.rect.y));
    tries.push({ ...s, x0, x1, line, dy: Math.ceil(dy) });
  }
  tries.sort((a, b) => a.dy - b.dy);
  for (const t of tries) {
    const next = t.dy ? moveDown(cards, { line: t.line, x0: t.x0, x1: t.x1, groupId: box.groupId, dy: t.dy }) : cards;
    if (!next) continue;
    const moved = next.find((c) => c.id === cardId);
    if (cover(bubbleRect(moved, t.offset, size), next) === 0 && ok(next)) return { cards: next, offset: t.offset };
  }
  return null;
}

/**
 * A hand-drawn loop round a card: its box grown by `pad`, corners rounded, a
 * little uneven and only ever outward, ending past where it began. Pure and
 * the same every time for the same box. -> [[x, y], ...]
 */
export function markerLoop(box, { pad = MARKUP.pad, radius = MARKUP.radius, step = MARKUP.step, wobble = MARKUP.wobble, overrun = MARKUP.overrun } = {}) {
  const x0 = box.x - pad;
  const y0 = box.y - pad;
  const x1 = box.x + box.w + pad;
  const y1 = box.y + box.h + pad;
  const r = Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2);
  // The outline as straight runs and quarter arcs, clockwise from the top edge's start.
  const segs = [
    { line: [[x0 + r, y0], [x1 - r, y0]] }, { arc: [x1 - r, y0 + r, -Math.PI / 2] },
    { line: [[x1, y0 + r], [x1, y1 - r]] }, { arc: [x1 - r, y1 - r, 0] },
    { line: [[x1 - r, y1], [x0 + r, y1]] }, { arc: [x0 + r, y1 - r, Math.PI / 2] },
    { line: [[x0, y1 - r], [x0, y0 + r]] }, { arc: [x0 + r, y0 + r, Math.PI] },
  ];
  const ring = []; // [x, y, outward nx, ny]
  for (const s of segs) {
    if (s.line) {
      const [[ax, ay], [bx, by]] = s.line;
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.round(len / step));
      const nx = (by - ay) / (len || 1);
      const ny = -(bx - ax) / (len || 1);
      for (let i = 0; i < n; i += 1) ring.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, nx, ny]);
    } else {
      const [cx, cy, a0] = s.arc;
      const n = Math.max(2, Math.round(((Math.PI / 2) * r) / step));
      for (let i = 0; i < n; i += 1) {
        const a = a0 + ((Math.PI / 2) * i) / n;
        ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a), Math.cos(a), Math.sin(a)]);
      }
    }
  }
  // Begin a little way along the top, as a hand would, and run on past the start.
  const start = Math.round(ring.length * 0.06);
  const total = ring.length + Math.round(ring.length * overrun);
  const out = [];
  for (let i = 0; i <= total; i += 1) {
    const [x, y, nx, ny] = ring[(start + i) % ring.length];
    const off = wobble * (0.5 + 0.5 * Math.sin(i * 0.9 + box.w * 0.01)) + (i / total) * wobble;
    out.push([Math.round((x + nx * off) * 10) / 10, Math.round((y + ny * off) * 10) / 10]);
  }
  return out;
}

/**
 * The pictures a recipe's sub-clusters hold, as sections after the board's own,
 * so photos.mjs finds and picks them with the rest, in the same world. The k-th
 * picture of the j-th sub-cluster is `${recipe.sections.length + j}.${k}`. Pure.
 */
export function clusterSections(recipe) {
  const out = [];
  for (const s of recipe?.sections || []) {
    for (const it of s?.items || []) {
      if (it?.kind === 'cluster') out.push({ name: clean(it.title), items: (it.searches || []).map((q) => ({ kind: 'picture', search: q })) });
    }
  }
  return out;
}
export const photoRecipe = (recipe) => ({ ...recipe, sections: [...(recipe?.sections || []), ...clusterSections(recipe)] });

// A card's photo keys renamed (a sub-cluster's own '0.k' -> the parent's key).
function rekey(c, back) {
  const k = (x) => back.get(x) || x;
  const out = { ...c };
  if (out.photo) out.photo = k(out.photo);
  if (Array.isArray(out.photos)) out.photos = out.photos.map(k);
  if (out.gridCells) out.gridCells = Object.fromEntries(Object.entries(out.gridCells).map(([id, cell]) => [id, cell?.photo ? { ...cell, photo: k(cell.photo) } : cell]));
  return out;
}

// Grids: how a table's cells are sized, and a photo grid's.
export const GRID = Object.freeze({
  min: 3, // the fewest pictures a photo grid holds; fewer found and they stay cards
  charPx: 7.2, // a table cell's 13px text, a character
  cellPad: 22,
  colW: [64, 300],
  lineH: 19,
  rowPad: 15,
  caption: 44, // a storyboard frame's caption row
  textSize: 13,
});

// An image's caption is one line over the picture, cut with an ellipsis when it
// runs long (styles.css .ic .ic-cap.editable-overlay: 10.5px mono, .04em
// tracking, 8px inset, 7px padding). A caption that doesn't fit its card is cut
// back to whole words, or left off when fewer than two would remain: a board
// with "Opening wide. Hold it longer than f…" on it reads as broken.
export const CAPTION = Object.freeze({ charPx: 6.8, insetPx: 30 });

export function fitCaption(text, cardW) {
  const t = String(text || '').trim();
  const room = Math.floor((cardW - CAPTION.insetPx) / CAPTION.charPx);
  if (t.length <= room) return t;
  const words = t.split(/\s+/);
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > room) break;
    out = next;
  }
  out = out.replace(/[\s,;:·—–-]+$/, '');
  return out.split(/\s+/).filter(Boolean).length >= 2 ? out : null;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clean = (s) => String(s ?? '').trim();
const norm = (s) => clean(s).toLowerCase().replace(/\s+/g, ' ');

// A layout tree: a column of rows, each a row of leaves, every frac given.
function rowsTree(rows, mk) {
  const total = rows.reduce((a, r) => a + r.h, 0);
  const ids = [];
  const tree = {
    type: 'col', frac: 1,
    children: rows.map((r) => {
      const sum = r.cols.reduce((a, b) => a + b, 0);
      return {
        type: 'row', frac: r.h / total,
        children: r.cols.map((w) => { const id = mk(); ids.push(id); return { type: 'leaf', id, frac: w / sum }; }),
      };
    }),
  };
  return { tree, ids };
}

/** A table's grid card: the header row bold, columns as wide as their words. */
export function tableCard(it, { font = null, mk }) {
  const rows = (it.rows || []).map((r) => (Array.isArray(r) ? r.map(clean) : []));
  const cols = Math.max(...rows.map((r) => r.length));
  const len = Array.from({ length: cols }, (_, c) => Math.max(3, ...rows.map((r) => (r[c] || '').length)));
  let colW = len.map((n) => Math.min(GRID.colW[1], Math.max(GRID.colW[0], n * GRID.charPx + GRID.cellPad)));
  const want = Math.min(span(4), Math.max(span(2), colW.reduce((a, b) => a + b, 0)));
  const k = want / colW.reduce((a, b) => a + b, 0);
  colW = colW.map((w) => w * k);
  const rowH = rows.map((r) => {
    const lines = Math.max(1, ...colW.map((w, c) => Math.ceil(((r[c] || '').length * GRID.charPx) / Math.max(1, w - GRID.cellPad))));
    return lines * GRID.lineH + GRID.rowPad;
  });
  const { tree, ids } = rowsTree(rows.map((_, i) => ({ h: rowH[i], cols: colW })), mk);
  const gridCells = {};
  rows.forEach((r, ri) => {
    for (let c = 0; c < cols; c += 1) {
      const text = r[c] || '';
      const id = ids[ri * cols + c];
      gridCells[id] = text
        ? { type: 'text', html: ri === 0 ? `<p><strong>${esc(text)}</strong></p>` : `<p>${esc(text)}</p>` }
        : { type: 'empty' };
    }
  });
  return {
    kind: 'grid', title: clean(it.title), layout: tree, templateId: null, seqId: null, gridCells,
    textStyle: { fontSize: GRID.textSize, vAlign: 'center', ...(font ? { fontFamily: font } : {}) },
    w: Math.round(want), h: Math.round(rowH.reduce((a, b) => a + b, 0)),
  };
}

// A mosaic's rows by how many pictures: a hero over a strip, or even rows.
// Each row: [its height share, its pictures].
const MOSAIC = {
  3: { cols: 2, rows: [[0.62, 1], [0.38, 2]] },
  4: { cols: 2, rows: [[0.6, 1], [0.4, 3]] },
  5: { cols: 2, rows: [[0.58, 1], [0.42, 4]] },
  6: { cols: 3, rows: [[0.5, 3], [0.5, 3]] },
  7: { cols: 3, rows: [[0.5, 1], [0.25, 3], [0.25, 3]] },
  8: { cols: 3, rows: [[0.5, 2], [0.25, 3], [0.25, 3]] },
  9: { cols: 3, rows: [[1 / 3, 3], [1 / 3, 3], [1 / 3, 3]] },
};
export const MOSAIC_MAX = 9;

// A sheet that lost a frame (its photo not found, or past the last full
// strip) is numbered as it stands: "3 · WIDE — …" by its place on the sheet,
// and "Frames 1–10" by the frames it holds.
export const frameCaption = (caption, i) => clean(caption).replace(/^\d+\s*([·.:—–-])\s*/, `${i + 1} $1 `);
export const frameRange = (text, n) => String(text || '').replace(/\b1\s*([–-])\s*\d+\b/, `1$1${n}`);

// A grid's pictures are a frames sheet when there are six or more and most are captioned; a storyboard
// when most captions also carry the frame's number ("3 · CLOSE — brake lever"), the shot list's.
export const isFrameSheet = (pics) => pics.length >= 6 && pics.filter((p) => clean(p.it?.caption)).length >= Math.ceil(pics.length / 2);
const NUMBERED = /^\d+\s*[·.:—–-]/;
export const isStoryboard = (pics) => isFrameSheet(pics) && pics.filter((p) => NUMBERED.test(clean(p.it?.caption))).length >= Math.ceil(pics.length / 2);

/**
 * The pictures a recipe would lay out as a storyboard's frames. → Set of 'si.ii'.
 * Their numbers are the shot list's, so a lost frame contradicts the board's
 * own writing: the run sends one back to be searched again, and the last
 * try's side-by-side check never takes one out.
 */
export function frameKeys(recipe) {
  const keys = new Set();
  (recipe?.sections || []).forEach((s, si) => {
    if (!s?.grid) return;
    const pics = (s.items || []).map((it, ii) => ({ it, key: `${si}.${ii}` })).filter((p) => p.it?.kind === 'picture');
    if (isStoryboard(pics)) for (const p of pics) keys.add(p.key);
  });
  return keys;
}

/**
 * A photo grid's card. pics: [{ key, it, ph }] in order. A frames sheet when
 * they're frames (most of them captioned): rows of three or four frames at
 * 16:9, each with its caption in the row under it; else a mosaic. A frame with
 * no photo (ph null) is left off a contact sheet, which is then numbered as it
 * stands; on a storyboard it keeps its place and its number, the shot list's,
 * and its frame reads "Still to find".
 */
export const STILL_TO_FIND = 'Still to find';
export function photoGridCard(pics, { title = '', font = null, frames = false, mk }) {
  const image = (p) => (p.ph
    ? { type: 'image', photo: p.key, fit: 'cover', alt: clean(p.it.caption) || clean(p.ph.alt) }
    : { type: 'text', html: `<p>${STILL_TO_FIND}</p>` });
  if (!frames || !isStoryboard(pics)) pics = pics.filter((p) => p.ph);
  if (frames) {
    // Full strips only: a sheet with a half-empty last row reads as gaps, so
    // the odd frames past the last full strip are left off.
    const per = pics.length % 3 !== 0 && pics.length % 4 === 0 ? 4 : pics.length === 12 ? 4 : 3;
    pics = pics.slice(0, Math.floor(pics.length / per) * per);
    const w = span(per);
    const frameH = (w / per) * (9 / 16);
    const strips = Math.ceil(pics.length / per);
    const rows = [];
    for (let s = 0; s < strips; s += 1) {
      rows.push({ h: frameH, cols: Array(per).fill(1) }, { h: GRID.caption, cols: Array(per).fill(1) });
    }
    const { tree, ids } = rowsTree(rows, mk);
    const gridCells = {};
    // A frame with no caption would leave an empty box (the app's "+") under it; then every frame is
    // numbered, as on a contact sheet, and a frame with no caption shows its number alone.
    const all = pics.every((p) => clean(p.it.caption));
    const capOf = (p, i) => {
      const c = clean(p.it.caption);
      if (all || /^\d+\s*[·.:—–-]/.test(c)) return frameCaption(c, i);
      return c ? `${i + 1} · ${c}` : String(i + 1);
    };
    for (let s = 0; s < strips; s += 1) {
      for (let c = 0; c < per; c += 1) {
        const p = pics[s * per + c];
        const img = ids[(2 * s) * per + c];
        const cap = ids[(2 * s + 1) * per + c];
        gridCells[img] = p ? image(p) : { type: 'empty' };
        gridCells[cap] = p ? { type: 'text', html: `<p>${esc(capOf(p, s * per + c))}</p>` } : { type: 'empty' };
      }
    }
    return {
      kind: 'grid', title: frameRange(clean(title), pics.length), layout: tree, templateId: null, seqId: null, gridCells,
      textStyle: { fontSize: 12, vAlign: 'center', ...(font ? { fontFamily: font } : {}) },
      photos: pics.filter((p) => p.ph).map((p) => p.key), w: Math.round(w), h: Math.round(strips * (frameH + GRID.caption)),
    };
  }
  const m = MOSAIC[Math.min(MOSAIC_MAX, pics.length)];
  const used = pics.slice(0, MOSAIC_MAX);
  const w = span(m.cols);
  // The hero row at 3:2, the rest following their shares.
  const top = m.rows[0];
  const h = ((w / top[1]) / 1.5) / top[0];
  const { tree, ids } = rowsTree(m.rows.map(([share, n]) => ({ h: share, cols: Array(n).fill(1) })), mk);
  const gridCells = {};
  ids.forEach((id, i) => { gridCells[id] = used[i] ? image(used[i]) : { type: 'empty' }; });
  return {
    kind: 'grid', title: clean(title), layout: tree, templateId: null, seqId: null, gridCells,
    photos: used.map((p) => p.key), w: Math.round(w), h: Math.round(Math.min(h, w * 1.1)),
  };
}

/** A checklist item's lines, as a note's body. */
export const checklistBody = (items = []) => items.map((x) => `[${x?.done ? 'x' : ' '}] ${clean(x?.text)}`).join('\n');

// The fit measures the app's sans. A typewriter mono sets far wider (0.6em a
// character against the sans's ~0.45em) and the serif a little wider, so a
// note in either is measured that much narrower, and past the fit's own
// ceiling: its last lines are never cut off.
export const FONT_FIT = Object.freeze({ [FONTS.mono]: 0.74, [FONTS.serif]: 0.93 });
export function noteCard(title, body, font) {
  const html = composeNoteHtml({ title, body });
  const fit = fitNoteSize({ html });
  const k = FONT_FIT[font];
  const h = k ? Math.max(fit.h, Math.ceil(noteContentHeight(html, Math.round(fit.w * k)) + NOTE_FIT.safety)) : fit.h;
  return { kind: 'note', html, w: fit.w, h, ...(title ? { title } : {}), ...(body ? { body } : {}), ...(font ? { fontFamily: font } : {}) };
}

// An arrow reads when it runs short and clear: the app's own attachment points
// (the sides it would leave and enter by), joined straight, cross no other
// card. A long one across the board, or one threading through a note, is
// dropped, as a missing photo is. → its length, or 0 when it doesn't read.
export const ARROW = Object.freeze({
  maxLen: 640, // longer and it's a line across the board
  pad: 6, // the room it keeps from a card it passes
  minLen: 96, // shorter and it's a stub between neighbours: the gap is opened to this
  roomMax: AUTO.column, // the widest gap opened to fit a label; past it the label goes
  // The label: 11px semibold at constant SCREEN size (styles.css .arrow-label-text),
  // set 7px off the line (CanvasSurface), so on the board it is that over the zoom.
  label: { charPx: 6.8, padPx: 12, hPx: 18, offPx: 7 },
  view: { w: 1180, h: 760 }, // the smallest canvas a shot fits the board into (a desktop shot's)
});
export function arrowReads(arrow, cards) {
  const cardById = Object.fromEntries(cards.map((c) => [c.id, c]));
  const [att] = computeArrowAttachments([arrow], { cardById, resolveGroupBBox: () => null });
  const a = att?.from?.point;
  const b = att?.to?.point;
  const len = a && b ? Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) : 0;
  if (!len || len > ARROW.maxLen) return 0;
  const blocked = cards.some((c) => c.id !== arrow.from && c.id !== arrow.to
    && crosses(a, b, { x: c.x - ARROW.pad, y: c.y - ARROW.pad, w: c.w + 2 * ARROW.pad, h: c.h + 2 * ARROW.pad }));
  return blocked ? 0 : len;
}
const ends = (arrow, cards) => {
  const cardById = Object.fromEntries(cards.map((c) => [c.id, c]));
  const [att] = computeArrowAttachments([arrow], { cardById, resolveGroupBBox: () => null });
  return att?.from?.point && att?.to?.point ? [att.from.point, att.to.point] : null;
};
const boxOf = (cards) => {
  const x0 = Math.min(...cards.map((c) => c.x));
  const y0 = Math.min(...cards.map((c) => c.y));
  return { x: x0, y: y0, w: Math.max(...cards.map((c) => c.x + c.w)) - x0, h: Math.max(...cards.map((c) => c.y + c.h)) - y0 };
};
const meets = (p, q, m = 0) => p.x < q.x + q.w + m && q.x < p.x + p.w + m && p.y < q.y + q.h + m && q.y < p.y + p.h + m;

/** The zoom the smallest shot fits these cards at: what the labels' size is read against. */
export function shotZoom(cards) {
  const b = boxOf(cards);
  return Math.min(1, ARROW.view.w / (b.w + 160), ARROW.view.h / (b.h + 160));
}

/** The world-space room a label needs along its arrow. */
export const labelRun = (label, zoom) => (String(label).length * ARROW.label.charPx + ARROW.label.padPx) / zoom + 2 * ARROW.pad;

/**
 * Whether an arrow's label sits clear of every card: drawn as the canvas draws
 * it, at the middle of the line, turned along it, set off it. Read as the box
 * around the turned label, so a slanted one is judged generously.
 */
export function labelClear(arrow, cards, zoom = shotZoom(cards)) {
  if (!arrow.label) return true;
  const e = ends(arrow, cards);
  if (!e) return false;
  const [a, b] = e;
  let deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  if (deg > 90) deg -= 180; else if (deg <= -90) deg += 180;
  const t = deg * Math.PI / 180;
  const L = ARROW.label;
  const w = (String(arrow.label).length * L.charPx + L.padPx) / zoom;
  const h = L.hPx / zoom;
  const off = L.offPx / zoom;
  const cx = (a.x + b.x) / 2 + off * Math.sin(t);
  const cy = (a.y + b.y) / 2 - off * Math.cos(t);
  const W = Math.abs(w * Math.cos(t)) + Math.abs(h * Math.sin(t));
  const H = Math.abs(w * Math.sin(t)) + Math.abs(h * Math.cos(t));
  const box = { x: cx - W / 2, y: cy - H / 2, w: W, h: H };
  return !cards.some((c) => meets(box, c));
}

/**
 * Two cards set next to each other with only the section's gap between them
 * join by a stub. Open the gap to `need`: below, the rest of that column moves
 * down; beside, the columns after it (and the sections beside it) move along.
 * → the cards with the room made, the same cards when it's there already, or
 * null when it can't be made without crowding another card.
 */
export function openRoom(cards, fromId, toId, need = ARROW.minLen) {
  const A = cards.find((c) => c.id === fromId);
  const B = cards.find((c) => c.id === toId);
  if (!A || !B) return null;
  const [hi, lo] = A.y <= B.y ? [A, B] : [B, A];
  const [l, r] = A.x <= B.x ? [A, B] : [B, A];
  const xOver = Math.min(hi.x + hi.w, lo.x + lo.w) - Math.max(hi.x, lo.x) > 0;
  const yOver = Math.min(l.y + l.h, r.y + r.h) - Math.max(l.y, r.y) > 0;
  let dx = 0;
  let dy = 0;
  let tries;
  if (xOver && lo.y >= hi.y + hi.h - 1) {
    const gap = lo.y - (hi.y + hi.h);
    if (gap >= need) return cards;
    dy = need - gap;
    // Under a card that spans the section (a table, a grid), every column
    // under it moves, so the line runs through open ground.
    return moveDown(cards, { line: hi.y + hi.h, x0: Math.min(hi.x, lo.x), x1: Math.max(hi.x + hi.w, lo.x + lo.w), groupId: lo.groupId, dy });
  } else if (yOver && r.x >= l.x + l.w - 1) {
    const gap = r.x - (l.x + l.w);
    if (gap >= need) return cards;
    dx = need - gap;
    const line = l.x + l.w;
    const own = cards.filter((c) => c.groupId === r.groupId);
    const band = boxOf(own);
    // Whole sections to the right on the same band move with it.
    const after = new Set(cards.filter((c) => c.groupId && c.groupId !== r.groupId).map((c) => c.groupId)
      .filter((g) => { const gb = boxOf(cards.filter((c) => c.groupId === g)); return gb.x >= line && gb.y < band.y + band.h && band.y < gb.y + gb.h; }));
    tries = [(c) => (c.groupId === r.groupId && c.x >= line - 1) || after.has(c.groupId)];
  } else {
    return cards; // corner to corner: its own length, read as it is
  }
  return shiftFirst(cards, tries, dx, dy);
}

/**
 * A section's cards at or under `line` whose columns meet x0…x1 move down by
 * dy; failing that, with the sections set under it (blocks, in rows). → the
 * cards moved, or null when either way crowds another card.
 */
function moveDown(cards, { line, x0, x1, groupId, dy }) {
  const column = (c) => c.groupId === groupId && c.y >= line - 1 && c.x < x1 && c.x + c.w > x0;
  const own = boxOf(cards.filter((c) => c.groupId === groupId));
  const under = new Set(cards.filter((c) => c.groupId && c.groupId !== groupId).map((c) => c.groupId)
    .filter((g) => { const gb = boxOf(cards.filter((c) => c.groupId === g)); return gb.y >= line && gb.x < own.x + own.w && own.x < gb.x + gb.w; }));
  return shiftFirst(cards, [column, (c) => column(c) || under.has(c.groupId)], 0, dy);
}

// The first of `tries` (each picks the cards that move) that moves them by dx, dy without crowding a card left.
function shiftFirst(cards, tries, dx, dy) {
  for (const moves of tries) {
    const next = cards.map((c) => (moves(c) ? { ...c, x: c.x + dx, y: c.y + dy } : c));
    const moved = next.filter((c, i) => c !== cards[i]);
    const still = next.filter((c, i) => c === cards[i]);
    const crowds = moved.some((m) => still.some((c) => meets(m, c, c.groupId === m.groupId ? AUTO.gap / 2 - 1 : 2 * GROUP_OUTLINE_PAD + AUTO.gap)));
    if (!crowds) return next;
  }
  return null;
}

function crosses(a, b, r) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let lo = 0;
  let hi = 1;
  for (const [p, q] of [[-dx, a.x - r.x], [dx, r.x + r.w - a.x], [-dy, a.y - r.y], [dy, r.y + r.h - a.y]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
  }
  return lo < hi;
}

// How far out of the check's shape a board is (0: in it), as a ratio.
const offShape = (cards) => {
  if (!cards.length) return 0;
  const b = boxOf(cards);
  const shape = b.w / Math.max(1, b.h);
  return Math.max(0, CHECK.shape[0] / shape - 1, shape / CHECK.shape[1] - 1);
};
const aspectOk = (cards) => {
  if (!cards.length) return true;
  const x0 = Math.min(...cards.map((c) => c.x));
  const y0 = Math.min(...cards.map((c) => c.y));
  const x1 = Math.max(...cards.map((c) => c.x + c.w));
  const y1 = Math.max(...cards.map((c) => c.y + c.h));
  const shape = (x1 - x0) / Math.max(1, y1 - y0);
  return shape >= CHECK.shape[0] && shape <= CHECK.shape[1];
};

/**
 * recipe: recipe.mjs's; found: Map('si.ii' → what the item is made of): a photo
 *   (photos.mjs, run over photoRecipe(recipe) so a sub-cluster's pictures are
 *   in it too), a sound (sounds.mjs, `media: 'sound'`) or a PDF (pdfs.mjs,
 *   `media: 'pdf'`);
 * links: links.mjs's Map('si.ii' → { url, title, description, image }).
 * newId: () => a fresh unique id (crypto.randomUUID in the engine).
 * style: styles.mjs's (default: the one the recipe names).
 * → { name, bg, groups, cards, arrows, strokes, children, tags, comments, vote, dropped, arrangement }
 *   children: the sub-clusters, each { id, name, bg, groups, cards, arrows }, its id its card's on the board
 *   tags: [{ name, cardIds }]; comments: [{ cardId, by (crew key), text, offset, reply? { by, text } }];
 *   vote: { cardId, label, up, down, offset } | null
 *   dropped: items whose photo, sound, PDF or link wasn't found, and arrows, comments or a vote that named no card.
 */
export function buildBoard(recipe, found, { newId, now = new Date().toISOString(), links = new Map(), style = styleNamed(recipe?.style) } = {}) {
  const font = style ? FONTS[style.font] || null : null;
  let n = 0;
  const mk = () => `c${(n += 1)}`;
  const fresh = [];
  const dropped = [];
  const sectionName = new Map(); // a section's name → as its frames sheet now numbers it
  const names = new Map(); // a title or caption → the card it names
  const name = (text, card) => { const k = norm(text); if (k && !names.has(k)) names.set(k, card); };
  const children = [];
  let clusterAt = (recipe.sections || []).length;
  // A sound's cover is a picture of the same world that isn't already beside it: a sub-cluster's last
  // (seen on this board, if at all, only small in the sub-cluster's card), else one from the section
  // farthest from the sound's, its own only when it has no other.
  const coverFor = (si) => {
    const pics = [];
    photoRecipe(recipe).sections.forEach((s, i) => (s.items || []).forEach((it, ii) => {
      const ph = found.get(`${i}.${ii}`);
      if (it?.kind === 'picture' && ph && !ph.video) pics.push({ i, key: `${i}.${ii}` });
    }));
    const own = (recipe.sections || []).length;
    const sub = pics.filter((p) => p.i >= own);
    if (sub.length) return sub[sub.length - 1].key;
    return [...pics].sort((a, b) => Math.abs(b.i - si) - Math.abs(a.i - si))[0]?.key || null;
  };

  (recipe.sections || []).forEach((s, si) => {
    const items = (s.items || []).map((it, ii) => ({ it, key: `${si}.${ii}` }));
    // Every picture of a grid section, found or not: a storyboard keeps a lost frame's place (photoGridCard).
    const gridAll = s.grid ? items.filter((x) => x.it.kind === 'picture').map((x) => ({ ...x, ph: found.get(x.key) || null })) : [];
    const gridPics = gridAll.filter((x) => x.ph);
    const asGrid = gridPics.length >= GRID.min;
    let grid = null;
    for (const { it, key } of items) {
      let card = null;
      if (it.kind === 'picture' || it.kind === 'video') {
        const ph = found.get(key);
        if (!ph) { dropped.push(key); continue; }
        if (asGrid && it.kind === 'picture') {
          if (!grid) {
            const frames = isFrameSheet(gridPics) || isStoryboard(gridAll);
            grid = photoGridCard(gridAll, { title: s.name, font, frames, mk });
            if (frames) sectionName.set(s.name, grid.title);
            card = grid;
            name(s.name, grid);
          }
          name(it.caption, grid);
          if (!card) continue;
        } else {
          const shape = pictureShape({ width: ph.w, height: ph.h });
          card = { kind: it.kind === 'video' ? 'video' : 'image', photo: key, w: shape.w, h: shape.h, aspect: shape.aspect,
            alt: clean(it.caption) || ph.alt || '' };
          if (it.kind === 'video') card.title = clean(it.caption);
          else if (clean(it.caption)) card.caption = clean(it.caption);
          name(it.caption, card);
        }
      } else if (it.kind === 'note') {
        card = noteCard(clean(it.title), clean(it.body), font);
      } else if (it.kind === 'checklist') {
        card = noteCard(clean(it.title), checklistBody(it.checks), font);
      } else if (it.kind === 'palette') {
        const { swatches } = readSwatches(it.swatches);
        if (!swatches) continue;
        card = { kind: 'palette', title: clean(it.title) || 'Palette', swatches, ...paletteSize(swatches.length) };
      } else if (it.kind === 'table') {
        card = tableCard(it, { font, mk });
      } else if (it.kind === 'doc') {
        card = { kind: 'doc', title: clean(it.title) || 'Untitled', prose: String(it.markdown || ''), ...PAGE_SHAPE };
      } else if (it.kind === 'script') {
        card = { kind: 'doc', title: clean(it.title) || 'Untitled script', script: String(it.fountain || ''), ...PAGE_SHAPE };
      } else if (it.kind === 'audio') {
        const snd = found.get(key);
        if (!snd) { dropped.push(key); continue; }
        const title = clean(it.title) || 'Sound';
        const cover = coverFor(si);
        card = { kind: 'audio', photo: key, title, duration: snd.duration, peaks: snd.peaks, ext: 'm4a', mime: 'audio/mp4',
          fileName: `${title.replace(/[^a-z0-9 ,.'()&-]/gi, '').trim() || 'Sound'}.m4a`, sizeBytes: snd.bytes, analyzed: 1,
          ...(cover ? { coverPhoto: cover } : {}), ...AUDIO_SHAPE };
      } else if (it.kind === 'pdf') {
        const pdf = found.get(key);
        if (!pdf) { dropped.push(key); continue; }
        card = { kind: 'pdf', photo: key, name: pdf.name, pageCount: pdf.pageCount, w: pdf.w, h: pdf.h };
      } else if (it.kind === 'cluster') {
        // Its pictures are photoRecipe's extra section for it; it is built as a board of its own.
        const at = clusterAt;
        clusterAt += 1;
        const pics = (it.searches || []).map((q, k) => ({ q, key: `${at}.${k}` })).filter((p) => found.get(p.key));
        if (pics.length < 2) { dropped.push(key); continue; }
        const sub = new Map(pics.map((p, k) => [`0.${k}`, found.get(p.key)]));
        const back = new Map(pics.map((p, k) => [`0.${k}`, p.key]));
        const own = { title: clean(it.title) || 'Cluster', sections: [{ name: '', items: [
          ...pics.map((p) => ({ kind: 'picture', search: p.q })),
          ...(clean(it.body) ? [{ kind: 'note', title: '', body: it.body }] : []),
        ] }] };
        const child = buildBoard(own, sub, { newId, now, style: style ? { ...style, arrangement: 'pictures' } : null });
        const id = newId();
        children.push({ id, name: child.name, bg: child.bg, groups: child.groups, cards: child.cards.map((c) => rekey(c, back)), arrows: [] });
        card = { kind: 'board', childId: id, ...CLUSTER_SHAPE };
      } else if (it.kind === 'link') {
        const l = links.get(key);
        if (!l) { dropped.push(key); continue; }
        // Words only: Wikipedia's picture is never from the board's world (a black-and-white still on a
        // warm board, a sunny lighthouse in February), and the grade failed boards over it again and again.
        card = { kind: 'link', source: l.url, link: l.url, title: l.title, ...(l.description ? { description: l.description } : {}),
          w: LINK_SHAPE.w, h: LINK_SHAPE.h };
        name(it.title, card);
        name(l.title, card);
      }
      if (!card) continue;
      if (card.kind !== 'image' && card.kind !== 'video') name(it.title, card);
      card.section = s.name || null; // renamed below when its frames sheet is renumbered
      card.key = key;
      fresh.push(card);
    }
  });

  for (const c of fresh) if (sectionName.has(c.section)) c.section = sectionName.get(c.section);
  // The board's first video plays by itself, muted, as a person sets one to.
  const lead = fresh.find((c) => c.kind === 'video');
  if (lead) lead.autoplay = true;

  // A card an arrow leaves from goes straight after the card it points at, in
  // the same section, so the layout sets the two side by side and the arrow
  // runs short and clear (arrowReads below keeps only the ones that do).
  // A palette, table or photo grid spans the top of its section (layoutAuto), so a
  // card pointing at one goes first among the rest: the top of the first column,
  // right under it.
  const spans = (c) => c.kind === 'palette' || (c.kind !== 'image' && c.kind !== 'video' && c.w > AUTO.column * 1.5);
  for (const a of Array.isArray(recipe.arrows) ? recipe.arrows : []) {
    const f = names.get(norm(a?.from));
    const t = names.get(norm(a?.to));
    if (!f || !t || f === t || f.section !== t.section || spans(f)) continue;
    fresh.splice(fresh.indexOf(f), 1);
    const at = spans(t) ? fresh.findIndex((c) => c.section === t.section && !spans(c)) : fresh.indexOf(t) + 1;
    fresh.splice(at < 0 ? fresh.indexOf(t) + 1 : at, 0, f);
  }

  // The sections that kept a card, in order, coloured as the API colours them.
  const named = [];
  const seen = new Set();
  for (const s of recipe.sections || []) {
    const nm = sectionName.get(s.name) ?? s.name;
    if (!nm || seen.has(sectionKey(nm)) || !fresh.some((c) => c.section && sectionKey(c.section) === sectionKey(nm))) continue;
    seen.add(sectionKey(nm));
    named.push({ name: nm, color: s.color || null });
  }
  const { wanted } = readSections(named, []);
  const plan = resolveSections([], wanted || [], { now, newId });
  const colours = new Map(plan.created.map((g) => [g.id, g.color]));
  const grouped = fresh.map((c) => {
    const groupId = c.section ? plan.idByKey.get(sectionKey(c.section)) ?? null : null;
    return groupId ? { ...c, groupId } : c;
  });
  const tinted = tintNewNotes(grouped, [], colours);

  // The style's arrangement, unless it would come out a strip or a tower: then `auto` chooses.
  // arrangeAuto hands the cards back in the order given, so laid[i] is fresh[i].
  const lay = (a) => {
    let used = null;
    const cards = arrangeAuto([], tinted, { ...(a ? { arrangement: a } : {}), onArrangement: (x) => { used = x; } });
    return { cards, used };
  };
  // The style's arrangement, else auto's, else whichever other comes out in
  // shape; when none does, the one nearest it.
  let pick = lay(style?.arrangement);
  for (const a of [null, ...ARRANGEMENTS.filter((x) => x !== style?.arrangement)]) {
    if (aspectOk(pick.cards)) break;
    const next = lay(a);
    if (aspectOk(next.cards) || offShape(next.cards) < offShape(pick.cards)) pick = next;
  }
  const laid = pick.cards;
  const arrangement = pick.used;

  const cards = laid.map((c, i) => {
    const { aspect: _a, section: _s, key: _k, childId, ...rest } = c;
    let card = { ...rest, id: childId || newId(), x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) };
    if (card.kind === 'note') card = { ...card, bgColor: card.bgColor ?? null, color: null };
    if (card.kind === 'image' && card.caption) {
      const fit = fitCaption(card.caption, card.w);
      if (fit) card.caption = fit; else delete card.caption;
    }
    return stampCard(card, i, now);
  });
  const idOf = new Map(fresh.map((f, i) => [f, cards[i].id]));

  // Each arrow gets room to be seen: a stub between neighbours has its gap
  // opened, wider still when its label fits along it; a label that would sit
  // over a card goes. Room made for one arrow can't spoil one already set, so
  // each set is checked again against the cards as they end up.
  let placed = cards;
  const zoom = shotZoom(cards);
  const arrows = [];
  for (const a of Array.isArray(recipe.arrows) ? recipe.arrows : []) {
    const from = idOf.get(names.get(norm(a?.from)));
    const to = idOf.get(names.get(norm(a?.to)));
    const what = `arrow ${clean(a?.from)} → ${clean(a?.to)}`;
    if (!from || !to || from === to || arrows.some((x) => x.from === from && x.to === to)) { dropped.push(what); continue; }
    const arrow = { from, to, thickness: 'medium', ...(clean(a.label) ? { label: clean(a.label) } : {}) };
    const run = arrow.label ? labelRun(arrow.label, zoom) : 0;
    let room = run && run <= ARROW.roomMax ? openRoom(placed, from, to, Math.max(ARROW.minLen, run)) : null;
    if (room && !labelClear(arrow, room, zoom)) room = null;
    if (room && !aspectOk(room)) room = null;
    if (!room) { delete arrow.label; room = openRoom(placed, from, to); }
    if (room && !aspectOk(room)) room = null;
    if (!room) { dropped.push(`${what} (no room beside its card)`); continue; }
    const len = arrowReads(arrow, room);
    if (!len || arrows.some((x) => !arrowReads(x, room) || !labelClear(x, room, zoom))) {
      dropped.push(`${what} (would cross other cards)`);
      continue;
    }
    if (len < ARROW.minLen / 2) { dropped.push(`${what} (a stub: its cards touch)`); continue; }
    placed = room;
    arrows.push(arrow);
  }

  // Tags, the crew's comments and the vote go on the cards the recipe names.
  const cardOf = (text) => idOf.get(names.get(norm(text))) || null;
  const tags = [];
  for (const t of Array.isArray(recipe.tags) ? recipe.tags : []) {
    const nm = clean(t?.name);
    const cardIds = [...new Set((Array.isArray(t?.on) ? t.on : []).map(cardOf).filter(Boolean))];
    if (!nm || !cardIds.length || tags.some((x) => norm(x.name) === norm(nm))) { dropped.push(`tag ${nm}`); continue; }
    tags.push({ name: nm, cardIds });
  }
  // Each bubble takes the side of its card that covers least (placeBubble); where every side covers a
  // card, room is made in its column (bubbleRoom), so long as the arrows still read. `marks` are where
  // the bubbles end up, so the shots can frame them in.
  const labelsOf = (cs) => plan.created.map((g) => cs.filter((c) => c.groupId === g.id)).filter((g) => g.length)
    .map((g) => boxOf(g)).map((b) => ({ x: b.x - 4, y: b.y - 36, w: 220, h: 30 })); // the section name, as CanvasSurface draws it
  const chipsOf = (cs) => cs.map((c) => tagStrip(c, tags.filter((t) => t.cardIds.includes(c.id)).map((t) => t.name))).filter(Boolean);
  const bubbles = [];
  const marksOn = (cs) => bubbles.map((b) => ({ ...bubbleRect(cs.find((c) => c.id === b.cardId), b.offset, b.size), kind: b.kind, cardId: b.cardId }));
  const arrowsOk = (cs) => arrows.every((x) => arrowReads(x, cs) && labelClear(x, cs, zoom));
  // The vote's loop rings its card and the card's tags (loopBox); where that reaches the next card down its
  // column, the rest of the column moves down to clear it, before any bubble is placed.
  const voteId = recipe.vote ? cardOf(recipe.vote.on) : null;
  const ringOf = (cs) => { const c = cs.find((x) => x.id === voteId); return c ? loopBox(c, chipsOf([c])[0] || null) : null; };
  if (voteId) {
    const c = placed.find((x) => x.id === voteId);
    const ring = ringOf(placed);
    const under = placed.filter((o) => o.id !== c.id && o.groupId === c.groupId && o.y >= c.y + c.h - 1 && o.x < ring.x + ring.w && o.x + o.w > ring.x);
    const top = under.length ? Math.min(...under.map((o) => o.y)) : Infinity;
    const reach = ring.y + ring.h + LOOP_REACH;
    if (top < reach) {
      const next = moveDown(placed, { line: c.y + c.h, x0: ring.x, x1: ring.x + ring.w, groupId: c.groupId, dy: Math.ceil(reach - top) });
      if (next && arrowsOk(next)) placed = next;
    }
  }
  const bubbleBy = (cardId, size, kind) => {
    const box = placed.find((p) => p.id === cardId);
    const obstacles = (cs) => [...cs.filter((p) => p.id !== cardId), ...labelsOf(cs), ...chipsOf(cs)];
    const at = placeBubble(box, size, { obstacles: obstacles(placed), placed: marksOn(placed), edge: boxOf(placed) });
    let offset = at.offset;
    if (at.covers > 0) {
      const cover = (rect, cs) => [...obstacles(cs), ...marksOn(cs)].reduce((n, o) => n + area(rect, o), 0);
      const room = bubbleRoom(placed, cardId, size, { cover, ok: arrowsOk });
      if (room) ({ cards: placed, offset } = room);
    }
    bubbles.push({ cardId, size, kind, offset });
    return offset;
  };
  const comments = [];
  for (const c of Array.isArray(recipe.comments) ? recipe.comments : []) {
    const cardId = cardOf(c?.on);
    const who = crewOf(c?.by);
    if (!cardId || !who || !clean(c?.text)) { dropped.push(`comment on ${clean(c?.on)}`); continue; }
    const re = c.reply && crewOf(c.reply.by) && crewOf(c.reply.by) !== who && clean(c.reply.text)
      ? { by: crewOf(c.reply.by).key, text: clean(c.reply.text) } : null;
    const offset = bubbleBy(cardId, re ? BUBBLE.thread : BUBBLE.comment, 'comment');
    comments.push({ cardId, by: who.key, text: clean(c.text), offset, ...(re ? { reply: re } : {}) });
  }
  let vote = null;
  if (recipe.vote) {
    const cardId = cardOf(recipe.vote.on);
    if (!cardId) dropped.push(`vote on ${clean(recipe.vote.on)}`);
    else {
      const label = clean(recipe.vote.label);
      const offset = bubbleBy(cardId, voteSize(label), 'vote');
      vote = { cardId, label, up: recipe.vote.up | 0, down: recipe.vote.down | 0, offset };
    }
  }
  // Drawn once the cards have stopped moving.
  const marks = marksOn(placed).map((m) => ({ ...m, groupId: placed.find((c) => c.id === m.cardId).groupId || null }));
  const strokes = vote ? [{ color: MARKUP.color, width: MARKUP.width, brush: MARKUP.brush, points: markerLoop(ringOf(placed)) }] : [];

  return {
    name: recipe.title || 'Untitled',
    bg: style?.ground || null,
    groups: plan.created,
    cards: placed,
    arrows,
    strokes,
    children,
    tags,
    comments,
    vote,
    marks,
    dropped,
    arrangement,
  };
}

/** The keys of what a card shows: its own picture, sound or PDF, or a photo grid's pictures (not a sound's cover). */
export const photoKeysOf = (c) => (c.photo ? [c.photo] : Array.isArray(c.photos) ? c.photos : []);

/**
 * The cards with their files' srcs: srcOf(item, what, card) → string, `what`
 * one of 'src' | 'video' | 'poster' (a picture or video), 'sound' (a sound),
 * 'cover' (a sound's cover, a picture of its own), 'pdf' | 'thumb' (a PDF and
 * its page 1). The `photo` keys stay on the cards (and a grid's cells) for the
 * caller and are stripped on write.
 */
export function withSources(cards, found, srcOf) {
  return cards.map((c) => {
    if (c.kind === 'audio' && c.photo) {
      const cover = c.coverPhoto ? found.get(c.coverPhoto) : null;
      return { ...c, src: srcOf(found.get(c.photo), 'sound', c), ...(cover ? { cover: srcOf(cover, 'cover', c) } : {}) };
    }
    if (c.kind === 'pdf' && c.photo) {
      const pdf = found.get(c.photo);
      return { ...c, pdfSrc: srcOf(pdf, 'pdf', c), src: srcOf(pdf, 'thumb', c) };
    }
    if (c.kind === 'grid' && Array.isArray(c.photos)) {
      const gridCells = Object.fromEntries(Object.entries(c.gridCells || {}).map(([id, cell]) => {
        if (cell?.type !== 'image' || !cell.photo) return [id, cell];
        const ph = found.get(cell.photo);
        return [id, { ...cell, src: srcOf(ph, 'src') }];
      }));
      return { ...c, gridCells };
    }
    if (!c.photo) return c;
    const ph = found.get(c.photo);
    const size = { srcW: ph.w, srcH: ph.h };
    if (c.kind === 'video') return { ...c, src: srcOf(ph, 'video'), poster: srcOf(ph, 'poster'), ...size };
    return { ...c, src: srcOf(ph, 'src'), ...size };
  });
}

export const stripBuild = (cards) => cards.map(({ photo: _p, photos: _ps, coverPhoto: _cp, ...c }) => {
  if (c.kind !== 'grid' || !c.gridCells) return c;
  return { ...c, gridCells: Object.fromEntries(Object.entries(c.gridCells).map(([id, { photo: _x, ...cell }]) => [id, cell])) };
});
