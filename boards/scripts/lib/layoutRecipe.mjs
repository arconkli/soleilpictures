// Section-based composition for the board generator.
//
// A board is laid out as a stack of horizontal BANDS. A card flagged
// `sectionHeader` (or `span:'full'`) spans the full board width and starts a
// fresh band; the cards after it masonry into columns beneath it until the next
// header. This reads as a designed, sectioned reference board — "Host Nations",
// "Team Colors", "Iconic Stadiums" — rather than one flat wall of thumbnails.
//
// Image heights follow their source aspect ratio (srcW/srcH from the image
// API); text/palette/schedule cards get sensible fixed heights. Cards with an
// explicit x/y are respected (manual placement wins).

const DEFAULTS = {
  columns: 4,
  colWidth: 336,
  gap: 26,
  originX: 80,
  originY: 80,
};

// Target height for a 1-column-wide card of the given kind.
function cardHeight(card, colWidth) {
  if (card.kind === 'image') {
    const arW = card.srcW || 3;
    const arH = card.srcH || 2;
    const ar = arW && arH ? arW / arH : 1.5;
    return Math.round(Math.min(460, Math.max(150, colWidth / ar)));
  }
  if (card.h) return card.h;
  switch (card.kind) {
    case 'palette': return 148;
    case 'note': {
      const text = ((card.body || '') + (card.html || '')).replace(/<[^>]+>/g, '');
      return text.length > 240 ? 236 : text.length > 100 ? 184 : 136;
    }
    case 'doc': return 240;
    case 'link': return 176;
    case 'schedule': return 40 + 26 * (Array.isArray(card.rows) ? card.rows.length : 3);
    default: return 168;
  }
}

// Assign x/y/w/h to every card. Section headers span full width and reset the
// masonry baseline so each section starts as a clean band.
export function layoutRecipe(cards, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { columns, colWidth, gap, originX, originY } = o;
  const colStep = colWidth + gap;
  const boardW = columns * colWidth + (columns - 1) * gap;
  const colHeights = new Array(columns).fill(0);

  const shortestCol = () => {
    let idx = 0;
    for (let i = 1; i < columns; i++) if (colHeights[i] < colHeights[idx]) idx = i;
    return idx;
  };
  const maxH = () => Math.max(...colHeights);

  const out = [];
  for (const card of cards) {
    // Full-width band (section header / hero banner / grid mosaic): clear
    // everything above, place full width, then drop all columns below it.
    if (card.sectionHeader || card.span === 'full') {
      const baseY = originY + maxH();
      let h;
      if (card.kind === 'grid') {
        const cols = card.cols || 3, rows = card.rows || 2;
        h = card.h || Math.round(rows * (boardW / cols) / 1.6);
      } else {
        h = card.h || (card.sub ? 104 : 72);
      }
      out.push({ ...card, x: originX, y: baseY, w: boardW, h });
      const bottom = maxH() + h + gap;
      for (let i = 0; i < columns; i++) colHeights[i] = bottom;
      continue;
    }

    // Respect manual placement.
    if (card.x != null && card.y != null) {
      out.push({ ...card, w: card.w || colWidth, h: card.h || cardHeight(card, colWidth) });
      continue;
    }

    // Masonry: place in the shortest column.
    const col = shortestCol();
    const h = cardHeight(card, colWidth);
    const x = originX + col * colStep;
    const y = originY + colHeights[col];
    colHeights[col] += h + gap;
    out.push({ ...card, x, y, w: colWidth, h });
  }
  return out;
}
