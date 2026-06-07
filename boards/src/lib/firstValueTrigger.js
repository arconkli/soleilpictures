// firstValueTrigger — pure helpers for the one-time "first value" upgrade nudge
// shown to demo users (see FirstValueUpgradeBanner + UpgradeChip wiring).
//
// The nudge fires the first time a demo user places a GENUINE (non-seeded) card
// during onboarding — their first real "aha" — re-timing the upgrade ask to peak
// context instead of only at the 100-card cap. App.jsx detects that moment and
// dispatches a `soleil:first-value` event; UpgradeChip owns the demo-gate, the
// once-per-account guard, the banner, and the modal. This helper is the genuine-
// vs-seeded test, kept pure so it's unit-testable and shared with the activation
// (ONBOARDING_FIRST_CARD) signal so the two never diverge.

// A genuine card is any card the user placed themselves — i.e. NOT one of the
// onboarding starter cards (see onboardingStarter.js + the seed effect in App.jsx).
export function hasGenuineCard(cards) {
  return Array.isArray(cards) && cards.some((c) => c && c.id && !isSeedCard(c));
}

// A single card is a seed (onboarding starter) iff its id is a stable `onb-*` id
// OR it carries an explicit `seed:true` flag. The flag covers the seeded nested
// "Ideas" board, whose canvas card id MUST equal its real DB UUID (kind:'board'
// renders via boards[c.id]) and therefore CANNOT use an onb- id. The flag is a
// durable card field (cards persist via raw Y.encodeStateAsUpdate, no field
// whitelisting), so it survives reloads — keeping the card_placed suppression +
// the activation detector aligned with intent. NOTE: the server triggers
// (_stamp_first_card / _stamp_first_populated_board in 0120) still key on
// `onb-%` only; they never see the seed board because it's excluded from
// card_index entirely (see _doSyncCardIndex in boardsApi.js).
export function isSeedCard(card) {
  if (!card) return false;
  if (card.seed === true) return true;
  return !!(card.id && String(card.id).startsWith('onb-'));
}

// The genuine subset of a card batch — drops onboarding seeds. Used so
// card_placed (and the placed-count it reports) only ever counts real cards.
export function genuineCards(cards) {
  return Array.isArray(cards) ? cards.filter((c) => !isSeedCard(c)) : [];
}
