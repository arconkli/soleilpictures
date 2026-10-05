// dockFatigue — how many times the "add more" docks may ask.
//
// The mix prompt ("add a note · say what this is") and the depth dock ("add
// images · pick several at once") were sticky per board and per device until
// dismissed, so they came back on every visit to every board that qualified.
// People who come back to a board mostly come back to LOOK at it — by the fifth
// visit almost none of them add a card — and they were asked, visit after
// visit, to add more — on some boards the same prompt came back nearly every visit.
//
// Two limits, both counted on this device:
//   * per board, a dock shows on at most DOCK_MAX_VISITS visits (a visit is an
//     app session — lib/appSession rotates on 30 min idle, sign-in, UTC day);
//   * per kind, a person who has dismissed a dock DISMISS_RETIRES times has
//     answered the question, and that dock never asks them again anywhere.
//
// Pure: callers pass what they read from storage and write what comes back.

export const DOCK_MAX_VISITS = 2;
export const DISMISS_RETIRES = 2;

export const dockVisitsKey = (kind, boardId) => `soleil.dock.visits.${kind}.${boardId}`;
export const dockDismissCountKey = (kind) => `soleil.dock.dismissals.${kind}`;

/** Parse a stored visit list. Anything malformed reads as "never shown". */
export function parseVisits(raw) {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x).slice(-10) : [];
  } catch (_) {
    return [];
  }
}

/**
 * May this dock show during `session`? Already showing this visit stays shown;
 * otherwise only while fewer than `max` visits have seen it.
 */
export function dockVisitAllowed({ visits = [], session = null, max = DOCK_MAX_VISITS } = {}) {
  if (!session) return true;              // no session id (should not happen): never suppress on a missing value
  if (visits.includes(session)) return true;
  return visits.length < max;
}

/** The visit list after the dock showed during `session` (deduped, bounded). */
export function noteDockVisit(visits = [], session = null) {
  if (!session || visits.includes(session)) return visits;
  return [...visits, session].slice(-10);
}

/** Has this person dismissed this kind of dock often enough to retire it? */
export function dockRetired(dismissCount, retires = DISMISS_RETIRES) {
  const n = Number(dismissCount);
  return Number.isFinite(n) && n >= retires;
}

/**
 * The root, once it holds clusters, is a home for projects — not a board that
 * is short of material. Neither dock belongs there.
 */
export function rootHoldsClusters(board, cards) {
  if (!board || board.parent_board_id != null) return false;
  return Array.isArray(cards) && cards.some((c) => c && (c.kind === 'board' || c.kind === 'boardlink'));
}
