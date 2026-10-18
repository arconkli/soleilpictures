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

// Only a free plan has a card limit for bonus cards to raise; on Creator the
// storage is the part of the reward that is yours.
const earnsCards = (tier) => tier === 'demo';

// The share panel's note. `lead` is the sentence that has to land; `detail`
// says when; `how` is the fine print behind "How it works".
export function inviteRewardCopy({ tier } = {}) {
  const storage = INVITE_BONUS_STORAGE_LABEL;
  const lead = earnsCards(tier)
    ? `Invite someone new and get ${REFERRAL_REWARD_CARDS} free cards and ${storage}.`
    : `Invite someone new and get ${storage} more storage.`;
  const detail = earnsCards(tier)
    ? `They get ${REFERRAL_BONUS_CARDS} extra cards and ${storage} when they join. Yours lands when they add their first card.`
    : `They start with ${REFERRAL_BONUS_CARDS} extra free cards and ${storage}. Yours lands when they add their first card.`;
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

// "3 joined through you · 50 cards and 1GB earned · 1 on the way", from
// getMyReferralStats(). Nothing until someone has joined.
export function inviteProgressLine(stats) {
  const joined = Number(stats?.friendsJoined) || 0;
  if (joined <= 0) return null;
  const cards = Number(stats?.cardsEarned) || 0;
  const waiting = Number(stats?.rewardsWaiting) || 0;
  const parts = [`${joined} joined through you`];
  if (cards > 0) parts.push(`${cards} cards and ${formatBonusBytes(storageEarnedBytes(cards))} earned`);
  if (waiting > 0) parts.push(`${waiting} on the way`);
  return parts.join(' · ');
}

// The toast when bonus cards grow mid-session. `asInviter` is whether the
// referral stats show a new reward paid to you; otherwise the cards are your
// own welcome bonus (a new account joining through an edit link).
export function rewardToastMessage({ deltaCards, tier, asInviter } = {}) {
  const cards = Math.max(0, Number(deltaCards) || 0);
  if (!asInviter) {
    return `You got ${cards} extra free card${cards === 1 ? '' : 's'} and ${INVITE_BONUS_STORAGE_LABEL} for joining through an invite.`;
  }
  const bytes = storageEarnedBytes(cards);
  if (earnsCards(tier)) {
    const andStorage = bytes > 0 ? ` and ${formatBonusBytes(bytes)}` : '';
    return `You earned ${cards} free card${cards === 1 ? '' : 's'}${andStorage} — a friend you invited just got started.`;
  }
  return bytes > 0
    ? `You earned ${formatBonusBytes(bytes)} more storage — a friend you invited just got started.`
    : 'A friend you invited just got started.';
}
