// The shapes we actually ship marketing assets in.
//
// One list, three consumers: the Settings pills, the on-screen AspectMask, and
// the shot-list CLI. Keeping it here rather than in the component means a shot
// recorded to '9:16' and a still exported to '9:16' cannot drift apart.
//
// `ratio` is width ÷ height. `cardsAcross` seeds the reframe's target width —
// how many cards should read across the frame at a comfortable size. It comes
// from the same reasoning as NARROW_CARDS_ACROSS in CanvasSurface (2.4, derived
// from what actually opened well on a 390px phone), scaled by how much
// horizontal room the shape has: a square or a landscape frame can carry more
// across before each card gets too small to read.
//
// Zero imports — the CLI pulls this in under plain Node.

export const ASPECTS = Object.freeze([
  { id: null,    label: 'Off',       ratio: null,     cardsAcross: null },
  { id: '9:16',  label: '9:16',      ratio: 9 / 16,   cardsAcross: 2.4 },
  { id: '4:5',   label: '4:5',       ratio: 4 / 5,    cardsAcross: 3.0 },
  { id: '1:1',   label: '1:1',       ratio: 1,        cardsAcross: 3.4 },
  { id: '16:9',  label: '16:9',      ratio: 16 / 9,   cardsAcross: 5.0 },
]);

export function aspectSpec(id) {
  return ASPECTS.find(a => a.id === id) || ASPECTS[0];
}

/**
 * The largest centred rect of `ratio` that fits a w×h frame.
 *
 * The same solve the on-screen AspectMask does in CSS, so a still comes out
 * cropped to exactly the region the guide was drawing over. Returns the whole
 * frame when there is no ratio — "no guide" means "no crop", not "square".
 *
 * Integer output, because it indexes pixels: a fractional crop rect makes
 * drawImage resample and softens a shot that had no reason to be soft.
 */
export function cropRectFor(w, h, ratio) {
  const W = Math.max(0, Math.round(Number(w) || 0));
  const H = Math.max(0, Math.round(Number(h) || 0));
  const r = Number(ratio);
  if (!W || !H || !Number.isFinite(r) || r <= 0) return { x: 0, y: 0, w: W, h: H };

  let cw = W;
  let ch = Math.round(W / r);
  if (ch > H) { ch = H; cw = Math.round(H * r); }
  return {
    x: Math.round((W - cw) / 2),
    y: Math.round((H - ch) / 2),
    w: Math.max(1, cw),
    h: Math.max(1, ch),
  };
}
