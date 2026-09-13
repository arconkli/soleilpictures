// returnVisit.js — did this person come back today?
//
// App used to decide this alone, in an effect that runs only after get_my_tier
// resolves and App mounts. A day one that stalled on the tier splash, bounced
// during the seed, or never reached App for any reason left no stamp — and the
// next day's visit, the one everything here is trying to understand, was not
// recognised as a return at all. A quarter of second visits were invisible to
// the return-reason ask for exactly this reason.
//
// So the stamp is written by whoever sees the session first (AuthGate's presence
// ticker, which mounts before TierRouter), and the answer is parked here for App
// to pick up when it is ready. Pure, storage injected, node-testable.

const KEY = 'soleil_last_seen_day_';
const pending = new Map(); // uid → days since last seen (null = not a return)

function defaultStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
}

// Returns the number of whole days since this account was last seen in this
// browser, or null on a first sighting or a same-day repeat. Idempotent per uid
// per page load: the first call decides, later calls read the parked answer.
export function recordSeen(uid, opts = {}) {
  if (!uid) return null;
  if (pending.has(uid)) return pending.get(uid);
  const today = typeof opts.today === 'string' ? opts.today : new Date().toISOString().slice(0, 10);
  const storage = opts.storage !== undefined ? opts.storage : defaultStorage();
  let days = null;
  try {
    const last = storage ? storage.getItem(KEY + uid) : null;
    if (last && last !== today) {
      const d = Math.round((Date.parse(today) - Date.parse(last)) / 86400000);
      days = Number.isFinite(d) && d >= 1 ? d : null;
    }
    if (storage) storage.setItem(KEY + uid, today);
  } catch (_) {
    days = null;
  }
  pending.set(uid, days);
  return days;
}

// The parked answer, or undefined if nobody has recorded this uid this page load.
export function takeReturn(uid) {
  if (!uid || !pending.has(uid)) return undefined;
  return pending.get(uid);
}

export function __resetReturnVisit() { pending.clear(); }
