// More like this — which of the pictures similar_pictures (0596) hands back
// are close enough to show beside the one being looked at, and the card each
// one is. Pure, so it tests under node; MoreLikeThis.jsx does the fetching.
//
// The distance is cosine, between bge-m3 embeddings of embedTextForCard (a
// card's own words and its picture's description). Measured 2026-10-28 on
// fifty of the owner's own pictures, described by Gemma 4 and embedded the
// way production does: under ~0.30 the pairs are plainly alike (one sketch
// style, two portraits of one man, a set of graphics), up to ~0.36 still
// related (two close-up portraits, a dark alley and a dark track), and past
// ~0.38 loose or unrelated (a handgun and a pair of glasses, "silver"). Half
// the pictures had a neighbour under 0.335. So 0.36: a workspace with nothing
// close shows no strip, rather than a row of strangers.
export const SIMILAR_MAX_DIST = 0.36;
export const SIMILAR_LIMIT = 12;

// similar_pictures rows → [{ boardId, cardId, distance }], nearest first,
// only the close ones, each card once.
export function pickSimilar(rows, { max = SIMILAR_MAX_DIST, limit = SIMILAR_LIMIT } = {}) {
  const seen = new Set();
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    // Number(null) is 0, the closest there is: a missing distance is no match.
    const d = r?.distance == null ? NaN : Number(r.distance);
    if (!r?.board_id || !r?.card_id || !Number.isFinite(d) || d > max) continue;
    const k = `${r.board_id}:${r.card_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ boardId: r.board_id, cardId: r.card_id, distance: d });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, limit);
}

// A card_index row (board_id, card_id, title, meta) as the card the viewers
// and toListItem take; null when it holds no stored picture.
export function similarCardOf(row) {
  const src = row?.meta?.src;
  if (!row?.card_id || typeof src !== 'string' || !src.startsWith('r2:')) return null;
  const card = { id: String(row.card_id), kind: 'image', src, title: row.title || '' };
  if (row.meta.fileName) card.fileName = String(row.meta.fileName);
  return card;
}
