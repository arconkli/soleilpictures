// trialCore — who may be offered the Creator trial, and for how long.
//
// Plain ESM JavaScript, no Deno APIs, no npm deps, so the SAME file runs in
// the Deno edge bundle (create-checkout-session decides with it, server-side,
// against the caller's own tier row) and under the repo's `node --test` gate
// (boards/src/lib/trialCore.test.mjs), which also asserts that the client twin
// in boards/src/lib/creatorTrial.js and the copy constants in billingCopy.js
// agree with it. A trial the client offers and the server refuses would be a
// broken button; a trial the server allows and the client never offers would
// be a silent gate. The test keeps the three in lockstep.
//
// The rule, and why it is this rule:
//   • demo tier only — a paid or comped account has nothing to try;
//   • never twice — one trial per account, ever, stamped on the profile the
//     moment a trialing subscription actually starts (not when the session is
//     created, so bouncing at the card form does not burn the offer);
//   • a real body of work — the same absolute floor the upgrade chip uses to
//     decide someone is committed, OR standing at or near their own cap.
//     The trial is an invitation extended in-product to people who have built
//     something; it is deliberately not a public offer. Premium professional
//     tools all run trials (Final Draft, FL Studio, the DAWs, Adobe); what
//     protects a premium position is who is offered it and where.

export const CREATOR_TRIAL_DAYS = 14;
// Mirrors upsellEligibility.THRESHOLDS.investedMin — the chip and the trial
// agree on what "committed" means. trialCore.test.mjs asserts the equality.
export const TRIAL_MIN_CARDS = 13;
export const TRIAL_CAP_FRAC = 0.8;

// creatorTrialEligibility({ tier, cards, cardLimit, trialStartedAt })
//   -> { eligible: boolean, reason: string }
// reason: 'not_demo' | 'already_trialed' | 'cards_unknown' | 'too_early'
//         | 'body_of_work' | 'near_cap'
// Fails CLOSED on junk: an unknown tier or count is not eligible.
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

// Has this Stripe customer ever held a subscription with a trial? A second
// backstop beside the profile stamp, for the case where the stamp was lost
// (a failed write) but Stripe remembers. `subs` is the `data` of a
// subscriptions.list({ status: 'all' }) call.
export function customerHasTrialed(subs) {
  return (subs || []).some((s) => s && (s.trial_end || s.trial_start));
}
