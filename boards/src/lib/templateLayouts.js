// The layouts behind the templates we sell at /templates — the real ones.
//
// ── why this is not PRESETS ──────────────────────────────────────────────────
//
// gridLayout.js's PRESETS are ten pieces of BARE GEOMETRY ("2 × 2", "3 across").
// They are the panel's Shapes section: a starting rectangle to cut up yourself.
// Every template used to borrow one, which is why fifteen templates rendered as
// seven pictures and why the "storyboard template" was a 1-over-2 — a shape no
// storyboard has ever been.
//
// These are different in kind. Each one replicates a layout that exists on
// paper, with the proportions that make it that layout rather than a generic
// division of a box:
//
//   storyboard-6up      6 panels per page, 16:9, a caption ruled under each —
//                       the film-industry sheet (3–6 panels/page, 6 standard).
//   storyboard-vertical 9:16 panels, because a social cut is not a scene.
//   contact-sheet-36    a 35mm roll: six strips of six, frames at 3:2.
//   social-grid-3x4     3:4, which is what an Instagram profile grid crops to
//                       since 2025 — planning one as squares is planning the
//                       wrong picture.
//   call-sheet          header · location/weather/hospital · schedule · cast ·
//                       crew. The hospital box is a safety requirement, not a
//                       nicety, so it is on the sheet rather than in a note.
//
// ── fracs are written as MEASUREMENTS, then NORMALIZED ───────────────────────
//
// computeCellRects normalizes every split's children by their sum, so a frac is
// a RATIO. That lets a 16:9 panel over its caption be written
// `col(3, [leaf('p1', 118), leaf('c1', 40)])` — the actual height of each band in
// the actual card. The arithmetic that makes a panel 16:9 stays legible instead
// of decaying into 0.7468.
//
// But those raw numbers may not LEAVE this file. sanitizeLayout — which every
// tree crossing into the app goes through, including these — clamps each frac
// with `Math.min(1, raw)` to bound untrusted data. A frac of 118 becomes 1, a
// frac of 40 becomes 1, and the split comes out EVEN: the preview drew a
// storyboard and the card placed six equal boxes. So every tree is normalized
// here at module load, and a test asserts that sanitizing a layout cannot change
// the grid it produces.
//
// ── labels are keyed by LEAF ID, never by index ──────────────────────────────
//
// A template's cell hints are STORED by reading-order index (see
// gridLayoutLibrary's hint section). Reading order bands cells by their centre,
// so on a panel-and-caption sheet it runs panel, panel, caption, caption, panel…
// — interleaved, and nobody can type that by hand correctly twice. So labels are
// authored against the leaf ids below and the index array is DERIVED here, once,
// by asking readingOrder. Get the label wrong and it is a typo; you can no
// longer get the ORDER wrong at all.

import { PRESETS, computeCellRects, readingOrder, normalizeTree } from './gridLayout.js';

// The card a template is born at. A layout is a set of proportions, and
// proportions only produce 16:9 panels at one aspect ratio — place a storyboard
// in the default 360×300 and its panels come out square. addGrid already takes
// w/h; these are what it gets.
export const DEFAULT_TEMPLATE_SIZE = Object.freeze({ w: 360, h: 300 });

const leaf = (id, frac) => ({ type: 'leaf', id, frac });
const row = (frac, children) => ({ type: 'row', frac, children });
const col = (frac, children) => ({ type: 'col', frac, children });

// The unit a storyboard page is made of: an image panel with a ruled caption
// band under it. `pw`/`ph` are the panel's real size, `cap` the caption's height,
// so the 16:9 is visible in the call rather than hidden in a decimal.
const panel = (frac, panelId, capId, ph, cap) => col(frac, [leaf(panelId, ph), leaf(capId, cap)]);

// Repeat a cell n times across a row — swatch strips, contact-sheet rows.
const across = (frac, ids) => row(frac, ids.map((id) => leaf(id, 1)));

// ── the catalogue ────────────────────────────────────────────────────────────

