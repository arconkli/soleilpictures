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

// Number of filled cells in a { cellId: record } map.
export function cellsWeight(cells) {
  if (!cells || typeof cells !== 'object') return 0;
  let n = 0;
  for (const k in cells) if (isCellFilled(cells[k])) n++;
  return n;
}

// Weight of one card toward the cap: a grid weighs its filled cells (min 1 — the
// container itself is one placed card); everything else is 1.
export function cardWeight(kind, cells) {
  if (kind === 'grid') return Math.max(1, cellsWeight(cells));
  return 1;
}
