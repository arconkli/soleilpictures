// stalledSignups — who the Overview's "Arrived and stalled" panel lists.
// Plain JS so node --test can drive it (src/lib/adminStalledSignups.test.mjs).
//
// Reads admin_user_dormancy rows { user_id, email, signup (UTC date),
// last_active_day, days_dormant, active_day_count, did_card, ... }.
//
// The panel promises "signed up ≤14d ago, no card ever". It used to filter on
// days_dormant instead, which is days since LAST activity: an account from
// months ago that opened the app last week qualified, and anyone who never
// opened the app at all (days_dormant is null without a user_active_day row)
// was dropped, which on a real week was most of the people the panel is for.

const DAY_MS = 86_400_000;

/** Whole UTC days from a YYYY-MM-DD signup to `now`. */
export function daysSinceSignup(signup, now = Date.now()) {
  const t = Date.parse(`${String(signup).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const today = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((today - t) / DAY_MS);
}

/**
 * Recent signups with no card, most-returning first (a person who came back
 * three times and still made nothing is the one worth a message), then newest.
 * Returns { rows, total }: `rows` is the first `limit`, `total` all of them.
 */
export function stalledSignups(rows, { now = Date.now(), days = 14, limit = 6 } = {}) {
  const all = (rows || [])
    .filter((r) => !r.did_card)
    .map((r) => ({ ...r, signup_age: daysSinceSignup(r.signup, now) }))
    .filter((r) => r.signup_age != null && r.signup_age >= 0 && r.signup_age <= days)
    .sort((a, b) => (Number(b.active_day_count) || 0) - (Number(a.active_day_count) || 0)
      || a.signup_age - b.signup_age);
  return { rows: all.slice(0, limit), total: all.length };
}
