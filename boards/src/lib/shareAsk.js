// shareAsk — when to offer to SHOW a cluster to someone.
//
// Why this exists: nothing in the product has ever asked a creator to show
// their work. The share affordances are discoverable (a toolbar control, a
// dialog) and the only creator-facing nudge asks you to recruit a
// collaborator — a materially harder ask that needs a second person who cares
// about this specific board, and one that has produced almost nothing.
//
// Showing needs only one person and something they're pleased with. That is
// also the loop that produces the best arrivals this product gets: people who
// land on a shared cluster go deeper and come back more often than any search
// visitor, whether the board they landed on was curated or somebody's ordinary
// project.
//
// Pure and dependency-free (mirrors depthDock.js and upsellEligibility.js) so
// the threshold is unit-testable with no React/Yjs/backend — see the sibling
// .test.mjs. Threshold logic that decides whether a user is ever asked does not
// belong inline: the near-cap warning lived as an inline equality test against
// a counter that moves in jumps and fired twice in ninety days before anyone
// noticed.

// A cluster worth showing has more in it than a cluster worth prompting about.
// Deliberately equal to DEPTH_DOCK_MAX so the two hand off cleanly rather than
// competing: the dock runs the [1, 6) band ("add a few more"), and this picks up
// exactly where the dock stops caring. Kept as its own constant rather than an
// import so moving one does not silently move the other.
export const SHARE_ASK_MIN_CARDS = 6;

// Offer iff the cluster has enough in it to be worth showing, the viewer can
// actually produce a link, they haven't already shared this board, and they
// haven't waved the ask away for it.
//
// `alreadyShared` is the honest half of this: once a board has a live link the
// user has already done the thing, and asking again is nagging rather than
// helping.
export function shouldAskToShare(opts) {
  // A destructuring default covers `undefined` but never `null`, and every
  // caller sits on a render/effect path where a throw would take the board out.
  const {
    genuineCards,
    canEdit = false,
    alreadyShared = false,
    dismissed = false,
    min = SHARE_ASK_MIN_CARDS,
  } = opts || {};

  if (!canEdit || alreadyShared || dismissed) return false;

  const n = Number(genuineCards);
  const floor = Number(min);
  if (!Number.isFinite(n) || !Number.isFinite(floor)) return false;

  return n >= floor;
}
