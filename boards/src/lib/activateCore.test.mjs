// activateCore.test.mjs — regression suite for the money- and entitlement-
// bearing pure logic shared by stripe-webhook, verify-checkout-session and
// create-checkout-session. The module under test is the ACTUAL edge-function
// code (supabase/functions/_shared/activateCore.mjs), imported directly — not
// a copy — so these tests fail the moment the deployed logic drifts.
//
// Deno tests were deliberately not adopted: `npm test` is the only gate this
// repo runs, and a second toolchain it never executes would be
// untested-by-default code.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_SUB_STATUSES,
  activationDecision,
  decideCheckoutRoute,
  filterLiveSubscriptions,
  netMonthlyFromSubscription,
  periodEndFromSubscription,
  pickReusableCustomer,
  planFromPriceId,
  subscriptionEventAction,
} from '../../../supabase/functions/_shared/activateCore.mjs';

const usdPrice = (unit, interval = 'month', intervalCount = 1) => ({
  unit_amount: unit,
  currency: 'usd',
  recurring: { interval, interval_count: intervalCount },
});
const sub = (price, { qty = 1, status = 'active', discounts, discount, periodEnd } = {}) => ({
  id: 'sub_x',
  status,
  ...(periodEnd ? { current_period_end: periodEnd } : {}),
  items: { data: [{ price, quantity: qty, ...(periodEnd === 'item' ? { current_period_end: 1780000000 } : {}) }] },
  ...(discounts ? { discounts } : {}),
  ...(discount ? { discount } : {}),
});
const coupon = (c) => ({ coupon: c });

// ── activationDecision: the liveness gate ───────────────────────────────────
test('no subscription refuses activation', () => {
  assert.deepEqual(activationDecision(null), { live: false, reason: 'no_subscription' });
});
test('active and trialing are live', () => {
  assert.equal(activationDecision(sub(usdPrice(2500))).live, true);
  assert.equal(activationDecision(sub(usdPrice(2500), { status: 'trialing' })).live, true);
});
test('a replayed paid session for a canceled sub cannot re-activate', () => {
  // The P0: Checkout Sessions stay payment_status='paid' forever, so an
  // ex-subscriber revisiting /pricing/success must be refused HERE.
  const d = activationDecision(sub(usdPrice(2500), { status: 'canceled' }));
  assert.deepEqual(d, { live: false, reason: 'subscription_not_live:canceled' });
});
test('incomplete (async payment not yet arrived) does not grant paid', () => {
  for (const status of ['incomplete', 'incomplete_expired', 'past_due', 'unpaid', 'paused']) {
    assert.equal(activationDecision(sub(usdPrice(2500), { status })).live, false, status);
  }
});

