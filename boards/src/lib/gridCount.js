// Weighted card count — grids count their FILLED cells toward the demo card cap
// (a grid with 25 images ≈ 25 cards, not 1). A cell is "filled" when it holds real
// content; empty cells and empty text cells add nothing. Pure + dependency-free so
// both the client count and the card_index sync can share it.

export function isCellFilled(cell) {
  if (!cell || typeof cell !== 'object') return false;
  switch (cell.type) {
    case 'image': return !!cell.src;
    case 'text': {
      const html = cell.html || '';
      // Strip tags + entities/whitespace — an untouched text cell has no weight.
      return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;
    }
    case 'link':  return !!(cell.source || cell.link);
    case 'video': return !!cell.src;
    case 'file':  return !!cell.fileSrc;
    case 'board': return !!cell.boardId;
    default:      return false; // 'empty' / unknown
  }
}

// A schedule card's day view is a RUNDOWN: an ordered list of items with
// durations, keyed `d:<date>/r:<uid>` (lib/rundown.js). Those rows are the
// interior of one card — the shape of a day — not fifteen separate cards, and
// "Set up this day" seeds three of them before anyone has typed anything. This
// loop is otherwise grammar-blind, so a fifteen-row shooting day was costing a
// free user fifteen of fifty cards while, until the same change widened
// isItemKey, rendering as an empty date on every other surface.
//
// Deliberately a suffix test rather than an import: this module is pure and
// dependency-free so the client count and the card_index sync can both use it,
// and a `/r:` segment cannot occur in a grid's cell ids.
const RUNDOWN_ROW_RE = /\/r:[^/]+$/;

// A text cell holding a sequence label — "SHOT [#]", "[##][A]" — is the slate
// every stamped copy of a grid carries (gridSequence.stampCarry: carry what
// describes HOW a grid is meant to be filled in, never what IS filled in). Nobody
// put it in that box, so it costs no card: a 5×5 storyboard stamped from a
// labelled panel would otherwise spend twenty-five of a free account's cards on
// twenty-five empty frames. It is still FILLED for everything else — a template
// re-cut that drops it reports it as dropped (gridLayout.js), because it is.
// Same tags as gridSequence.hasLabelTag, inline so this module stays
// dependency-free.
const LABEL_TAG_RE = /\[#{1,3}\]|\[A\]/;
// A slate is short: a label and a number. Text with a tag in it that runs past
// this is someone's writing, and costs a card like any other text.
const SLATE_MAX_CHARS = 40;
// Exported for gridSequence.stampCarry, which carries exactly these and nothing
// else — so a stamped copy is never charged for what stamping put in it.
export function isSlate(cell) {
  if (cell?.type !== 'text') return false;
  const html = String(cell.html || '');
  if (!LABEL_TAG_RE.test(html)) return false;
  const visible = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
  return visible.length <= SLATE_MAX_CHARS;
}

// Number of cells in a { cellId: record } map that cost a card: filled, and not
// a carried slate.
export function cellsWeight(cells) {
  if (!cells || typeof cells !== 'object') return 0;
  let n = 0;
  for (const k in cells) {
    if (RUNDOWN_ROW_RE.test(k)) continue;
    if (isCellFilled(cells[k]) && !isSlate(cells[k])) n++;
  }
  return n;
}

// Weight of one card toward the cap.
//
// A GRID weighs its filled cells and nothing else, so an empty grid weighs 0.
// It used to weigh at least 1 ("the container is one placed card"), which made
// Generate matrix — documented as building "an empty N×M grid" — spend one card
// per empty copy: a 5×5 storyboard cost half of a free account before a single
// frame was drawn, and walled people minutes after signup. The docs have always
// said an empty box adds nothing to your card count; this makes the grid agree.
//
// A SCHEDULE keeps its minimum of 1: a calendar is a placed card even before
// anything is on it. A LEGACY schedule (rows table, no cells map) passes no
// cells → weighs 1. Everything else is 1.
export function cardWeight(kind, cells) {
  if (kind === 'grid') return cellsWeight(cells);
  if (kind === 'schedule') return Math.max(1, cellsWeight(cells));
  return 1;
}
