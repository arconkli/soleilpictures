// layoutAuto — `auto`, how the API lays a board out unless it's asked for
// another layout (P7). Worker-only: the canvas's Tidy up keeps layoutEngine's
// layouts, and the app's bundle never carries this one.
//
// A board an assistant makes reads as its sections. ChatGPT's film diary
// (2026-10-27) had four, and every layout before this one did something to
// them nobody wanted: justified stretched its notes into a picture's row, grid
// sized every cell to its tallest note, masonry sorted the notes by colour.
// Here each section is laid out as a block of its own:
//
//   · pictures (images and videos), with or without a palette: the palette
//     across the top, the pictures under it in rows across the block, every
//     picture whole, the rows broken where they come out most even
//   · anything else: columns, each card in turn going into the shortest one,
//     at its own size; a picture takes the column's width, and a palette or a
//     card wider than a column spans the top
//
// and the blocks are set out one of three ways, whichever suits what the board
// holds (the P7 mockups' A, B and C; the owner, shown all three: "it should do
// whatever makes the most sense for the task at hand"):
//
//   · pictures lead (C): at least half the cards are pictures, some sections
//     are pictures alone and others hold words, as a moodboard does: the
//     picture sections large, in two columns, each under the shorter one, and
//     the other sections in a column beside them
//   · columns (A): one row of the sections, each a column (a long one two or
//     more wide), read left to right as lists are; taken whenever the board
//     shows on a screen about as large as it would as blocks
//   · blocks (B): anything else: the blocks in rows, in order, at the width
//     that brings the board nearest the aim with its rows about as wide as
//     each other
//
// The aim is a 16:10 screen, and neither of the first two is ever taken for a
// board that comes out a strip. Cards in no section make one block more, with
// no outline.
//
// The order is the caller's (`order`), else reading order: by top edge, then
// left edge, the sections in the order their first cards come. A column is
// filled in that same order (the shortest column, the leftmost of equals), and
// every arrangement keeps the sections' order, so laying out a board this laid
// out moves nothing.

import { GROUP_OUTLINE_PAD, LAYOUT_GAP } from './layoutEngine.js';
import { boundsOfCards } from './canvasGeom.js';
import { withGeometry, pushClearOf, blockBounds } from './moodboard.js';
import { NOTE_FIT } from './noteFit.js';
import { paletteSize } from './apiCards.js';

export const AUTO_LAYOUT = 'auto';

// Every layout the API takes by name: auto, its default, then layoutEngine's
// LAYOUTS, which the canvas shares (a test keeps the two lists in step).
export const API_LAYOUTS = ['auto', 'justified', 'masonry', 'grid', 'row', 'column'];

export const AUTO = Object.freeze({
  column: NOTE_FIT.width, // a column's width: a note's
  gap: LAYOUT_GAP, // between two cards of a section
  across: 40, // between two sections' outlines, side by side
  down: 64, // between two rows of sections, outline to outline: the names sit in it
  rowHeight: 210, // what a row of pictures aims at
  leadShare: 0.5, // the pictures lead from this share of the cards
  leadColumns: 2, // the columns the picture sections make when they lead
  leadRowHeight: 240, // what a row of pictures aims at when they lead
  shape: '16:10', // what the whole board aims at
  maxColumns: 12, // the most columns a section takes
  columnsWide: 4, // the widest a section grows when the sections are columns
  besideWide: 3, // the widest a section beside the pictures grows
});

// The three ways the blocks are set out, as the answer and the docs name them.
export const ARRANGEMENTS = Object.freeze(['columns', 'blocks', 'pictures']);

