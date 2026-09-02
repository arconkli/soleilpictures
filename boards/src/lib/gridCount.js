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

// Number of filled cells in a { cellId: record } map.
export function cellsWeight(cells) {
  if (!cells || typeof cells !== 'object') return 0;
  let n = 0;
  for (const k in cells) {
    if (RUNDOWN_ROW_RE.test(k)) continue;
    if (isCellFilled(cells[k])) n++;
  }
  return n;
}

// Weight of one card toward the cap: a cell container (grid, or a new-model
// schedule whose items are grid cell records) weighs its filled cells (min 1 —
// the container itself is one placed card); everything else is 1. A LEGACY
// schedule card (rows table, no cells map) passes no cells → weighs 1.
export function cardWeight(kind, cells) {
  if (kind === 'grid' || kind === 'schedule') return Math.max(1, cellsWeight(cells));
  return 1;
}
