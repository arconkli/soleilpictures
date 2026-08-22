// depthDock — when to keep offering "add images" after the first card lands.
//
// The empty-board panel (.cnv-empty-tiles) is the only surface in the product
// that says "pick several at once", and it renders on `boardIsEmpty ||
// firstCardPrompt`. So it unmounts the instant ANY card exists — including a
// card that is an empty container rather than content. The multi-select message
// is therefore delivered exactly once, before the user has done anything, and
// a user whose opening move is placing a cluster destroys it without ever
// having added anything to look at.
//
// That matters because multi-select is the sharpest behavioural line between
// users who fill a board and users who place one card and stop: filling a board
// happens in one gesture that selects many files, far more often than in many
// gestures that select one. The dock keeps a quiet version of the offer alive
// through the band where boards are still too thin to be worth returning to.
//
// Kept pure and tested for the same reason `shouldWarnNearCap` is: the near-cap
// warning lived inline as an equality test against a counter that moves in
// jumps, and it fired twice in ninety days without anyone noticing. Threshold
// logic that decides whether a user ever sees a prompt does not belong inline.

// Boards below this many genuine cards are still thin enough that the offer is
// help rather than noise. Deliberately NOT wired to POP_BOARD_THRESHOLD or
// MOMENTUM_THRESHOLD: those two certify activation and are read by dormancy
// gates and by months of history, so they answer "did this land" and must not
// be repurposed into "should we still be nudging".
export const DEPTH_DOCK_MAX = 6;

// Show the dock iff the board has at least one genuine card and fewer than
// DEPTH_DOCK_MAX of them, the viewer can actually add to it, and they haven't
// waved it away.
//
// At zero cards the empty panel is already on screen and owns the message —
// two offers at once would be worse than one.
export function shouldShowDepthDock(opts) {
  // A destructuring default only covers `undefined`, never `null`, and every
  // caller here sits on a render path where a throw would take the canvas out.
  const {
    genuine,
    dismissed = false,
    canEdit = false,
    isPublic = false,
    max = DEPTH_DOCK_MAX,
  } = opts || {};

  if (!canEdit || isPublic || dismissed) return false;

  const n = Number(genuine);
  const cap = Number(max);
  if (!Number.isFinite(n) || !Number.isFinite(cap)) return false;

  return n >= 1 && n < cap;
}
