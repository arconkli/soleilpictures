// Masonry auto-layout for the board generator.
//
// A recipe lists cards without positions; this packs them into a tidy
// Pinterest-style masonry so a generated board looks designed rather than
// dumped. Image heights follow their real aspect ratio (from the source API);
// text/palette cards get sensible fixed heights. Cards that already carry an
// explicit x/y are respected (manual placement wins).

const DEFAULTS = {
  columns: 4,
  colWidth: 300,
  gap: 24,
  originX: 80,
  originY: 80,
};

// Target height for a 1-column-wide card of the given kind. Images ALWAYS fit
// to their source aspect ratio (srcW/srcH from the image API) — never the raw
// pixel height — so a 4000px-tall photo becomes a tidy ~200px card, not a tower.
function cardHeight(card, colWidth) {
  if (card.kind === 'image') {
    const arW = card.srcW || 3;
    const arH = card.srcH || 2;
    const ar = arW && arH ? arW / arH : 1.5;
    return Math.round(Math.min(440, Math.max(150, colWidth / ar)));
  }
  if (card.h) return card.h;
  switch (card.kind) {
    case 'palette': return 132;
    case 'note': {
      const text = (card.body || '') + (card.html || '');
      const len = text.replace(/<[^>]+>/g, '').length;
      return len > 220 ? 220 : len > 90 ? 176 : 132;
    }
    case 'doc': return 240;
    case 'link': return 176;
    case 'schedule': return 200;
    default: return 168;
  }
}

// Assign x/y/w/h to every card. Returns NEW card objects (recipe untouched).
// Wide cards (card.span === 'full' or 2) occupy multiple columns and are placed
// on a fresh row so the masonry stays clean.
export function layoutRecipe(cards, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { columns, colWidth, gap, originX, originY } = o;
  const colStep = colWidth + gap;
  const colHeights = new Array(columns).fill(0);

  const shortestCol = () => {
    let idx = 0;
    for (let i = 1; i < columns; i++) if (colHeights[i] < colHeights[idx]) idx = i;
    return idx;
  };

  const out = [];
  for (const card of cards) {
    // Respect manual placement.
    if (card.x != null && card.y != null) {
      out.push({ ...card, w: card.w || colWidth, h: card.h || cardHeight(card, colWidth) });
      continue;
    }

    const span = card.span === 'full' ? columns : Math.min(columns, Math.max(1, card.span || 1));
    const w = span === 1 ? colWidth : colWidth * span + gap * (span - 1);

    if (span === 1) {
      const col = shortestCol();
      const h = cardHeight(card, w);
      const x = originX + col * colStep;
      const y = originY + colHeights[col];
      colHeights[col] += h + gap;
      out.push({ ...card, x, y, w, h });
    } else {
      // Multi-column card: drop it on a fresh row across the spanned columns.
      const baseY = originY + Math.max(...colHeights);
      const h = card.h || Math.round(w / 3.2); // banner-ish default
      out.push({ ...card, x: originX, y: baseY, w, h });
      const rowBottom = baseY + h + gap - originY;
      for (let i = 0; i < span; i++) colHeights[i] = Math.max(colHeights[i], rowBottom);
    }
  }
  return out;
}