const LAYOUTS = [
  // 6 panels per page is the film standard; each is 16:9 with a band beneath for
  // action and dialogue. At 420 wide a panel is 202 across → 114 tall, and the
  // caption is the 40 that makes the row.
  {
    id: 'storyboard-6up',
    label: 'Storyboard · 6 panels, 16:9',
    size: { w: 420, h: 474 },
    tree: col(1, [0, 1, 2].map((r) => row(158, [
      panel(202, `p${r * 2 + 1}`, `c${r * 2 + 1}`, 118, 40),
      panel(202, `p${r * 2 + 2}`, `c${r * 2 + 2}`, 118, 40),
    ]))),
    labels: {
      p1: 'SHOT 1', p2: 'SHOT 2', p3: 'SHOT 3', p4: 'SHOT 4', p5: 'SHOT 5', p6: 'SHOT 6',
      c1: 'ACTION', c2: 'ACTION', c3: 'ACTION', c4: 'ACTION', c5: 'ACTION', c6: 'ACTION',
    },
  },

  // A short social cut boarded in the shape it will be watched in. 9:16 panels,
  // four beats left to right, a line under each for what is said or on screen.
  {
    id: 'storyboard-vertical-4',
    label: 'Storyboard · 4 vertical beats, 9:16',
    size: { w: 540, h: 274 },
    tree: row(1, [
      panel(130, 'p1', 'c1', 240, 34),
      panel(130, 'p2', 'c2', 240, 34),
      panel(130, 'p3', 'c3', 240, 34),
      panel(130, 'p4', 'c4', 240, 34),
    ]),
    labels: {
      p1: 'HOOK', p2: 'BEAT 2', p3: 'BEAT 3', p4: 'END CARD',
      c1: 'VO / TEXT', c2: 'VO / TEXT', c3: 'VO / TEXT', c4: 'VO / TEXT',
    },
  },

  // One row per setup, in the columns a crew actually reads: the reference frame
  // first at 16:9, then size, angle, movement and notes. The labels are single
  // words because a table column head IS a single word — and because a narrow
  // column cannot render "MOVEMENT + LENS" at any size a preview is drawn at,
  // so a longer label would only ever be seen ellipsised.
  {
    id: 'shot-list-rows',
    label: 'Shot list · 4 setups, frame and columns',
    size: { w: 720, h: 430 },
    tree: col(1, [1, 2, 3, 4].map((n) => row(107, [
      leaf(`f${n}`, 190),
      leaf(`s${n}`, 132),
      leaf(`a${n}`, 132),
      leaf(`m${n}`, 133),
      leaf(`x${n}`, 133),
    ]))),
    labels: {
      f1: 'FRAME', s1: 'SIZE', a1: 'ANGLE', m1: 'MOVE', x1: 'NOTES',
      f2: 'FRAME', s2: 'SIZE', a2: 'ANGLE', m2: 'MOVE', x2: 'NOTES',
      f3: 'FRAME', s3: 'SIZE', a3: 'ANGLE', m3: 'MOVE', x3: 'NOTES',
      f4: 'FRAME', s4: 'SIZE', a4: 'ANGLE', m4: 'MOVE', x4: 'NOTES',
    },
  },

  // A roll of 35mm: six strips of six frames, each frame 3:2 because that is the
  // shape of the negative. 540 × 360 makes every frame exactly 90 × 60. Unlabelled
  // on purpose — a contact sheet is the one sheet with nothing written on it.
  {
    id: 'contact-sheet-36',
    label: 'Contact sheet · 36 frames, 3:2',
    size: { w: 540, h: 360 },
    tree: col(1, [0, 1, 2, 3, 4, 5].map((r) => (
      across(1, [0, 1, 2, 3, 4, 5].map((c) => `f${r}${c}`))
    ))),
    labels: {},
  },

  // Headshots are 4:5, and a headshot nobody can name is not a casting board —
  // so every frame carries a strip for the name and the agent. A row per tier,
  // which is the comparison a director is actually making.
  {
    id: 'casting-3x3',
    label: 'Casting board · 9 headshots, 4:5 with names',
    size: { w: 400, h: 595 },
    tree: col(1, [0, 1, 2].map((r) => row(198, [0, 1, 2].map((c) => (
      // 32, not 24: the name strip has to clear GRID_TUNING.MIN_CELL_PX or the
      // cell it names renders below the floor the engine is willing to draw.
      panel(133, `h${r}${c}`, `n${r}${c}`, 166, 32)
    ))))),
    labels: {
      h00: 'LEAD', h01: 'LEAD', h02: 'LEAD',
      h10: 'SUPPORTING', h11: 'SUPPORTING', h12: 'SUPPORTING',
      h20: 'BACKGROUND', h21: 'BACKGROUND', h22: 'BACKGROUND',
      n00: 'NAME · AGENT', n01: 'NAME · AGENT', n02: 'NAME · AGENT',
      n10: 'NAME · AGENT', n11: 'NAME · AGENT', n12: 'NAME · AGENT',
      n20: 'NAME · AGENT', n21: 'NAME · AGENT', n22: 'NAME · AGENT',
    },
  },

  // The sheet the whole unit reads at 6am, in its real order. Portrait, because a
  // call sheet is a page. The hospital box sits in the top band with location and
  // weather because it is a safety requirement on every sheet regardless of what
  // is being shot — burying it under the crew list is how it goes missing.
  {
    id: 'call-sheet',
    label: 'Call sheet · header, schedule, cast and crew',
    size: { w: 420, h: 560 },
    tree: col(1, [
      leaf('head', 62),
      row(74, [leaf('loc', 160), leaf('weather', 125), leaf('hospital', 135)]),
      leaf('schedule', 180),
      row(244, [leaf('cast', 200), leaf('crew', 220)]),
    ]),
    labels: {
      head: 'PRODUCTION · DAY · CALL',
      loc: 'LOCATION + PARKING',
      weather: 'WEATHER · SUNSET',
      hospital: 'NEAREST HOSPITAL',
      schedule: 'SCHEDULE — SCENE, CAST, D/N, PAGES',
      cast: 'CAST + CALL TIMES',
      crew: 'CREW BY DEPARTMENT',
    },
  },

  // Leads with one image, backs it with three, and ends on the palette — which is
  // the part a mood board gets asked for and the part a plain grid has nowhere to
  // put. Only the first swatch is labelled; five cells all reading PALETTE is
  // noise, and an unlabelled swatch already looks like a swatch.
  {
    id: 'mood-board-palette',
    label: 'Mood board · hero, three refs, palette strip',
    size: { w: 480, h: 430 },
    tree: col(1, [
      row(320, [
        leaf('hero', 278),
        col(202, [leaf('texture', 1), leaf('detail', 1), leaf('type', 1)]),
      ]),
      // FOUR swatches, not five. At five the strip is narrow enough that the one
      // labelled swatch renders as "PALET…" — a label too clipped to read is
      // worse than the wider swatch it was bought with.
      across(90, ['s1', 's2', 's3', 's4']),
    ]),
    labels: {
      hero: 'HERO IMAGE', texture: 'TEXTURE', detail: 'DETAIL', type: 'TYPE',
      s1: 'PALETTE',
    },
  },

  // A spread, not a grid: the cover look holds the left page at full height and
  // the rest of the page steps down from it. Even weighting is what made the old
  // four-square version read as a contact sheet with fashion in it.
  {
    id: 'look-book-spread',
    label: 'Look book · cover look and three',
    // 265 × 400 puts the cover at 2:3 — a fashion plate, not a thumbnail.
    size: { w: 530, h: 400 },
    tree: row(1, [
      leaf('cover', 265),
      col(265, [
        leaf('look2', 210),
        row(190, [leaf('look3', 1), leaf('detail', 1)]),
      ]),
    ]),
    labels: {
      cover: 'COVER LOOK', look2: 'LOOK 02', look3: 'LOOK 03', detail: 'DETAIL',
    },
  },

  // The listing set. The main shot is SQUARE because that is the crop every
  // marketplace thumbnails to, and it is the one image a buyer decides on — a
  // full-width band would have been 1.9:1 and cropped to nothing. Back and side
  // stack beside it; detail, scale and in-use run underneath. Scale earns a box
  // of its own: "how big is it" is the question a returns policy pays for.
  {
    id: 'product-hero-angles',
    label: 'Product · square hero and five angles',
    size: { w: 480, h: 440 },
    tree: col(1, [
      row(300, [
        leaf('main', 300),
        col(180, [leaf('back', 1), leaf('side', 1)]),
      ]),
      across(140, ['detail', 'scale', 'inuse']),
    ]),
    labels: {
      main: 'MAIN SHOT', back: 'BACK', side: 'SIDE',
      detail: 'DETAIL', scale: 'SCALE', inuse: 'IN USE',
    },
  },

  // Nine posts at 3:4, which is what a profile grid crops every thumbnail to.
  // Planned as squares you are planning a picture the grid will never show.
  {
    id: 'social-grid-3x4',
    label: 'Posting grid · 9 posts, 3:4',
    size: { w: 360, h: 480 },
    tree: col(1, [0, 1, 2].map((r) => (
      across(1, [0, 1, 2].map((c) => `p${r * 3 + c + 1}`))
    ))),
    labels: {
      p1: 'POST 1', p2: 'POST 2', p3: 'POST 3',
      p4: 'POST 4', p5: 'POST 5', p6: 'POST 6',
      p7: 'POST 7', p8: 'POST 8', p9: 'POST 9',
    },
  },

  // A recce reads one location per row, and the wide carries the row because it
  // is the frame that says whether the space works at all. The detail and the
  // light are the two that say whether it works on the day.
  {
    id: 'location-recce',
    label: 'Location recce · 3 locations, wide plus two',
    size: { w: 480, h: 420 },
    tree: col(1, [
      row(140, [leaf('aw', 240), leaf('ad', 120), leaf('al', 120)]),
      row(140, [leaf('bw', 240), leaf('bd', 120), leaf('bl', 120)]),
      row(140, [leaf('cw', 240), leaf('cd', 120), leaf('cl', 120)]),
    ]),
    labels: {
      aw: 'LOCATION A — WIDE', ad: 'A — DETAIL', al: 'A — LIGHT',
      bw: 'LOCATION B — WIDE', bd: 'B — DETAIL', bl: 'B — LIGHT',
      cw: 'LOCATION C — WIDE', cd: 'C — DETAIL', cl: 'C — LIGHT',
    },
  },

  // Logo and type on top because they are the two that get misused, the palette
  // as actual swatches rather than a paragraph naming hex codes, and the imagery
  // across the bottom where it can be compared as a set.
  {
    id: 'brand-board',
    label: 'Brand board · logo, type, palette, imagery',
    size: { w: 480, h: 430 },
    tree: col(1, [
      row(150, [leaf('logo', 1), leaf('type', 1)]),
      across(70, ['s1', 's2', 's3', 's4']),
      across(180, ['img1', 'img2', 'img3']),
    ]),
    labels: {
      logo: 'LOGO', type: 'TYPEFACE', s1: 'PALETTE',
      img1: 'IMAGERY', img2: 'IMAGERY', img3: 'IMAGERY',
    },
  },

  // The photo is what someone decides on, so it takes the left column with the
  // notes under it; ingredients and method stack down the right in the order you
  // use them — read once standing up, then followed.
  {
    id: 'recipe-card',
    label: 'Recipe card · dish, ingredients, method',
    size: { w: 480, h: 360 },
    tree: row(1, [
      col(215, [leaf('dish', 225), leaf('notes', 135)]),
      col(265, [leaf('ingredients', 140), leaf('method', 220)]),
    ]),
    labels: {
      dish: 'THE DISH', notes: 'NOTES',
      ingredients: 'INGREDIENTS', method: 'METHOD',
    },
  },
];

