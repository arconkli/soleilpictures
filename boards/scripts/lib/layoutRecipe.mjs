// Editorial composition for the board generator.
//
// A board is a stack of horizontal BANDS. A card flagged `sectionHeader` (or
// `span:'full'`) spans the full width and starts a fresh band; the cards after
// it flow into a span-aware masonry beneath it. Cards can be:
//   • standard  — one column wide (aspect-fit for images)
//   • feature   — TWO columns wide (a large focal image), via `feature:true`
//   • full      — the whole board width (grid mosaics, section headers)
// Feature images + varied heights + generous gaps give the board an editorial
// rhythm and focal hierarchy instead of a flat uniform grid.

const DEFAULTS = {
  columns: 4,
  colWidth: 344,
  gap: 32,
  originX: 96,
  originY: 96,
};

// Height of a card at width `w`.
function cardHeight(card, w) {
  if (card.kind === 'image') {
    const ar = (card.srcW && card.srcH) ? card.srcW / card.srcH : 1.5;
    // Clamp so a tall portrait doesn't tower and a wide pano isn't a sliver.
    return Math.round(Math.min(w * 1.35, Math.max(w * 0.6, w / ar)));
  }
  if (card.kind === 'video') {
    const ar = (card.srcW && card.srcH) ? card.srcW / card.srcH : 16 / 9;
    return Math.round(Math.min(w * 1.1, Math.max(w * 0.5, w / ar)));
  }
  if (card.h) return card.h;
  switch (card.kind) {
    case 'palette': return 160;
    case 'note': {
      const text = ((card.body || '') + (card.html || '')).replace(/<[^>]+>/g, '');
      return text.length > 260 ? 244 : text.length > 120 ? 188 : 140;
    }
    case 'doc': return Array.isArray(card.lines) ? Math.min(560, 96 + 26 * card.lines.length) : 250;
    case 'link': return 184;
    case 'schedule': return 46 + 28 * (Array.isArray(card.rows) ? card.rows.length : 3);
    case 'shape': return card.shape === 'line' || card.shape === 'arrow' ? 120 : 220;
    case 'file': return 150;
    case 'board': return 240;
    default: return 176;
  }
}

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

  // Place a 1-column card in the shortest column.
  const place1 = (h) => {
    const col = shortestCol();
    const x = originX + col * colStep;
    const y = originY + colHeights[col];
    colHeights[col] += h + gap;
    return { x, y, w: colWidth };
  };
  // Place a 2-column card in the adjacent column pair with the lowest top.
  const place2 = (h) => {
    let best = 0, bestY = Infinity;
    for (let i = 0; i < columns - 1; i++) {
      const yy = Math.max(colHeights[i], colHeights[i + 1]);
      if (yy < bestY) { bestY = yy; best = i; }
    }
    const w = 2 * colWidth + gap;
    const x = originX + best * colStep;
    const y = originY + bestY;
    colHeights[best] = colHeights[best + 1] = bestY + h + gap;
    return { x, y, w };
  };

  const out = [];
  for (const card of cards) {
    // Full-width band: section header / hero banner / grid mosaic.
    if (card.sectionHeader || card.span === 'full') {
      const baseY = originY + maxH();
      let h;
      if (card.kind === 'grid') {
        const cols = card.cols || 3, rows = card.rows || 2;
        h = card.h || Math.round(rows * (boardW / cols) / 1.55);
      } else {
        h = card.h || (card.sub ? 108 : 72);
      }
      out.push({ ...card, x: originX, y: baseY, w: boardW, h });
      const bottom = maxH() + h + gap;
      for (let i = 0; i < columns; i++) colHeights[i] = bottom;
      continue;
    }

    // Manual placement wins.
    if (card.x != null && card.y != null) {
      out.push({ ...card, w: card.w || colWidth, h: card.h || cardHeight(card, card.w || colWidth) });
      continue;
    }

    const feature = card.feature || card.span === 2;
    if (feature) {
      const w = 2 * colWidth + gap;
      // Feature images stay landscape (0.5–0.8 ratio); a portrait fills via cover.
      const ar = (card.srcW && card.srcH) ? card.srcW / card.srcH : 1.5;
      const h = card.kind === 'image'
        ? Math.round(Math.min(w * 0.8, Math.max(w * 0.5, w / ar)))
        : cardHeight(card, w);
      const p = place2(h);
      out.push({ ...card, x: p.x, y: p.y, w, h });
    } else {
      const h = cardHeight(card, colWidth);
      const p = place1(h);
      out.push({ ...card, x: p.x, y: p.y, w: colWidth, h });
    }
  }
  return out;
}
