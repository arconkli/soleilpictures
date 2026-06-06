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
// onboarding starter cards, whose ids are stable `onb-*` (see onboardingStarter.js
// + the seed effect in App.jsx).
export function hasGenuineCard(cards) {
  return Array.isArray(cards)
    && cards.some((c) => c && c.id && !String(c.id).startsWith('onb-'));
}

// A single card is a seed (onboarding starter) iff its id is one of the stable
// `onb-*` ids. Inverse of the genuine test above, kept here so the client (the
// card_placed suppression + the activation detector) and the server trigger
// (_stamp_first_card in 0120) share ONE definition and never drift.
export function isSeedCard(card) {
  return !!(card && card.id && String(card.id).startsWith('onb-'));
}

// The genuine subset of a card batch — drops onboarding seeds. Used so
// card_placed (and the placed-count it reports) only ever counts real cards.
export function genuineCards(cards) {
  return Array.isArray(cards) ? cards.filter((c) => !isSeedCard(c)) : [];
}