// ── derivation ───────────────────────────────────────────────────────────────

// Cell ids in reading order, computed at the layout's OWN aspect ratio. Aspect
// matters: readingOrder bands by y-centre, and a band is only a band at the
// proportions the layout is meant to be placed at.
export function templateCellOrder(layout) {
  const size = layout?.size || DEFAULT_TEMPLATE_SIZE;
  return readingOrder(computeCellRects(layout.tree, { x: 0, y: 0, w: size.w, h: size.h }));
}

// { leafId: label } → the reading-order array hints are stored as. Cells with no
// label become '' — a hole, not a shift. sanitizeHints keeps them and
// hintsToCellMap skips them, which is how the contact sheet's 36 unlabelled
// frames and the palette strip's four blank swatches both work.
function hintsFor(layout) {
  const labels = layout.labels || {};
  const out = templateCellOrder(layout).map((id) => labels[id] || '');
  return out.some(Boolean) ? out : null;
}

export const TEMPLATE_LAYOUTS = Object.freeze(LAYOUTS.map((l) => {
  // Measurements in, ratios out. normalizeTree divides each split's children by
  // their sum, which is the same arithmetic computeCellRects does on the fly —
  // so the geometry is identical and the stored fracs are now inside the [0,1]
  // range sanitizeLayout will accept without flattening them.
  const tree = normalizeTree(l.tree);
  const norm = { ...l, tree };
  return Object.freeze({
    id: l.id,
    label: l.label,
    tree,
    size: Object.freeze(l.size),
    hints: Object.freeze(hintsFor(norm)),
  });
}));

// THE resolver. A template names one id; it may be a purpose-built layout above
// or one of the ten bare shapes, and every caller — the item page, the store, the
// in-app panel, the Worker's crawlable HTML, gen-docs — has to agree on which.
// Purpose-built wins on a collision, but the test suite forbids one existing.
export function layoutById(id) {
  if (!id) return null;
  return TEMPLATE_LAYOUTS.find((l) => l.id === id)
    || PRESETS.find((p) => p.id === id)
    || null;
}

// The card size a layout wants. Bare presets have no opinion and take the
// default, which is exactly what addGrid used before any of this existed.
export function layoutSize(layout) {
  return layout?.size || DEFAULT_TEMPLATE_SIZE;
}
