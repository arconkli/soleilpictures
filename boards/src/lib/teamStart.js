// teamStart — "Start a Team trial", carried across sign-in (creatorIntent.js
// is the same idea for Creator).
//
// The signed-out /pricing can't start a team: there is no session to own one.
// So its Team card writes down the seats and billing it was showing and sends
// the visitor to sign in at '/'; once a session exists, AuthGate opens the
// setup at /team/new with them (TeamSetup reads ?seats= and ?billing=).
// localStorage, not the URL: the sign-in email's link lands on the bare origin.
// The signed-in pricing page builds its link with teamStartHref too.
//
// Pure, storage injected, so it unit-tests under node. AuthGate imports it,
// so it stays tiny and never imports the team model.

export const TEAM_START_KEY = 'soleil.boards.pending.team.start';

// A day, like a Creator intent.
export const TEAM_START_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const BILLING = new Set(['monthly', 'annual']);

// TeamSetup applies the plan's floor and ceiling itself; this only drops what
// can't be a seat count at all.
const seatsOf = (n) => {
  const v = Number(n);
  return Number.isInteger(v) && v >= 1 && v <= 1000 ? v : null;
};

function store(storage) {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
}

export function teamStartHref({ seats, billing } = {}) {
  const q = new URLSearchParams();
  const s = seatsOf(seats);
  if (s) q.set('seats', String(s));
  q.set('billing', BILLING.has(billing) ? billing : 'monthly');
  return `/team/new?${q}`;
}

// Returns whether it stuck.
export function stashTeamStart({ seats, billing, now = Date.now() } = {}, storage) {
  const s = store(storage);
  if (!s) return false;
  try {
    s.setItem(TEAM_START_KEY, JSON.stringify({
      seats: seatsOf(seats),
      billing: BILLING.has(billing) ? billing : 'monthly',
      at: now,
    }));
    return true;
  } catch (_) {
    return false;
  }
}

// { seats, billing, ageMs }, or null when there is none, it is unreadable or
// it has expired. A bad or expired entry is removed on read.
export function readTeamStart({ now = Date.now(), maxAgeMs = TEAM_START_MAX_AGE_MS } = {}, storage) {
  const s = store(storage);
  if (!s) return null;
  let raw = null;
  try { raw = s.getItem(TEAM_START_KEY); } catch (_) { return null; }
  if (!raw) return null;
  let v = null;
  try { v = JSON.parse(raw); } catch (_) { v = null; }
  // Number(null) is 0 and finite: an entry with no timestamp is not one from 1970.
  const at = typeof v?.at === 'number' ? v.at : NaN;
  const age = now - at;
  if (!Number.isFinite(at) || !BILLING.has(v.billing) || age < 0 || age > maxAgeMs) {
    clearTeamStart(s);
    return null;
  }
  return { seats: seatsOf(v.seats), billing: v.billing, ageMs: age };
}

export function clearTeamStart(storage) {
  const s = store(storage);
  if (!s) return;
  try { s.removeItem(TEAM_START_KEY); } catch (_) { /* nothing to clear */ }
}
