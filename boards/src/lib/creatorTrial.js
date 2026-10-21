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
  const { tier, cards, cardLimit, trialStartedAt, storageUsed, storageQuota, wallCards } = opts || {};
  if (tier !== 'demo') return { eligible: false, reason: 'not_demo' };
  if (trialStartedAt) return { eligible: false, reason: 'already_trialed' };
  const n = Number(cards);
  if (!Number.isFinite(n) || n < 0) return { eligible: false, reason: 'cards_unknown' };
  const cap = Number(cardLimit);
  const byCount = n >= TRIAL_MIN_CARDS;
  const byCap = Number.isFinite(cap) && cap > 0 && n >= TRIAL_CAP_FRAC * cap;
  // The free drive is the other wall (0413). Someone who filled it with a few
  // big files has a real body of work at any card count. Only a known pair of
  // numbers counts; missing storage never invites anyone.
  const used = Number(storageUsed);
  const quota = Number(storageQuota);
  const byStorage = storageUsed != null && storageQuota != null
    && Number.isFinite(used) && Number.isFinite(quota) && quota > 0 && used >= TRIAL_CAP_FRAC * quota;
  // The wall itself is a body of work (owner, 2026-10-21). Someone stopped by
  // their own card cap, or dropping more than it holds, has brought their work
  // in even when nothing is placed or counted yet. The count is the client's
  // word, because the server cannot see a drop that was planned against the cap
  // before anything uploaded. That is acceptable: the trial still needs a card
  // and is once per account.
  const byWall = Number.isFinite(cap) && cap > 0 && Number.isInteger(wallCards) && wallCards > cap;
  if (!byCount && !byCap && !byStorage && !byWall) return { eligible: false, reason: 'too_early' };
  return { eligible: true, reason: byCount ? 'body_of_work' : byCap ? 'near_cap' : byStorage ? 'near_storage' : 'at_wall' };
}

// Is the trial decision still waiting on the server?
//
// Every surface decides the offer on the SERVER's card count, because the
// server re-decides at checkout and a trial it then refuses is a broken button.
// But that count lags the canvas: card_index is written by a throttled browser
// sync, so for several seconds after the thirteenth card the server still
// reports twelve. Production showed what that costs: the one-shot first-value
// banner, the pill and even the cap wall rendered the PRICE to people the
// server was about to invite to the trial — most trial-eligible banners in the
// two weeks after the trial shipped went out priced for exactly this reason.
//
// True when the browser's own count already qualifies, the server's does not,
// and the server is BEHIND rather than ahead. A delete runs the optimistic
// count backwards, and that direction must never hold an offer back, so a
// server count at or above the local one always answers false. Callers hold
// the priced variant (and the banner's one-shot) while this is true; useMyTier
// refetches as soon as the sync lands, so the wait is seconds, not a session.
export function trialAwaitingServer(opts) {
  const { tier, cards, serverCards, cardLimit, trialStartedAt } = opts || {};
  const local = Number(cards);
  const server = Number(serverCards);
  if (!Number.isFinite(local) || !Number.isFinite(server) || local <= server) return false;
  if (!creatorTrialEligibility({ tier, cards: local, cardLimit, trialStartedAt }).eligible) return false;
  return !creatorTrialEligibility({ tier, cards: server, cardLimit, trialStartedAt }).eligible;
}
