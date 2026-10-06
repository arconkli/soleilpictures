// resumeSitting.js — the first break on day one.
//
// The strongest day-one marker of coming back is a second SITTING: real
// activity resuming after a break of half an hour or more on the first day —
// usually a couple of hours later, on the same device, often in the same tab,
// with no email or link to bring them back. People who have one come back
// within a week several times as often as people who don't, in every depth
// band (admin_second_sitting, 0361, re-measures that on every cohort).
//
// Nobody had designed that moment. A fresh app session starts after 30 idle
// minutes (lib/appSession), so the resumed sitting arrived with the ambient
// asks reset and nothing saying "your work is right here". This decides when to
// greet it — once, quietly — and which card to point back to. Pure and
// node-testable; the effect in App.jsx owns the listeners, the toast and the
// upsell-slot claim that keeps every ambient ask off that minute.
export const RESUME_GAP_MS = 30 * 60 * 1000;
export const DAY_ONE_MS = 24 * 60 * 60 * 1000;
export const LAST_HIDDEN_KEY = 'soleil.lastHiddenAt:';

// Greet when a person comes back after a real break, on the first day of their
// account, to work that is theirs — at most once per page.
export function shouldGreetResume({ awayMs, accountAgeMs, genuineCards, greeted } = {}) {
  if (greeted) return false;
  if (!Number.isFinite(awayMs) || awayMs < RESUME_GAP_MS) return false;
  if (!Number.isFinite(accountAgeMs) || accountAgeMs < 0 || accountAgeMs >= DAY_ONE_MS) return false;
  return Number.isFinite(genuineCards) && genuineCards > 0;
}

function stamp(c) {
  const a = Date.parse(c?.updatedAt || '');
  const b = Date.parse(c?.createdAt || '');
  const best = Math.max(Number.isFinite(a) ? a : -Infinity, Number.isFinite(b) ? b : -Infinity);
  return best;
}

// The card touched last (newest of updatedAt / createdAt), or null.
export function lastTouchedCard(cards) {
  if (!Array.isArray(cards)) return null;
  let best = null;
  let bestT = -Infinity;
  for (const c of cards) {
    if (!c || !c.id) continue;
    const t = stamp(c);
    if (best === null || t > bestT) { best = c; bestT = t; }
  }
  return best;
}
