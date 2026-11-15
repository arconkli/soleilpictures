// inviteRewardWords — what an invitation pays, in words read through Lingui.
// App only: inviteReward.js (the numbers, and the English gen-docs and the
// Playwright specs read) stays as it is, and this module says the same things
// keyed by the same ids. inviteRewardWords.test.mjs holds the two English
// versions together. Every number comes from inviteReward.js.

import { t as tr, ph, plural } from '@lingui/core/macro';
import {
  REFERRAL_BONUS_CARDS, REFERRAL_REWARD_CARDS, REFERRAL_REWARDS_PER_30_DAYS,
  INVITE_BONUS_STORAGE_BYTES, formatBonusBytes, storageEarnedBytes,
} from './inviteReward.js';

// The share panel's note: `lead` lands first, `detail` adds the storage and
// when, `how` is the fine print behind "Details".
export function inviteRewardCopy() {
  const storage = formatBonusBytes(INVITE_BONUS_STORAGE_BYTES);
  const lead = REFERRAL_BONUS_CARDS === REFERRAL_REWARD_CARDS
    ? tr`Invite someone new and you both get ${ph({ cards: REFERRAL_REWARD_CARDS })} extra free cards.`
    : tr`Invite someone new: they get ${ph({ theirs: REFERRAL_BONUS_CARDS })} extra free cards, and you get ${ph({ yours: REFERRAL_REWARD_CARDS })}.`;
  const detail = tr`You both get ${ph({ storage })} more storage too. Theirs arrives when they join; yours when they add their first card.`;
  return {
    lead,
    detail,
    how: [
      tr`Counts for people new to Clusters — invited by email, or a new account that joins through your edit link.`,
      tr`Theirs lands when they sign up. Yours lands as soon as they have opened Clusters and added their first card.`,
      tr`Up to ${ph({ rewards: REFERRAL_REWARDS_PER_30_DAYS })} rewards in any 30 days; any past that wait their turn.`,
      tr`Bonuses go to each person’s own account, add to any plan and never expire.`,
      tr`Inviting someone who already has an account shares this with them, but earns no reward.`,
    ],
  };
}

// "3 joined through you · 50 free cards earned · 1 on the way". Nothing until
// someone has joined.
export function inviteProgressLine(stats) {
  const joined = Number(stats?.friendsJoined) || 0;
  if (joined <= 0) return null;
  const cards = Number(stats?.cardsEarned) || 0;
  const waiting = Number(stats?.rewardsWaiting) || 0;
  const parts = [tr`${joined} joined through you`];
  if (cards > 0) parts.push(tr`${cards} free cards earned`);
  if (waiting > 0) parts.push(tr`${waiting} on the way`);
  return parts.join(' · ');
}

// The toast when bonus cards grow mid-session — cards first, the storage after.
export function rewardToastMessage({ deltaCards, asInviter } = {}) {
  const cards = Math.max(0, Number(deltaCards) || 0);
  if (!asInviter) {
    const storage = formatBonusBytes(INVITE_BONUS_STORAGE_BYTES);
    return tr`${plural(cards, {
      one: `You got # extra free card for joining through an invite, plus ${storage} of storage.`,
      other: `You got # extra free cards for joining through an invite, plus ${storage} of storage.`,
    })}`;
  }
  const bytes = storageEarnedBytes(cards);
  if (bytes > 0) {
    const earned = formatBonusBytes(bytes);
    return tr`${plural(cards, {
      one: `You earned # free card, plus ${earned} of storage — a friend you invited just got started.`,
      other: `You earned # free cards, plus ${earned} of storage — a friend you invited just got started.`,
    })}`;
  }
  return tr`${plural(cards, {
    one: 'You earned # free card — a friend you invited just got started.',
    other: 'You earned # free cards — a friend you invited just got started.',
  })}`;
}
