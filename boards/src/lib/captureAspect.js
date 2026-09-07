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
