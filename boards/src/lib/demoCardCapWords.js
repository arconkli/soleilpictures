// demoCardCapWords — what the card cap says when it refuses, as whole
// sentences read through Lingui. App only: demoCardCap.js (the maths, the
// numbers gen-docs reads, and rejectedNoun's English) stays as it is.
// demoCardCapWords.test.mjs holds the English together.
//
// rejectedNoun() still decides WHICH thing was refused ('photos' or 'cards',
// singular or plural by the count); these functions take its answer and say the
// whole sentence, one message per noun, so a language can inflect each.

import { t as tr, plural } from '@lingui/core/macro';

const isPhoto = (noun) => noun === 'photo' || noun === 'photos';

// "28 photos couldn't be added." (the cap-hit modal)
export function rejectedNotAdded(noun, n) {
  return isPhoto(noun)
    ? tr`${plural(n, { one: "# photo couldn't be added.", other: "# photos couldn't be added." })}`
    : tr`${plural(n, { one: "# card couldn't be added.", other: "# cards couldn't be added." })}`;
}

// "3 more photos didn't fit. " (the cap toast; the trailing space is the
// caller's, which writes the next sentence after it)
export function rejectedMoreDidntFit(noun, n) {
  return isPhoto(noun)
    ? tr`${plural(n, { one: "# more photo didn't fit. ", other: "# more photos didn't fit. " })}`
    : tr`${plural(n, { one: "# more card didn't fit. ", other: "# more cards didn't fit. " })}`;
}