const [SHAPE_W, SHAPE_H] = AUTO.shape.split(':').map(Number);
const ASPECT = SHAPE_W / SHAPE_H;
const PAD = GROUP_OUTLINE_PAD;
// Where a batch starts on a board with nothing on it (layoutEngine's margin).
const MARGIN = 80;
// A card with no usable size (layoutEngine's default).
const DEFAULT_W = 280;
const DEFAULT_H = 180;
// A picture's aspect outside this is a broken dimension (layoutEngine's).
const MIN_ASPECT = 0.2;
const MAX_ASPECT = 5;
// A card this many columns wide spans the top of its section.
const SPAN_AT = 1.5;
// A lone picture in a row never grows past this many times the aim.
const ROW_MAX = 2;
// The search: every combination of section widths up to this many, else one
// section at a time.
const EXHAUSTIVE = 64;
// Columns: the heights a section is kept under, tried in turn.
const COLUMN_SCAN = { from: 300, to: 3000, step: 20 };
// Columns are taken while the board shows on a screen at least 1/ROOM as large
// as it would as blocks: side by side the sections read as lists, in order,
// and that is worth a little screen.
const ROOM = 1.2;
// A board more than this far from the aim's shape, either way, is a strip:
// columns and pictures leading are never taken for one.
const STRIP = 1.5;
// How many columns the picture sections are when the pictures lead.
const LEAD_COLUMNS = [2, 3];

const isPicture = (c) => c?.kind === 'image' || c?.kind === 'video';
// A card that spans the top of its section rather than taking a column.
const spansTop = (c, column = AUTO.column) => c.kind === 'palette' || (!isPicture(c) && c.w > column * SPAN_AT);
// A section of pictures: a palette over them at most.
const allPictures = (cards) => {
  const rest = cards.filter((c) => !spansTop(c));
  return rest.length > 0 && rest.every(isPicture);
};
// How wide a card needs its section to be. A palette is stretched to its
// section's width, so it is measured by its swatches, not by the width the last
// layout gave it.
const ownWidth = (c) => (c.kind === 'palette' && Array.isArray(c.swatches) && c.swatches.length
  ? paletteSize(c.swatches.length).w : c.w);
const sectionOf = (c) => (c?.groupId ? String(c.groupId) : null);

function aspectOf(c) {
  const given = Number(c?.aspect);
  const a = given > 0 ? given : Number(c?.w) / Number(c?.h);
  return Number.isFinite(a) && a > 0 ? Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, a)) : 4 / 3;
}

// Top edge, then left edge.
export function readingOrder(cards) {
  const at = (v) => (Number.isFinite(v) ? v : 0);
  return [...(cards || [])].sort((a, b) => (at(a.y) - at(b.y)) || (at(a.x) - at(b.x)));
}

// Row by row, as a person reads a board: cards centred on one line are one
// row, read left to right whatever their heights; otherwise top, then left.
// The canvas grid centres each card in its cell, so a short note sits lower
// than the tall one beside it, and top-then-left reads the tall one first.
export function rowOrder(cards) {
  const at = (v) => (Number.isFinite(v) ? v : 0);
  const list = (cards || []).map((c, i) => ({ c, i, top: at(c.y), mid: at(c.y) + at(c.h) / 2 }));
  // A line: centres within a pixel of its first card's (positions are whole
  // pixels, so a centred card's centre is off by half a pixel at most).
  const byMid = [...list].sort((a, b) => a.mid - b.mid);
  for (let start = 0; start < byMid.length;) {
    let end = start + 1;
    while (end < byMid.length && byMid[end].mid - byMid[start].mid <= 1) end++;
    const line = byMid.slice(start, end);
    const top = Math.min(...line.map((p) => p.top));
    for (const p of line) p.row = top;
    start = end;
  }
  return list.sort((a, b) => (a.row - b.row) || (at(a.c.x) - at(b.c.x)) || (a.i - b.i)).map((p) => p.c);
}

const sameBoxes = (laid, was) => {
  const by = new Map(was.map((c) => [String(c.id), c]));
  return laid.length === was.length && laid.every((c) => {
    const b = by.get(String(c.id));
    return b && b.x === c.x && b.y === c.y && b.w === c.w && b.h === c.h;
  });
};

