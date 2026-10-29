// The search pages' sun stage: which page gets which picture, and where each
// of a board's cut-out cards sits around the Clusters mark. Rendered by
// components/public/SunStage.jsx; the cut-outs are public/landing/v2/<slug>/
// <role>.webp, made by scripts/shootStageCards.mjs (sizes in
// landingStageCards.js). Pure, so node tests pin it.
//
// Two treatments (owner, 2026-10-29: "not TOO major on the ones that convert
// well; take the tips from them for the weaker ones"):
//
//   'behind' — the pages whose first-time visitors sign up most often. Their
//              hero is left exactly as it was: same words, same buttons, same
//              browser frame around the same shot of a real board, loaded
//              first. Only behind it: the suns rise past the frame's edge and
//              three of the board's own cards spill over it, lazily loaded.
//   'full'   — every other page. The browser frame becomes the stage itself:
//              the mark holding the board's cards. On the ranked lists this is
//              new up top, because the one thing the best pages do that the
//              weak ones don't is show a real board right under the button.
//
// Which pages are which was read from first-visit sign-ups over the 90 days to
// 2026-10-29 (the numbers live in the task's notes, never in this public repo).
// Re-read before moving a page between the lists.

import { STAGE_CARDS } from './landingStageCards.js';

export const STAGE_DIR = '/landing/v2';

export const KEPT_CLOSE = [
  '/vs/pureref',
  '/tools/reference-board-maker',
  '/tools/shot-list-maker',
  '/tools/mood-board-maker',
];

// Pages that keep today's look until a date. /best/pureref-alternatives is
// pre-registered "no other copy changes" while its title test reads
// (seoListicles.js); it gets the stage after that.
export const STAGE_HELD = {
  '/best/pureref-alternatives': '2026-11-19',
};

// The pages that get a stage at all: the tool, comparison and ranked-list
// pages and /use-cases. Not /scout (its own product page), not the template
// storefront, not the homepage.
const STAGE_PREFIXES = ['/tools/', '/vs/', '/best/'];

// 'behind' | 'full' | null (no stage: the page renders as it always has).
export function stageMode(path) {
  if (!path || STAGE_HELD[path]) return null;
  if (KEPT_CLOSE.includes(path)) return 'behind';
  return path === '/use-cases' || STAGE_PREFIXES.some((p) => path.startsWith(p)) ? 'full' : null;
}

// Layouts. A card is [role, desk, phone, depth, over]: desk/phone are
// [x, y, w, rotateDeg] with x/y the card's centre in % of the box and w its
// width in % of the box's width (null phone = not shown on phones). depth
// scales the pointer drift; `over` lifts a card above the suns.
//
// FULL — the box is the stage itself (desktop 1120×600, phone 358×300; the
// two aspect ratios are in components/public/sunStage.css); the mark sits as
// [left %, top %, width %], its empty top edge allowed above the box so the
// board sits close under the button. Pictures sit under the suns, the palette
// over them, the rest drift outside the ring so the band reads as a board,
// not a logo.
export const FULL_LAYOUT = {
  box: { desk: [1120, 600], phone: [358, 300] },
  mark: { desk: [21.43, -3.33, 57.14], phone: [1.68, -9.33, 95] },
  cards: [
    ['p1',   [12.2, 23.7, 13.1, -7], null,                  1.6, false],
    ['note', [9.7, 71.1, 16.7, 4],   null,                  1.2, false],
    ['c1',   [48.2, 36.8, 15.6, -4], [46.2, 33.9, 27.8, -4], 0.8, false],
    ['c2',   [61.0, 33.2, 13.1, 5],  [68.4, 28.9, 23.2, 5],  0.9, false],
    ['pal',  [53.2, 64.4, 25.1, -2], [53.6, 64.3, 48.2, -2], 1.1, true],
    ['l1',   [91.5, 25.8, 20.1, 5],  null,                  1.6, false],
    ['l2',   [90.5, 70.7, 21.2, -4], null,                  1.3, false],
  ],
};

// BEHIND — the box is today's browser frame. The mark sits right of the
// frame's middle so its suns clear the frame's right edge and its ring's top
// peeks over; the frame hides the rest. Sized so nothing reaches past the
// frame's own bottom margin into the words below. [left %, centre-y offset
// in % of the frame's WIDTH, width % of the frame's width]. On phones the one
// card sits at the top-right corner, clear of the address.
export const BEHIND_LAYOUT = {
  mark: { desk: [20, -6, 92], phone: [-3.4, 2.5, 118.75] },
  cards: [
    ['p1',  [-1.8, 47, 14.3, -6], null,              1.4, false],
    ['l1',  [101.5, 15, 20.8, 5], [90, -6, 26, 6],   1.3, false],
    ['pal', [95, 94, 25.2, -3],   null,              1.1, false],
  ],
};

// The cut-outs a board has for a layout, in paint order, each with its file
// and pixel size. A board missing a role just skips that card.
export function stageCards(slug, layout) {
  const have = STAGE_CARDS[slug];
  if (!have) return [];
  return layout.cards
    .filter(([role]) => have[role])
    .map(([role, desk, phone, depth, over]) => ({
      role, desk, phone, depth, over,
      src: `${STAGE_DIR}/${slug}/${role}.webp`,
      w: have[role].w, h: have[role].h,
    }));
}

export function hasStage(slug) {
  return !!STAGE_CARDS[slug];
}

// The board a page's link preview draws in the new look, or null for the plain
// card. scripts/generate-og.mjs draws from it and worker.js's injectLanding
// versions the og:image URL from it, so scrapers' caches let go exactly when
// the picture changes. The page's lead board: the one its hero shows.
export function ogStageSlug(spec) {
  const slug = spec?.exampleSlugs?.[0];
  return spec && !spec.storefront && stageMode(spec.path) && hasStage(slug) ? slug : null;
}

// The link-preview stage: the mark at OG_STAGE.mark = [left px, top px, size
// px] on the 1200×630 card, and the cards in the mark's own 2048-unit box,
// [role, centre x, centre y, rotateDeg], all lifted over the suns so the
// photos read at a chat bubble's size. A card's width is its own width on the
// page times OG_STAGE.k, capped at maxW (a wide landscape would crowd the
// ring otherwise).
export const OG_STAGE = {
  mark: [610, 16, 600],
  k: 3.1,
  cards: [
    ['l1',  1730, 1110, 7,  430],
    ['c1',  960,  860,  -5, 600],
    ['c2',  1420, 760,  5,  520],
    ['pal', 1150, 1450, -2, 900],
  ],
};
