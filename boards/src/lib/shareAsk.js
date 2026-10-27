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

// At most one ask a week per account (owner, 2026-10-27). The per-cluster
// stamp alone stopped being a limit once clusters went free: a busy account
// crossed six cards on cluster after cluster and was asked every time, and
// almost nobody took it. App keeps the account's last show beside the
// per-cluster stamp and passes it in as `lastAskedAt`.
export const SHARE_ASK_GAP_MS = 7 * 24 * 60 * 60 * 1000;

// Offer iff the cluster has enough in it to be worth showing, the viewer can
// actually produce a link, they haven't already shared this board, they
// haven't waved the ask away for it, and the account hasn't been asked in the
// last week.
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
    lastAskedAt = null,
    now = Date.now(),
  } = opts || {};

  if (!canEdit || alreadyShared || dismissed) return false;
  if (askedWithinGap(lastAskedAt, now)) return false;

  const n = Number(genuineCards);
  const floor = Number(min);
  if (!Number.isFinite(n) || !Number.isFinite(floor)) return false;

  return n >= floor;
}

// `lastAskedAt` arrives straight from localStorage: a string, null, or junk.
// Junk is ignored rather than obeyed, so a bad stamp costs one extra ask and
// is then rewritten, instead of retiring the ask for the account for good.
// Number(null) and Number('') are 0, which reads as "long ago", but they are
// screened first anyway. A stamp more than a week AHEAD of the clock (a clock
// that was wrong when it was written) is junk by the same rule; one a little
// ahead (a clock nudged back) still counts.
function askedWithinGap(lastAskedAt, now) {
  if (lastAskedAt == null || lastAskedAt === '') return false;
  const last = Number(lastAskedAt);
  const t = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  if (!Number.isFinite(last)) return false;
  return Math.abs(t - last) < SHARE_ASK_GAP_MS;
}
