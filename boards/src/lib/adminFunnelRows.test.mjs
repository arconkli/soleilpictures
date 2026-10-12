// adminFunnelRows.test.mjs — node --test src/lib/adminFunnelRows.test.mjs
//
// The funnel hero's ⚠ and the "Biggest leak" panel beside it both come from
// buildFunnelRows. They used to be computed separately, and both scanned the
// waitlist's retired Welcome page as the last core step: it counts zero, so
// "OTP verified -> Welcome page" was a 100% drop that won every time and hid
// the real leak. Numbers here are synthetic; only the shape is real.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFunnelRows, liveSteps } from '../pages/admin/viz/funnelRows.js';

const STEPS = [
  { ord: 1, step: 'landing_view',     label: 'Landing view',           branch: 'core',     sessions: 100 },
  { ord: 2, step: 'email_submit',     label: 'Email submitted',        branch: 'core',     sessions: 40 },
  { ord: 3, step: 'otp_verify',       label: 'OTP verified (account)', branch: 'core',     sessions: 30 },
  { ord: 4, step: 'welcome_view',     label: 'Welcome page',           branch: 'core',     sessions: 0 },
  { ord: 5, step: 'waitlist_submit',  label: 'Joined waitlist',        branch: 'waitlist', sessions: 0 },
  { ord: 7, step: 'pricing_view',     label: 'Viewed pricing',         branch: 'pricing',  sessions: 6 },
  { ord: 8, step: 'checkout_open',    label: 'Opened checkout',        branch: 'pricing',  sessions: 3 },
  { ord: 9, step: 'checkout_success', label: 'Completed payment',      branch: 'pricing',  sessions: 2 },
  { ord: 20, step: 'email_submit_error', label: 'Email submit failed', branch: 'leak',     sessions: 4 },
];

test('the retired Welcome page is not a funnel step', () => {
  assert.ok(!liveSteps(STEPS).some((s) => s.step === 'welcome_view'));
  const { coreRows } = buildFunnelRows(STEPS, ['pricing']);
  assert.deepEqual(coreRows.map((r) => r.label), ['Landing view', 'Email submitted', 'OTP verified (account)']);
});

test('the biggest leak is the real one, not the dead step', () => {
  const { biggest } = buildFunnelRows(STEPS, ['pricing']);
  assert.equal(biggest.from, 'Landing view');
  assert.equal(biggest.label, 'Email submitted');
  assert.equal(biggest.drop, 60);
});

test('the pricing branch forks from the account, not from a zero', () => {
  const { branchRows } = buildFunnelRows(STEPS, ['pricing']);
  const first = branchRows[0].rows[0];
  assert.equal(first.isForkStart, true);
  assert.equal(first.from, 'OTP verified (account)');
  assert.equal(first.step, 6 / 30);
});

test('the fork itself is never the biggest leak, and an undrawn branch is never scanned', () => {
  // Fork 30 -> 6 is an 80% "drop"; the waitlist chain is all zeros. Neither may win.
  const steps = STEPS.map((s) => (s.step === 'email_submit' ? { ...s, sessions: 95 } : s))
    .map((s) => (s.step === 'otp_verify' ? { ...s, sessions: 90 } : s));
  const { biggest } = buildFunnelRows(steps, ['pricing']);
  assert.equal(biggest.from, 'Viewed pricing');
  assert.equal(biggest.label, 'Opened checkout');
});

test('a funnel with no retired step is unchanged (the FB/IG funnel)', () => {
  const fb = [
    { step: 'landing_view', label: 'Landing view', branch: 'core', sessions: 10 },
    { step: 'ad_offer_view', label: 'Saw the price offer', branch: 'core', sessions: 5 },
    { step: 'ad_offer_enter', label: 'Stepped into the demo', branch: 'demo', sessions: 4 },
  ];
  const { coreRows, branchRows } = buildFunnelRows(fb, ['demo', 'buy']);
  assert.equal(coreRows.length, 2);
  assert.equal(branchRows.length, 1);
  assert.equal(branchRows[0].rows[0].from, 'Saw the price offer');
});
