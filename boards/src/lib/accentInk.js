// Ink for text and icons on an accent (--soleil) fill.
//
// styles.css sets --on-soleil to a fixed dark ink, which reads on the default
// gold. But the accent is user-chosen (Settings > Appearance > Accent), and on a
// dark accent such as the 'ink' preset #5b574e that dark ink sits near 2.6:1 on
// every gold-filled button and badge. The accent-override writers (index.html's
// bootstrap and App.jsx) emit --on-soleil from this alongside --soleil.
//
// index.html cannot import modules, so it carries an inline copy of this
// choice; accentInk.test.mjs runs that copy against this one.

import { contrastRatio, parseColor } from './readableColor.js';

export const ON_SOLEIL_DARK = '#1a1205';
export const ON_SOLEIL_LIGHT = '#ffffff';

// Whichever of the two inks has the higher WCAG contrast on `hex`. Unparseable
// input keeps the stylesheet's dark ink.
export function onSoleilInk(hex) {
  const bg = parseColor(hex);
  if (!bg) return ON_SOLEIL_DARK;
  const dark = contrastRatio(bg, parseColor(ON_SOLEIL_DARK));
  const light = contrastRatio(bg, parseColor(ON_SOLEIL_LIGHT));
  return light > dark ? ON_SOLEIL_LIGHT : ON_SOLEIL_DARK;
}
