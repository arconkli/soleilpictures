// inviteReward.js — what an invitation pays, in the words the share panel, the
// Invite tab and the reward toast use. The figures themselves are held to the
// SQL by gen-docs.mjs and securityAudit.test.mjs; this pins the wording rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REFERRAL_BONUS_CARDS, REFERRAL_REWARD_CARDS, REFERRAL_REWARDS_PER_30_DAYS,
  INVITE_BONUS_STORAGE_BYTES, INVITE_BONUS_STORAGE_LABEL,
  formatBonusBytes, inviteRewardCopy, storageEarnedBytes, inviteProgressLine, rewardToastMessage,
} from './inviteReward.js';

const EMOJI = /\p{Extended_Pictographic}/u;
const allText = (c) => [c.lead, c.detail, ...c.how].join(' ');

test('storage reads in the units every drive is labelled in', () => {
  assert.equal(INVITE_BONUS_STORAGE_BYTES, 512 * 1024 ** 2);
  assert.equal(INVITE_BONUS_STORAGE_LABEL, '0.5GB');
  assert.equal(formatBonusBytes(0), '0GB');
  assert.equal(formatBonusBytes(null), '0GB');
  assert.equal(formatBonusBytes(INVITE_BONUS_STORAGE_BYTES * 2), '1GB');
  assert.equal(formatBonusBytes(INVITE_BONUS_STORAGE_BYTES * 3), '1.5GB');
  assert.equal(formatBonusBytes(1024 ** 4), '1TB');
});

test('the headline is that you both get the free cards; the storage comes second', () => {
  // Owner, 2026-10-17: lead with the 25 cards, not the half GB, and say that
  // BOTH people get them. "Both" is only true while the friend's bonus and the
  // inviter's reward are one number; gen-docs holds each to its SQL.
  assert.equal(REFERRAL_BONUS_CARDS, REFERRAL_REWARD_CARDS, 'the "you both get" sentence needs one number');
  for (const tier of ['demo', 'paid', 'admin', 'waitlist', null, undefined]) {
    const c = inviteRewardCopy({ tier });
    assert.equal(c.lead, `Invite someone new and you both get ${REFERRAL_REWARD_CARDS} extra free cards.`, String(tier));
    assert.doesNotMatch(c.lead, /GB/, `${tier}: the storage is not the headline`);
    assert.ok(c.detail.includes(`You both get ${INVITE_BONUS_STORAGE_LABEL} more storage too`));
    assert.match(c.detail, /Theirs arrives when they join; yours when they add their first card\./);
  }
});

test('the fine print states the rules the server enforces, and nothing it does not', () => {
  for (const tier of ['demo', 'paid']) {
    const c = inviteRewardCopy({ tier });
    const how = c.how.join(' ');
    assert.ok(how.includes(`Up to ${REFERRAL_REWARDS_PER_30_DAYS} rewards in any 30 days`));
    assert.match(how, /new to Clusters/);
    assert.match(how, /already has an account/);
    assert.doesNotMatch(allText(c), /days old|hours old/, 'the inviter no longer waits for the account to age');
    assert.doesNotMatch(allText(c), EMOJI);
    assert.doesNotMatch(allText(c), /unlock/i, 'publicClaims: nothing about collaboration is locked');
  }
});

test('storage earned follows the cards the server credited', () => {
  assert.equal(storageEarnedBytes(0), 0);
  assert.equal(storageEarnedBytes(undefined), 0);
  assert.equal(storageEarnedBytes(REFERRAL_REWARD_CARDS), INVITE_BONUS_STORAGE_BYTES);
  assert.equal(storageEarnedBytes(REFERRAL_REWARD_CARDS * 2), INVITE_BONUS_STORAGE_BYTES * 2);
});

test('the progress line says nothing until someone joins, then only what is true', () => {
  assert.equal(inviteProgressLine(null), null);
  assert.equal(inviteProgressLine({ friendsJoined: 0, cardsEarned: 0 }), null);
  assert.equal(inviteProgressLine({ friendsJoined: 1, cardsEarned: 0, rewardsWaiting: 0 }), '1 joined through you');
  assert.equal(
    inviteProgressLine({ friendsJoined: 3, cardsEarned: REFERRAL_REWARD_CARDS * 2, rewardsWaiting: 1 }),
    `3 joined through you · ${REFERRAL_REWARD_CARDS * 2} free cards earned · 1 on the way`,
  );
});

test('the reward toast leads with the cards and tells an inviter from a newcomer', () => {
  assert.equal(
    rewardToastMessage({ deltaCards: REFERRAL_REWARD_CARDS, asInviter: true }),
    `You earned ${REFERRAL_REWARD_CARDS} free cards, plus 0.5GB of storage — a friend you invited just got started.`,
  );
  const own = rewardToastMessage({ deltaCards: REFERRAL_BONUS_CARDS, asInviter: false });
  assert.match(own, new RegExp(`^You got ${REFERRAL_BONUS_CARDS} extra free cards for joining through an invite`));
  assert.doesNotMatch(own, /friend you invited/);
  // A change that is not a whole reward never claims storage it did not pay.
  assert.equal(
    rewardToastMessage({ deltaCards: 1, asInviter: true }),
    'You earned 1 free card — a friend you invited just got started.',
  );
});
