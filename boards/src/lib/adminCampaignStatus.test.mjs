// adminCampaignStatus.test.mjs — node --test src/lib/adminCampaignStatus.test.mjs
//
// The Campaign tab said "Off — everyone goes through the waitlist" while the
// waitlist itself was off. The status line now follows both switches.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignStatus } from '../pages/admin/campaignStatus.js';

test('with the waitlist off, the switch says it has no effect either way', () => {
  assert.match(campaignStatus({ enabled: false, waitlistOn: false }), /^Off — no effect while the waitlist is off/);
  assert.match(campaignStatus({ enabled: true, waitlistOn: false }), /^On — no effect while the waitlist is off/);
  assert.doesNotMatch(campaignStatus({ enabled: false, waitlistOn: false }), /goes through the waitlist/);
});

test('with the waitlist on, or unknown, the original wording stands', () => {
  for (const waitlistOn of [true, null]) {
    assert.equal(campaignStatus({ enabled: false, waitlistOn }), 'Off — everyone goes through the waitlist');
    assert.equal(campaignStatus({ enabled: true, waitlistOn }), 'On — ad clicks get instant demo + the offer');
  }
});

test('saving wins', () => {
  assert.equal(campaignStatus({ busy: true, enabled: true, waitlistOn: false }), 'Saving…');
});