// ── MRR math ────────────────────────────────────────────────────────────────
test('monthly list price', () => {
  assert.equal(netMonthlyFromSubscription(sub(usdPrice(2500))).monthlyAmountCents, 2500);
});
test('annual normalizes to monthly', () => {
  assert.equal(netMonthlyFromSubscription(sub(usdPrice(24000, 'year'))).monthlyAmountCents, 2000);
});
test('quantity multiplies', () => {
  assert.equal(netMonthlyFromSubscription(sub(usdPrice(2500), { qty: 2 })).monthlyAmountCents, 5000);
});
test('interval_count divides (quarterly)', () => {
  assert.equal(netMonthlyFromSubscription(sub(usdPrice(7500, 'month', 3))).monthlyAmountCents, 2500);
});
test('week and day intervals normalize', () => {
  assert.equal(netMonthlyFromSubscription(sub(usdPrice(700, 'week'))).monthlyAmountCents, 3033);
  assert.equal(netMonthlyFromSubscription(sub(usdPrice(100, 'day'))).monthlyAmountCents, 3042);
});
test('forever percent_off halves; 100%-off comp records $0, not list price', () => {
  const half = sub(usdPrice(2500), { discounts: [coupon({ id: 'c', percent_off: 50, duration: 'forever' })] });
  assert.equal(netMonthlyFromSubscription(half).monthlyAmountCents, 1250);
  const comp = sub(usdPrice(2500), { discounts: [coupon({ id: 'c', percent_off: 100, duration: 'forever' })] });
  assert.equal(netMonthlyFromSubscription(comp).monthlyAmountCents, 0);
});
test('once coupons do not reduce MRR', () => {
  const s = sub(usdPrice(2500), { discounts: [coupon({ id: 'c', amount_off: 500, duration: 'once' })] });
  assert.equal(netMonthlyFromSubscription(s).monthlyAmountCents, 2500);
});
test('annual amount_off is a per-invoice figure, spread over 12 months', () => {
  // A $50-off forever coupon on a $240/yr plan reduces each YEARLY invoice by
  // $50 → net $190/yr ≈ $15.83/mo. Dividing amount_off by 12 is CORRECT.
  const s = sub(usdPrice(24000, 'year'), { discounts: [coupon({ id: 'c', amount_off: 5000, duration: 'forever', currency: 'usd' })] });
  assert.equal(netMonthlyFromSubscription(s).monthlyAmountCents, 1583);
});
test('repeating coupons apply now and record their duration', () => {
  const s = sub(usdPrice(2500), { discounts: [coupon({ id: 'c', percent_off: 50, duration: 'repeating', duration_in_months: 3 })] });
  const r = netMonthlyFromSubscription(s);
  assert.equal(r.monthlyAmountCents, 1250);
  assert.equal(r.discount.duration_in_months, 3);
});
test('unexpanded string discounts are skipped (list price, no record)', () => {
  const s = sub(usdPrice(2500), { discounts: ['di_123'] });
  const r = netMonthlyFromSubscription(s);
  assert.equal(r.monthlyAmountCents, 2500);
  assert.equal(r.discount, null);
});
test('cross-currency amount_off is recorded but never subtracted', () => {
  const s = sub(usdPrice(2500), { discounts: [coupon({ id: 'c', amount_off: 500, duration: 'forever', currency: 'eur' })] });
  const r = netMonthlyFromSubscription(s);
  assert.equal(r.monthlyAmountCents, 2500);
  assert.equal(r.discount.currency_mismatch, 'eur');
});
test('legacy single-discount field still applies', () => {
  const s = sub(usdPrice(2500), { discount: coupon({ id: 'c', percent_off: 20, duration: 'forever' }) });
  assert.equal(netMonthlyFromSubscription(s).monthlyAmountCents, 2000);
});
test('null subscription yields nulls, never a throw', () => {
  assert.deepEqual(netMonthlyFromSubscription(null), { monthlyAmountCents: null, discount: null });
});

// ── periodEndFromSubscription ───────────────────────────────────────────────
test('top-level period end wins; item-level is the ≥2025-09-30 fallback', () => {
  assert.equal(periodEndFromSubscription({ current_period_end: 1780000000 }), new Date(1780000000 * 1000).toISOString());
  assert.equal(
    periodEndFromSubscription({ items: { data: [{ current_period_end: 1780000000 }] } }),
    new Date(1780000000 * 1000).toISOString(),
  );
  assert.equal(periodEndFromSubscription({ items: { data: [{}] } }), null);
  assert.equal(periodEndFromSubscription(null), null);
});

// ── planFromPriceId ─────────────────────────────────────────────────────────
test('plan mapping is env-driven and null-safe', () => {
  const ids = { monthly: 'price_m', annual: 'price_a' };
  assert.equal(planFromPriceId('price_m', ids), 'monthly');
  assert.equal(planFromPriceId('price_a', ids), 'annual');
  assert.equal(planFromPriceId('price_other', ids), null);
  assert.equal(planFromPriceId(undefined, ids), null);
});

