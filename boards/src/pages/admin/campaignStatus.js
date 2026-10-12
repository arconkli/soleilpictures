// campaignStatus — the Campaign tab's one-line status. Plain JS so node --test
// can drive it (src/lib/adminCampaignStatus.test.mjs); the tab needs auth to
// mount and the DEV harness has no Campaign tab.
//
// The ad-instant-demo switch only matters while the waitlist master switch is
// ON. With the waitlist off there is no line to skip: every signup already
// gets demo + the offer, and this switch only records the ad-signup cohort.
// The line used to say "Off — everyone goes through the waitlist" regardless,
// asserting a gate that did not exist. `waitlistOn` null (unknown, the read
// failed) keeps the waitlist-on wording.

export function campaignStatus({ busy = false, enabled = false, waitlistOn = null } = {}) {
  if (busy) return 'Saving…';
  if (waitlistOn === false) {
    return enabled
      ? 'On — no effect while the waitlist is off; ad signups are still recorded'
      : 'Off — no effect while the waitlist is off; every signup goes straight in';
  }
  return enabled
    ? 'On — ad clicks get instant demo + the offer'
    : 'Off — everyone goes through the waitlist';
}
