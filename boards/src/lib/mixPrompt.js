// mixPrompt — when to invite the first words onto a board that is all pictures.
//
// Why this exists: measured against whether a new user ever came back after
// day one, a board holding only images is worth what an empty account is
// worth. Signups since the waitlist came off, aged at least a week, bucketed
// by what they built in their first 24 hours:
//
//   no cards at all ................. 25% returned
//   one board, images only .......... 25% returned   (averaging 6.5 cards)
//   one board, images AND notes ..... 55% returned   (averaging 9.2 cards)
//
// Placing half a dozen photos and placing nothing produce the same return
// rate. Writing one line next to them doubles it. Card COUNT is not the
// variable — every activation surface in the product is tuned to raise it,
// depth has been climbing for a month, and return has not moved.
//
// So the ask is not "add more". It is "say what this is". Whether the writing
// causes the return or merely marks the user who had a real project is not
// separable from observational data, and it does not have to be: both readings
// point at the same intervention, and the acceptance test is the same table
// re-run after this ships.
//
// Pure and dependency-free (mirrors depthDock.js, shareAsk.js and
// upsellSlot.js) so the threshold is unit-testable under node with no
// React/Yjs/backend — see the sibling .test.mjs. Threshold logic that decides
// whether a user is ever asked does not belong inline: the near-cap warning
// lived as an inline equality test against a counter that moves in jumps and
// fired twice in ninety days before anyone noticed.

// Enough pictures that the board is visibly ABOUT something, so "what is this?"
// is a fair question rather than an interruption of someone still arriving.
// Below this the depth dock still owns the moment with "add a few more" — the
// two hand off rather than competing (see shouldPromptMix's precedence note).
//
// Deliberately its own constant and NOT wired to DEPTH_DOCK_MAX: that one marks
// where a board stops being thin, which is a different question from where a
// board has earned a caption. Moving one must not silently move the other.
export const MIX_PROMPT_MIN_IMAGES = 3;

// Ask iff the board has real pictures on it and no words anywhere, the viewer
// can actually add a card, and they haven't waved the ask away for this board.
//
// `text` counts every card the user WROTE INTO — notes, docs, scripts — not
// just notes. The day-one table measured notes because that is what day-one
// users make, but someone who opened a doc has already done the thing this
// prompt asks for, and nagging them would be a false positive. The reading that
// matters is "is there any language on this board", not "is there a note".
//
// Deliberately NO upper bound on images. A board with fifty photos and no words
// is the exact user this is for — the day-one bulk import — and capping the ask
// at some tidy number would exclude them. Dismissal is sticky per board, which
// is what stops this from becoming nagging.
export function shouldPromptMix(opts) {
  // A destructuring default only covers `undefined`, never `null`, and every
  // caller here sits on a render path where a throw would take the canvas out.
  const {
    images,
    text,
    dismissed = false,
    canEdit = false,
    isPublic = false,
    min = MIX_PROMPT_MIN_IMAGES,
  } = opts || {};

  if (!canEdit || isPublic || dismissed) return false;

  // null must be tested BEFORE the finite check, because `Number(null)` is a
  // perfectly finite 0. A null `text` would otherwise read as "no words here"
  // and prompt a user who has written plenty — the same trap upsellSlot's
  // resolveNow documents and shouldWarnNearCap was bitten by.
  if (images === null || images === undefined) return false;
  if (text === null || text === undefined) return false;

  const img = Number(images);
  const words = Number(text);
  const floor = Number(min);
  if (!Number.isFinite(img) || !Number.isFinite(words) || !Number.isFinite(floor)) return false;

  return words === 0 && img >= floor;
}
