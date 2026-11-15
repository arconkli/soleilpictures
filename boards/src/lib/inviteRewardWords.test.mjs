// inviteRewardWords.test.mjs — the app-only words say exactly what
// inviteReward.js says, for every id and every case.
//
//   node --import ./scripts/linguiNode.mjs --test src/lib/inviteRewardWords.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as shared from './inviteReward.js';
import * as words from './inviteRewardWords.js';

test('the share panel note reads the same: lead, detail and every how line', () => {
  assert.deepEqual(words.inviteRewardCopy(), shared.inviteRewardCopy());
});

test('the progress line reads the same for every mix of joined, earned and waiting', () => {
  const cases = [
    null, {}, { friendsJoined: 0 }, { friendsJoined: 1 }, { friendsJoined: 3 },
    { friendsJoined: 3, cardsEarned: 50 }, { friendsJoined: 3, rewardsWaiting: 1 },
    { friendsJoined: 3, cardsEarned: 50, rewardsWaiting: 1 }, { friendsJoined: 12, cardsEarned: 100, rewardsWaiting: 4 },
  ];
  for (const stats of cases) assert.equal(words.inviteProgressLine(stats), shared.inviteProgressLine(stats), JSON.stringify(stats));
});

test('the reward toast reads the same for joining and for inviting, at 0, 1 and many cards', () => {
  const N = shared.REFERRAL_REWARD_CARDS;
  for (const deltaCards of [0, 1, 2, N, N * 2, N * 4, undefined]) {
    for (const asInviter of [false, true]) {
      assert.equal(words.rewardToastMessage({ deltaCards, asInviter }), shared.rewardToastMessage({ deltaCards, asInviter }), `${deltaCards} ${asInviter}`);
    }
  }
  assert.equal(words.rewardToastMessage(), shared.rewardToastMessage());
});