// The cards `order` names (ids) first, in its order; the rest after them, in
// the order they came.
export function inOrder(cards, order) {
  if (!Array.isArray(order) || !order.length) return [...(cards || [])];
  const rank = new Map();
  order.forEach((id, i) => { if (!rank.has(String(id))) rank.set(String(id), i); });
  return (cards || [])
    .map((c, i) => ({ c, i, r: rank.get(String(c?.id)) ?? Infinity }))
    .sort((p, q) => (p.r === q.r ? p.i - q.i : p.r < q.r ? -1 : 1))
    .map((p) => p.c);
}

// Pictures into rows across `width`, as many rows as the aim gives, broken
// where each row's share of the pictures comes out nearest an even split.
// Returns the rows as lists of indices into `aspects`.
function pictureRows(aspects, width, rowHeight) {
  const n = aspects.length;
  const total = aspects.reduce((s, a) => s + a, 0);
  const r = Math.max(1, Math.min(n, Math.round((total * rowHeight) / width)));
  const all = aspects.map((_, i) => i);
  if (r === 1) return [all];
  const pre = [0];
  for (const a of aspects) pre.push(pre[pre.length - 1] + a);
  const target = total / r;
  // The most pictures one row takes, so a big section stays quick to solve.
  const most = Math.min(n, Math.ceil((2 * n) / r) + 2);
  const cost = Array.from({ length: r + 1 }, () => new Float64Array(n + 1).fill(Infinity));
  const cut = Array.from({ length: r + 1 }, () => new Int32Array(n + 1));
  cost[0][0] = 0;
  for (let j = 1; j <= r; j++) {
    for (let i = j; i <= n - (r - j); i++) {
      for (let s = Math.max(j - 1, i - most); s < i; s++) {
        const before = cost[j - 1][s];
        if (before === Infinity) continue;
        const d = pre[i] - pre[s] - target;
        const c = before + d * d;
        if (c < cost[j][i]) { cost[j][i] = c; cut[j][i] = s; }
      }
    }
  }
  const rows = [];
  let end = n;
  for (let j = r; j >= 1; j--) {
    const start = cut[j][end];
    rows.unshift(all.slice(start, end));
    end = start;
  }
  return rows;
}