// ── checkout-side helpers ───────────────────────────────────────────────────
test('live statuses route to management, not a second checkout', () => {
  assert.deepEqual(LIVE_SUB_STATUSES, ['active', 'trialing', 'past_due', 'unpaid', 'paused']);
  const subs = [{ status: 'active' }, { status: 'canceled' }, { status: 'past_due' }, null];
  assert.equal(filterLiveSubscriptions(subs).length, 2);
});
test('pickReusableCustomer proves ownership', () => {
  const own = { id: 'cus_own', metadata: { supabase_user_id: 'u1' } };
  const foreign = { id: 'cus_foreign', metadata: { supabase_user_id: 'u2' } };
  const unclaimed = { id: 'cus_unclaimed', metadata: {} };
  const dead = { id: 'cus_dead', deleted: true, metadata: {} };
  // exact match preferred even when an unclaimed one lists first
  assert.deepEqual(pickReusableCustomer([unclaimed, own], 'u1'), { customer: own, needsStamp: false });
  // an unclaimed customer is claimable (stamped on reuse)
  assert.deepEqual(pickReusableCustomer([dead, unclaimed], 'u1'), { customer: unclaimed, needsStamp: true });
  // a customer stamped with ANOTHER user's id is never reused — the email
  // changed hands, and sharing it exposes the other account's billing
  assert.equal(pickReusableCustomer([foreign], 'u1'), null);
  assert.equal(pickReusableCustomer([dead], 'u1'), null);
  assert.equal(pickReusableCustomer([], 'u1'), null);
});
test('decideCheckoutRoute: two racing tabs both hit the Stripe-side guard', () => {
  // Tab 2 arrives after tab 1 paid: the mirror is still empty but Stripe
  // already has the live sub — must route to portal, never a second checkout.
  assert.equal(decideCheckoutRoute({ liveSubCount: 1, mirrorStatus: null, tier: 'demo', hasVerifiedCustomer: true }), 'portal');
});
test('decideCheckoutRoute: paid tier without a provable customer dead-ends explicitly', () => {
  assert.equal(decideCheckoutRoute({ liveSubCount: 0, mirrorStatus: null, tier: 'paid', hasVerifiedCustomer: false }), 'already_subscribed');
});
test('decideCheckoutRoute: a demo user with an old canceled sub may re-subscribe', () => {
  assert.equal(decideCheckoutRoute({ liveSubCount: 0, mirrorStatus: 'canceled', tier: 'demo', hasVerifiedCustomer: true }), 'checkout');
});
test('decideCheckoutRoute: mirror active routes to portal', () => {
  assert.equal(decideCheckoutRoute({ liveSubCount: 0, mirrorStatus: 'active', tier: 'demo', hasVerifiedCustomer: true }), 'portal');
});

// ── subscriptionEventAction: one mirror row, many possible subs ────────────
test('first write and same-sub events apply', () => {
  assert.equal(subscriptionEventAction({ kind: 'updated', eventSubId: 'sub_a', storedSubId: null }), 'apply');
  assert.equal(subscriptionEventAction({ kind: 'updated', eventSubId: 'sub_a', storedSubId: 'sub_a', storedStatus: 'active' }), 'apply');
  assert.equal(subscriptionEventAction({ kind: 'deleted', eventSubId: 'sub_a', storedSubId: 'sub_a', storedStatus: 'active' }), 'apply');
});
test('a duplicate sub cannot clobber the live mirror', () => {
  // The A1 scenario: operator Dashboard-cancels duplicate sub_b while the
  // user's real sub_a is live — the deleted(sub_b) must not demote them.
  assert.equal(subscriptionEventAction({ kind: 'deleted', eventSubId: 'sub_b', storedSubId: 'sub_a', storedStatus: 'active' }), 'skip');
  assert.equal(subscriptionEventAction({ kind: 'updated', eventSubId: 'sub_b', storedSubId: 'sub_a', storedStatus: 'active' }), 'skip');
});
test('a fresher sub takes over a terminal mirror (resubscribe)', () => {
  assert.equal(subscriptionEventAction({ kind: 'updated', eventSubId: 'sub_new', storedSubId: 'sub_old', storedStatus: 'canceled' }), 'apply');
  assert.equal(subscriptionEventAction({ kind: 'updated', eventSubId: 'sub_new', storedSubId: 'sub_old', storedStatus: 'incomplete_expired' }), 'apply');
  // ...but a redelivered deleted(old) after the terminal write is a no-op.
  assert.equal(subscriptionEventAction({ kind: 'deleted', eventSubId: 'sub_old2', storedSubId: 'sub_old', storedStatus: 'canceled' }), 'skip');
});
