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
//   · a video, laid out as a picture of its shape
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

const span = (n) => n * AUTO.column + (n - 1) * AUTO.gap;

// A doc or a script on the board: a column wide, a page tall, so the closed
// card shows its opening lines under its name.
export const PAGE_SHAPE = Object.freeze({ w: AUTO.column, h: Math.round(AUTO.column * 1.25) });
export const SCRIPT_SHAPE = Object.freeze({ width: PAGE_SHAPE.w * 4, height: PAGE_SHAPE.h * 4 });

// A link preview: the canvas's own sizes (cards.jsx LinkCard), taller with a picture.
export const LINK_SHAPE = Object.freeze({ w: 280, h: 110, withImage: 290 });

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

/**
 * A photo grid's card. pics: [{ key, it, ph }] in order. A storyboard sheet when
 * they're frames (most of them captioned): rows of three or four frames at
 * 16:9, each with its caption in the row under it; else a mosaic.
 */
export function photoGridCard(pics, { title = '', font = null, frames = false, mk }) {
  const image = (p) => ({ type: 'image', photo: p.key, fit: 'cover', alt: clean(p.it.caption) || clean(p.ph.alt) });
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
    for (let s = 0; s < strips; s += 1) {
      for (let c = 0; c < per; c += 1) {
        const p = pics[s * per + c];
        const img = ids[(2 * s) * per + c];
        const cap = ids[(2 * s + 1) * per + c];
        gridCells[img] = p ? image(p) : { type: 'empty' };
        gridCells[cap] = p && clean(p.it.caption) ? { type: 'text', html: `<p>${esc(frameCaption(p.it.caption, s * per + c))}</p>` } : { type: 'empty' };
      }
    }
    return {
      kind: 'grid', title: frameRange(clean(title), pics.length), layout: tree, templateId: null, seqId: null, gridCells,
      textStyle: { fontSize: 12, vAlign: 'center', ...(font ? { fontFamily: font } : {}) },
      photos: pics.map((p) => p.key), w: Math.round(w), h: Math.round(strips * (frameH + GRID.caption)),
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
    const line = hi.y + hi.h;
    // Under a card that spans the section (a table, a grid), every column
    // under it moves, so the line runs through open ground.
    const x0 = Math.min(hi.x, lo.x);
    const x1 = Math.max(hi.x + hi.w, lo.x + lo.w);
    const column = (c) => c.groupId === lo.groupId && c.y >= line - 1 && c.x < x1 && c.x + c.w > x0;
    // A section set under this one (blocks, in rows) moves down with it.
    const own = boxOf(cards.filter((c) => c.groupId === lo.groupId));
    const under = new Set(cards.filter((c) => c.groupId && c.groupId !== lo.groupId).map((c) => c.groupId)
      .filter((g) => { const gb = boxOf(cards.filter((c) => c.groupId === g)); return gb.y >= line && gb.x < own.x + own.w && own.x < gb.x + gb.w; }));
    tries = [column, (c) => column(c) || under.has(c.groupId)];
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
 * recipe: recipe.mjs's; found: photos.mjs's Map('si.ii' → photo);
 * links: links.mjs's Map('si.ii' → { url, title, description, image }).
 * newId: () => a fresh unique id (crypto.randomUUID in the engine).
 * style: styles.mjs's (default: the one the recipe names).
 * → { name, bg, groups, cards, arrows, dropped, arrangement }
 *   dropped: items whose photo or link wasn't found, and arrows that named no card.
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

  (recipe.sections || []).forEach((s, si) => {
    const items = (s.items || []).map((it, ii) => ({ it, key: `${si}.${ii}` }));
    const gridPics = s.grid ? items.filter((x) => x.it.kind === 'picture' && found.get(x.key)).map((x) => ({ ...x, ph: found.get(x.key) })) : [];
    const asGrid = gridPics.length >= GRID.min;
    let grid = null;
    for (const { it, key } of items) {
      let card = null;
      if (it.kind === 'picture' || it.kind === 'video') {
        const ph = found.get(key);
        if (!ph) { dropped.push(key); continue; }
        if (asGrid && it.kind === 'picture') {
          if (!grid) {
            const frames = gridPics.filter((p) => clean(p.it.caption)).length >= Math.ceil(gridPics.length / 2) && gridPics.length >= 6;
            grid = photoGridCard(gridPics, { title: s.name, font, frames, mk });
            if (frames) sectionName.set(s.name, frameRange(s.name, grid.photos.length));
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
      } else if (it.kind === 'link') {
        const l = links.get(key);
        if (!l) { dropped.push(key); continue; }
        card = { kind: 'link', source: l.url, link: l.url, title: l.title, ...(l.description ? { description: l.description } : {}),
          ...(l.image ? { image: l.image } : {}), w: LINK_SHAPE.w, h: l.image ? LINK_SHAPE.withImage : LINK_SHAPE.h };
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
    const { aspect: _a, section: _s, key: _k, ...rest } = c;
    let card = { ...rest, id: newId(), x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) };
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

  return {
    name: recipe.title || 'Untitled',
    bg: style?.ground || null,
    groups: plan.created,
    cards: placed,
    arrows,
    dropped,
    arrangement,
  };
}

/** The photo keys a card shows: its own picture, or a photo grid's. */
export const photoKeysOf = (c) => (c.photo ? [c.photo] : Array.isArray(c.photos) ? c.photos : []);

/**
 * The cards with their pictures' srcs: srcOf(photo, 'src' | 'video' | 'poster') → string.
 * The `photo` keys stay on the cards (and a grid's cells) for the caller and
 * are stripped on write.
 */
export function withSources(cards, found, srcOf) {
  return cards.map((c) => {
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

export const stripBuild = (cards) => cards.map(({ photo: _p, photos: _ps, ...c }) => {
  if (c.kind !== 'grid' || !c.gridCells) return c;
  return { ...c, gridCells: Object.fromEntries(Object.entries(c.gridCells).map(([id, { photo: _x, ...cell }]) => [id, cell])) };
});