// One section laid out `k` columns wide, from its own top-left:
// { w, h, at: [{ x, y, w, h }] }, `at` in the order of `cards`.
function sectionBlock(cards, k, o) {
  const at = new Array(cards.length);
  const spans = [];
  const rest = [];
  cards.forEach((c, i) => (spansTop(c, o.column) ? spans : rest).push(i));

  const colW = Math.max(o.column, ...rest.filter((i) => !isPicture(cards[i])).map((i) => cards[i].w));
  const pictures = rest.length > 0 && rest.every((i) => isPicture(cards[i]));
  const cols = pictures ? k : Math.max(1, Math.min(k, rest.length));
  const W = Math.max(cols * colW + (cols - 1) * o.gap, ...spans.map((i) => ownWidth(cards[i])));

  let run = 0;
  for (const i of spans) {
    const c = cards[i];
    // A palette is as wide as its section; anything else keeps its size.
    at[i] = { x: 0, y: run, w: c.kind === 'palette' ? W : c.w, h: c.h };
    run += c.h + o.gap;
  }

  if (pictures) {
    const aspects = rest.map((i) => aspectOf(cards[i]));
    for (const row of pictureRows(aspects, W, o.rowHeight)) {
      const sum = row.reduce((s, n) => s + aspects[n], 0);
      const h = Math.min((W - o.gap * (row.length - 1)) / sum, o.rowHeight * ROW_MAX);
      // Edges are rounded, not sizes, so two neighbours never share a pixel.
      const top = Math.round(run);
      const bottom = Math.round(run + h);
      let x = 0;
      for (const n of row) {
        const left = Math.round(x);
        const right = Math.round(x + aspects[n] * h);
        at[rest[n]] = { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
        x += aspects[n] * h + o.gap;
      }
      run += h + o.gap;
    }
  } else if (rest.length) {
    const bottoms = new Array(cols).fill(run - o.gap);
    for (const i of rest) {
      const c = cards[i];
      let j = 0;
      for (let m = 1; m < cols; m++) if (bottoms[m] < bottoms[j]) j = m;
      const w = isPicture(c) ? colW : c.w;
      const h = isPicture(c) ? Math.max(1, Math.round(colW / aspectOf(c))) : c.h;
      const y = bottoms[j] + o.gap;
      at[i] = { x: j * (colW + o.gap), y, w, h };
      bottoms[j] = y + h;
    }
  }

  const h = Math.max(...at.map((p) => p.y + p.h));
  return { w: W, h, at };
}

// Blocks set out in rows, in order, at the row width whose board comes nearest
// the aim with its rows about as wide as each other. Returns the rows as lists
// of block indices.
function packRows(blocks, o) {
  const outerW = blocks.map((b) => b.w + 2 * PAD);
  const outerH = blocks.map((b) => b.h + 2 * PAD);
  const total = outerW.reduce((s, w) => s + w, 0) + o.across * (blocks.length - 1);
  const widest = Math.max(...outerW);

  const at = (limit) => {
    const rows = [];
    let row = [];
    let w = 0;
    blocks.forEach((_, i) => {
      const add = (row.length ? o.across : 0) + outerW[i];
      if (row.length && w + add > limit) {
        rows.push(row);
        row = [];
        w = 0;
      }
      w += (row.length ? o.across : 0) + outerW[i];
      row.push(i);
    });
    if (row.length) rows.push(row);
    const widths = rows.map((r) => r.reduce((s, i, n) => s + outerW[i] + (n ? o.across : 0), 0));
    const W = Math.max(...widths);
    const H = rows.reduce((s, r) => s + Math.max(...r.map((i) => outerH[i])), 0) + o.down * (rows.length - 1);
    const ragged = rows.length > 1 ? 1 - Math.min(...widths) / W : 0;
    return { rows, W, H, score: Math.abs(Math.log(W / H / ASPECT)) + 0.8 * ragged };
  };

  let best = null;
  const step = Math.max(20, (total - widest) / 240);
  for (let limit = widest; ; limit = Math.min(total, limit + step)) {
    const p = at(limit);
    if (!best || p.score < best.score - 1e-9) best = p;
    if (limit >= total) break;
  }
  return best;
}

// How many columns a section may take. A board of one section takes whatever
// brings it nearest the aim; with others beside it, a section stays compact.
function columnChoices(n, lone, o) {
  if (lone) return Array.from({ length: Math.max(1, Math.min(n, o.maxColumns)) }, (_, i) => i + 1);
  if (n <= 1) return [1];
  if (n === 2) return [1, 2];
  if (n <= 8) return [2, 3];
  if (n <= 24) return [3, 4];
  return [4, 5, 6];
}

// Each section's block at each width tried, made once.
function blockCache(sections, o) {
  const cache = new Map();
  return (si, k, rowHeight = o.rowHeight) => {
    const key = `${si}:${k}:${rowHeight}`;
    if (!cache.has(key)) {
      cache.set(key, sectionBlock(sections[si].cards, k, rowHeight === o.rowHeight ? o : { ...o, rowHeight }));
    }
    return cache.get(key);
  };
}

// Blocks in rows from (x0, 0), outline to outline: a row's blocks top-aligned
// `across` apart, the rows `down` apart. Takes rows of { si, block } and
// returns them placed, [{ si, block, x, y }].
function inRows(rows, o, x0 = 0) {
  const at = [];
  let y = 0;
  for (const row of rows) {
    let x = x0;
    for (const p of row) {
      at.push({ ...p, x, y });
      x += p.block.w + 2 * PAD + o.across;
    }
    y += Math.max(...row.map((p) => p.block.h)) + 2 * PAD + o.down;
  }
  return at;
}

// How far placed blocks reach, outlines included: { W, H }.
const extent = (at) => ({
  W: Math.max(...at.map((p) => p.x + p.block.w + 2 * PAD)),
  H: Math.max(...at.map((p) => p.y + p.block.h + 2 * PAD)),
});

// How large a board shows on a screen of the aim's shape: the height of the
// smallest such screen it fits, so the lower, the larger it shows.
const fitted = ({ W, H }) => Math.max(W / ASPECT, H);
const inShape = ({ W, H }) => Math.abs(Math.log(W / H / ASPECT)) <= Math.log(STRIP);

// B · Blocks: every section at a width it may take, the combination whose rows
// pack nearest the aim.
function blocks(sections, blockOf, o) {
  const lone = sections.length === 1;
  const choices = sections.map((s) => columnChoices(s.cards.length, lone, o));
  const evaluate = (ks) => packRows(ks.map((k, si) => blockOf(si, k)), o);

  let best = null;
  const consider = (ks) => {
    const pack = evaluate(ks);
    if (!best || pack.score < best.pack.score - 1e-9) best = { ks: [...ks], pack };
  };
  const combos = choices.reduce((p, c) => p * c.length, 1);
  if (combos <= EXHAUSTIVE) {
    const ks = choices.map((c) => c[0]);
    const walk = (si) => {
      if (si === sections.length) return consider(ks);
      for (const k of choices[si]) {
        ks[si] = k;
        walk(si + 1);
      }
    };
    walk(0);
  } else {
    consider(choices.map((c) => c[0]));
    for (let pass = 0; pass < 3; pass++) {
      const from = best.pack.score;
      for (let si = 0; si < sections.length; si++) {
        for (const k of choices[si]) {
          if (k === best.ks[si]) continue;
          const ks = [...best.ks];
          ks[si] = k;
          consider(ks);
        }
      }
      if (best.pack.score >= from - 1e-9) break;
    }
  }
  const at = inRows(best.pack.rows.map((row) => row.map((si) => ({ si, block: blockOf(si, best.ks[si]) }))), o);
  return { name: 'blocks', at, ...extent(at) };
}

// A · Columns: the sections side by side in one row, each as many columns wide
// (up to columnsWide) as keeps it under a height, at the height at which the
// board shows largest.
function columns(sections, blockOf, o) {
  let best = null;
  const seen = new Set();
  for (let tall = COLUMN_SCAN.from; tall <= COLUMN_SCAN.to; tall += COLUMN_SCAN.step) {
    const ks = sections.map((_, si) => {
      let k = 1;
      while (k < o.columnsWide && blockOf(si, k).h > tall) k++;
      return k;
    });
    const key = ks.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const at = inRows([ks.map((k, si) => ({ si, block: blockOf(si, k) }))], o);
    const size = extent(at);
    const score = fitted(size);
    if (!best || score < best.score - 1e-9) best = { at, ...size, score };
  }
  return { name: 'columns', at: best.at, W: best.W, H: best.H };
}

// Blocks in `count` columns from (x0, 0), outline to outline: each under the
// shortest column (the leftmost of equals), `down` under the block above it,
// the columns as far apart as the widest block needs. A block is never set
// higher than the one before it, so the blocks read back, top then left, in
// the order they were set out. Takes and returns them as inRows does.
function inColumns(items, count, o, x0 = 0) {
  const step = Math.max(...items.map((p) => p.block.w)) + 2 * PAD + o.across;
  const bottoms = new Array(Math.max(1, Math.min(count, items.length))).fill(0);
  return items.map((p) => {
    let j = 0;
    for (let m = 1; m < bottoms.length; m++) if (bottoms[m] < bottoms[j]) j = m;
    const y = bottoms[j];
    bottoms[j] += p.block.h + 2 * PAD + o.down;
    return { ...p, x: x0 + j * step, y };
  });
}

// C · Pictures lead: the picture sections in leadColumns columns, each under
// the shorter (inColumns: sections of different heights leave no hole beside
// the short one), all two or three columns wide, their rows aiming at
// leadRowHeight; the other sections stacked in a column beside them, one to
// three columns wide; whichever widths show the board largest. null without
// both kinds.
function picturesLead(sections, blockOf, o) {
  const pictures = sections.map((_, si) => si).filter((si) => sections[si].pictures);
  const words = sections.map((_, si) => si).filter((si) => !sections[si].pictures);
  if (!pictures.length || !words.length) return null;
  let best = null;
  for (const k of LEAD_COLUMNS) {
    const left = inColumns(pictures.map((si) => ({ si, block: blockOf(si, k, o.leadRowHeight) })), o.leadColumns, o);
    const from = extent(left).W + o.across;
    for (let n = 1; n <= o.besideWide; n++) {
      const at = [...left, ...inRows(words.map((si) => [{ si, block: blockOf(si, n) }]), o, from)];
      const size = extent(at);
      const score = fitted(size);
      if (!best || score < best.score - 1e-9) best = { at, ...size, score };
    }
  }
  return { name: 'pictures', at: best.at, W: best.W, H: best.H };
}

// The sections of a batch, in the order their first cards come: each with the
// indices of its cards, the cards, and whether it is pictures alone.
function sectionsOf(list) {
  const parts = new Map();
  list.forEach((c, i) => {
    const key = sectionOf(c);
    if (!parts.has(key)) parts.set(key, []);
    parts.get(key).push(i);
  });
  return [...parts.values()].map((idx) => {
    const cards = idx.map((i) => list[i]);
    return { idx, cards, pictures: allPictures(cards) };
  });
}

// Whether the pictures lead: at least leadShare of the cards are pictures,
// and some sections are pictures alone while others hold words.
function picturesLeadIn(sections) {
  const all = sections.flatMap((s) => s.cards);
  const pictures = all.filter(isPicture).length;
  return pictures >= AUTO.leadShare * all.length
    && sections.some((s) => s.pictures) && sections.some((s) => !s.pictures);
}

/**
 * Whether `auto` lets a board's pictures lead (its notes then stay as they
 * are; lib/boardStyle.js). The cards, each with its groupId and kind.
 */
export function leadsWithPictures(cards) {
  return picturesLeadIn(sectionsOf((cards || []).filter(Boolean)));
}

// Which arrangement, by what the board holds (the header): pictures leading
// when they do, else columns when they show the board about as large as blocks
// would, else blocks; never a strip. `forced` names one (tests); one that
// can't be made is blocks.
//
// Pictures leading is decided by the cards alone, not against blocks: it
// reads the sections in another order (a picture section, the one beside it,
// then the words), and blocks set out in that order may come out differently,
// so a comparison could undo itself on the next tidy. Columns and blocks both
// read back in the order they were laid out in.
function arrangementOf(sections, o, forced = null) {
  const blockOf = blockCache(sections, o);
  const c = (forced ? forced === 'pictures' : picturesLeadIn(sections)) ? picturesLead(sections, blockOf, o) : null;
  if (c && (forced || inShape(c))) return c;
  const a = (forced ? forced === 'columns' : sections.length > 1) ? columns(sections, blockOf, o) : null;
  if (a && forced) return a;
  const b = blocks(sections, blockOf, o);
  if (a && inShape(a) && fitted(a) <= fitted(b) * ROOM) return a;
  return b;
}

/**
 * `auto`, relative to (0, 0), and which arrangement it took:
 * { arrangement, cards }. The cards' top-left is there, as layoutEngine's
 * layouts leave theirs, and the group names above it. Takes the cards in the
 * order given and returns them in that order, each with its x, y, w and h:
 * pictures are sized to their row or column (their `aspect`, when given, is
 * their true shape), a palette to its section's width; everything else keeps
 * its size. `opts.arrangement` names one of ARRANGEMENTS rather than letting
 * the board's cards choose.
 */
export function autoPlan(items, opts = {}) {
  const o = { ...AUTO, ...(Number.isFinite(opts.gap) ? { gap: Math.max(0, opts.gap) } : {}) };
  const list = (items || []).filter(Boolean).map((c) => (
    Number.isFinite(c.w) && c.w > 0 && Number.isFinite(c.h) && c.h > 0
      ? c : { ...c, w: DEFAULT_W, h: DEFAULT_H }));
  if (!list.length) return { arrangement: null, cards: [] };

  const sections = sectionsOf(list);
  const plan = arrangementOf(sections, o, ARRANGEMENTS.includes(opts.arrangement) ? opts.arrangement : null);
  const out = new Array(list.length);
  for (const { si, block, x, y } of plan.at) {
    block.at.forEach((p, n) => {
      out[sections[si].idx[n]] = { ...sections[si].cards[n], x: x + PAD + p.x, y: y + PAD + p.y, w: p.w, h: p.h };
    });
  }
  const minX = Math.min(...out.map((c) => c.x));
  const minY = Math.min(...out.map((c) => c.y));
  return { arrangement: plan.name, cards: out.map((c) => ({ ...c, x: c.x - minX, y: c.y - minY })) };
}

/** `auto`'s cards alone (autoPlan). */
export const autoLayout = (items, opts = {}) => autoPlan(items, opts).cards;

/**
 * `auto` on the board, as layoutEngine's `arrange` places a named layout: at
 * `origin` when given, else under everything on the board, and pushed clear of
 * what is there.
 */
export function arrangeAuto(existingCards, items, opts = {}) {
  const placed = autoLayout(items, opts);
  if (!placed.length) return [];
  const solid = withGeometry(existingCards);
  const at = opts.origin;
  let ox;
  let oy;
  if (Number.isFinite(at?.x) && Number.isFinite(at?.y)) {
    ox = at.x;
    oy = at.y;
  } else {
    const b = boundsOfCards(solid);
    ox = b ? b.x : MARGIN;
    // Room for the first row's names, a row of sections' distance below.
    oy = b ? b.bottom + AUTO.down + PAD : MARGIN;
  }
  const moved = placed.map((c) => ({ ...c, x: Math.round(c.x + ox), y: Math.round(c.y + oy) }));
  return pushClearOf(solid, moved, Number.isFinite(opts.gap) ? opts.gap : AUTO.gap);
}

/**
 * Lay out cards already on the board where they are, as layoutEngine's
 * `rearrange` does: from the top-left of the cards being moved, clear of the
 * rest. They are taken in `order`, then as they read: a board laid out this
 * way reads top then left in the order it was laid out in, so tidying it again
 * moves nothing; any other is read row by row (rowOrder).
 */
export function rearrangeAuto(allCards, cardIds, opts = {}) {
  const ids = new Set((cardIds || []).map(String));
  const all = withGeometry(allCards);
  const moving = all.filter((c) => ids.has(String(c.id)));
  if (!moving.length) return [];
  const staying = all.filter((c) => !ids.has(String(c.id)));
  const anchor = blockBounds(moving);
  const lay = (read) => arrangeAuto(staying, inOrder(read, opts.order), {
    ...opts,
    origin: { x: anchor.x, y: anchor.y },
  });
  const topThenLeft = readingOrder(moving);
  const rows = rowOrder(moving);
  const kept = lay(topThenLeft);
  if (rows.every((c, i) => c === topThenLeft[i]) || sameBoxes(kept, moving)) return kept;
  return lay(rows);
}
