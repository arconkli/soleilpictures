// adminKeep.js — what the desktop admin keeps from the last visit, and under
// which name (lib/adminSnapshot.js holds it; pages/admin/useAdminData.js paints
// it). Pure and node-testable.
//
// The snapshots sit in this browser's localStorage, so they hold counts only:
// no emails, names, user ids or anything a person wrote.

/** useAdminData's `keep` option, or null when it cannot be used (no account, no key). */
export function keepOf(keep) {
  if (!keep || !keep.uid || !keep.key) return null;
  return { uid: String(keep.uid), key: String(keep.key), save: typeof keep.save === 'function' ? keep.save : null };
}

/**
 * A snapshot's name: the read, and every input that changes its numbers, so a
 * snapshot never paints under another filter's label.
 *   snapKey('overview.q', [excludeInternal, verifiedOnly])
 */
export function snapKey(name, inputs = []) {
  return name + ':' + JSON.stringify(inputs);
}

/**
 * What the Overview's main read keeps. Three parts are left out and come back
 * null, which the view reads as "not loaded yet":
 *   users    Just arrived: emails and user ids
 *   stalled  Arrived and stalled: emails and user ids
 *   markers  the owner's notes and the alert titles: words people wrote
 * The rest is counts by day or week.
 */
export function overviewKeep(result) {
  if (!result || typeof result !== 'object') return result;
  return { ...result, users: null, stalled: null, markers: null };
}

/**
 * The header's "Updating…": true while a kept read on screen is showing the
 * last visit's numbers and its refresh has not failed (a failed one has the
 * "couldn't refresh" strip instead).
 */
export function isUpdating(...reads) {
  return reads.some((r) => !!r && !!r.stale && !r.error);
}
