// workSignal.js — "was that a work op, or just presence?"
//
// user_active_day is the atom under every retention curve, and it used to be
// written purely from the heartbeat, meaning a day on which someone opened a
// tab and did nothing counted exactly like a day of real work. Over 90 days,
// 54% of its rows had no work in them at all.
//
// The server-truth half of the fix is a trigger on card_index (migration 0248).
// This is the client half, which covers the work that never touches a card:
// doc edits, comments, tags, sharing.
//
// It lives in its own module purely to break a cycle — analytics.js reports the
// ops and heartbeat.js consumes them, and heartbeat.js already imports
// analytics.js for the ambient context.

let ops = 0;

/** Count one unit of real work. Cheap; called from the analytics emitter. */
export function noteWorkOp() { ops++; }

/**
 * Read and reset. The heartbeat calls this only when it is actually going to
 * send — otherwise a dropped flush would silently discard the evidence that
 * the day contained work at all.
 */
export function takeWorkOps() {
  const n = ops;
  ops = 0;
  return n;
}

/** Peek without consuming (tests, and the session summary). */
export function peekWorkOps() { return ops; }

export function __resetWorkOpsForTest() { ops = 0; }
