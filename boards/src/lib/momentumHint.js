// momentumHint — a one-time, device-local "add a few more" nudge shown right
// after a new phone user's first photo batch lands, while they're still short of
// a populated board (3+ genuine cards). Mobile users bounce at 1–2 cards; a
// gentle beat that re-opens the multi-select picker turns one photo into a few.
//
// Same rationale as liftHint (CanvasSurface): a touch nudge belongs in
// localStorage, not onboarding settings — it sidesteps any onboarding-settings
// write race, and a default of "seen" on any read failure means we err toward
// NOT nagging. Once per device, ever.
const MOMENTUM_HINT_KEY = 'soleil.momentumHintSeen';

export function momentumHintSeen() {
  try { return localStorage.getItem(MOMENTUM_HINT_KEY) === '1'; } catch (_) { return true; }
}

export function markMomentumHintSeen() {
  try { localStorage.setItem(MOMENTUM_HINT_KEY, '1'); } catch (_) {}
}
