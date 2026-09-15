// creatorTrial — the client's copy of the trial rule.
//
// The rule lives in supabase/functions/_shared/trialCore.mjs, where the edge
// function enforces it. This twin exists because the app bundle cannot import
// from outside boards/ under the dev server, and trialCore.test.mjs asserts
// that the two give identical answers on the same inputs and that the day
// count here (via billingCopy) matches the one the server puts on the Stripe
// session. Change one, and the test tells you to change the other.
import { CREATOR_TRIAL_DAYS } from './billingCopy.js';
import { THRESHOLDS } from './upsellEligibility.js';

export { CREATOR_TRIAL_DAYS };
export const TRIAL_MIN_CARDS = THRESHOLDS.investedMin;
export const TRIAL_CAP_FRAC = 0.8;

export function creatorTrialEligibility(opts) {
  const { tier, cards, cardLimit, trialStartedAt } = opts || {};
  if (tier !== 'demo') return { eligible: false, reason: 'not_demo' };
  if (trialStartedAt) return { eligible: false, reason: 'already_trialed' };
  const n = Number(cards);
  if (!Number.isFinite(n) || n < 0) return { eligible: false, reason: 'cards_unknown' };
  const cap = Number(cardLimit);
  const byCount = n >= TRIAL_MIN_CARDS;
  const byCap = Number.isFinite(cap) && cap > 0 && n >= TRIAL_CAP_FRAC * cap;
  if (!byCount && !byCap) return { eligible: false, reason: 'too_early' };
  return { eligible: true, reason: byCount ? 'body_of_work' : 'near_cap' };
}
