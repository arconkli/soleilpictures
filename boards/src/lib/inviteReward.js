// What an invitation pays, and the words the app uses to say so.
//
// Every invitation that turns into a NEW account pays two people:
//   - the person who joins, when they join: REFERRAL_BONUS_CARDS (billingCopy;
//     ensure_profile_for_new_user 0163, claim_collab_link 0371) and
//     INVITE_BONUS_STORAGE_BYTES (the referrals insert trigger, 0416);
//   - the person who invited them, once the friend has opened the app and
//     placed a first card: REFERRAL_REWARD_CARDS and the same storage
//     (_pay_referral_rewards and the reward trigger, 0416), at most
//     REFERRAL_REWARDS_PER_30_DAYS times in any 30 days.
// Inviting someone who already has an account shares the cluster and pays
// nobody — that is what keeps a second account from being a free top-up.
//
// EVERY NUMBER HERE IS ENFORCED IN SQL, and gen-docs.mjs / securityAudit.test.mjs
// fail the build when one drifts from the constant that pays it.

import { REFERRAL_BONUS_CARDS } from './billingCopy.js';

export { REFERRAL_BONUS_CARDS };

// _pay_referral_rewards: c_reward_cards and c_per_30_days (0416).
export const REFERRAL_REWARD_CARDS = 25;
export const REFERRAL_REWARDS_PER_30_DAYS = 4;

// _referral_bonus_storage_bytes() (0416): half a GiB, to each side.
export const INVITE_BONUS_STORAGE_BYTES = 536870912;

// Binary units, labelled the way billingCopy labels drives: a GiB reads "GB",
// with at most one decimal ("0.5GB", "1.5GB", "2GB").
export function formatBonusBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  const one = (x) => String(Math.round(x * 10) / 10);
  const gib = n / 1024 ** 3;
  return gib >= 1024 ? `${one(gib / 1024)}TB` : `${one(gib)}GB`;
}

export const INVITE_BONUS_STORAGE_LABEL = formatBonusBytes(INVITE_BONUS_STORAGE_BYTES);

// The share panel's note. `lead` is the sentence that has to land, and it is
// about cards, and about both people (owner, 2026-10-17: "you BOTH get 25
// extra free cards"; the storage comes second). That is only true while the
// friend's bonus and the inviter's reward are the same number, so the sentence
// falls back to naming each when they are not. `detail` adds the storage and
// says when; `how` is the fine print behind "Details". `tier` is accepted for
// callers that still pass it; the wording is the same on every plan.
export function inviteRewardCopy() {
  const storage = INVITE_BONUS_STORAGE_LABEL;
  const lead = REFERRAL_BONUS_CARDS === REFERRAL_REWARD_CARDS
    ? `Invite someone new and you both get ${REFERRAL_REWARD_CARDS} extra free cards.`
    : `Invite someone new: they get ${REFERRAL_BONUS_CARDS} extra free cards, and you get ${REFERRAL_REWARD_CARDS}.`;
  const detail = `You both get ${storage} more storage too. Theirs arrives when they join; yours when they add their first card.`;
  return {
    lead,
    detail,
    how: [
      'Counts for people new to Clusters — invited by email, or a new account that joins through your edit link.',
      'Theirs lands when they sign up. Yours lands as soon as they have opened Clusters and added their first card.',
      `Up to ${REFERRAL_REWARDS_PER_30_DAYS} rewards in any 30 days; any past that wait their turn.`,
      'Bonuses go to each person’s own account, add to any plan and never expire.',
      'Inviting someone who already has an account shares this with them, but earns no reward.',
    ],
  };
}

// Storage a referrer has earned, from the cards the server says it credited:
// both halves of a reward are paid together, so the count is the same.
export function storageEarnedBytes(cardsEarned) {
  const rewards = Math.floor(Math.max(0, Number(cardsEarned) || 0) / REFERRAL_REWARD_CARDS);
  return rewards * INVITE_BONUS_STORAGE_BYTES;
}

// "3 joined through you · 50 free cards earned · 1 on the way", from
// getMyReferralStats(). Cards only: the storage is in Settings → Invite & earn.
// Nothing until someone has joined.
export function inviteProgressLine(stats) {
  const joined = Number(stats?.friendsJoined) || 0;
  if (joined <= 0) return null;
  const cards = Number(stats?.cardsEarned) || 0;
  const waiting = Number(stats?.rewardsWaiting) || 0;
  const parts = [`${joined} joined through you`];
  if (cards > 0) parts.push(`${cards} free cards earned`);
  if (waiting > 0) parts.push(`${waiting} on the way`);
  return parts.join(' · ');
}

// The toast when bonus cards grow mid-session — cards first, the storage after.
// `asInviter` is whether the referral stats show a new reward paid to you;
// otherwise the cards are your own welcome bonus (a new account joining
// through an edit link).
export function rewardToastMessage({ deltaCards, asInviter } = {}) {
  const cards = Math.max(0, Number(deltaCards) || 0);
  const plural = cards === 1 ? '' : 's';
  if (!asInviter) {
    return `You got ${cards} extra free card${plural} for joining through an invite, plus ${INVITE_BONUS_STORAGE_LABEL} of storage.`;
  }
  const bytes = storageEarnedBytes(cards);
  const plus = bytes > 0 ? `, plus ${formatBonusBytes(bytes)} of storage` : '';
  return `You earned ${cards} free card${plural}${plus} — a friend you invited just got started.`;
}
