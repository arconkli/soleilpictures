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
  PAST_DUE_GRACE_DAYS,
  activationDecision,
  decideCheckoutRoute,
  entitlementFromSubscription,
  filterLiveSubscriptions,
  mirrorFieldsFromSubscription,
  netMonthlyFromSubscription,
  periodEndFromSubscription,
  pickReusableCustomer,
  planFromPriceId,
  planFromSubscription,
  promoCodesAllowedForPlan,
  shouldDemote,
  subscriptionEventAction,
  subscriptionItems,
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
  const r = netMonthlyFromSubscription(s);
  assert.equal(r.monthlyAmountCents, 2500);
  assert.equal(r.discount.amount_off, 500);   // recorded, just not subtracted
});
test('a once coupon is RECORDED even though it does not move MRR', () => {
  const s = sub(usdPrice(2500), { discounts: [coupon({ id: 'c_first', percent_off: 50, duration: 'once' })] });
  const r = netMonthlyFromSubscription(s);
  assert.equal(r.monthlyAmountCents, 2500);          // MRR untouched — correct
  assert.equal(r.discount.coupon, 'c_first');        // but the redemption is visible
  assert.equal(r.discount.percent_off, 50);
  assert.equal(r.discount.duration, 'once');
  assert.equal(r.discount.applies_to, 'first_invoice');
});
test('a recurring coupon outranks a once coupon as the primary record', () => {
  const s = sub(usdPrice(2500), {
    discounts: [
      coupon({ id: 'c_first', percent_off: 50, duration: 'once' }),
      coupon({ id: 'c_forever', percent_off: 20, duration: 'forever' }),
    ],
  });
  const r = netMonthlyFromSubscription(s);
  assert.equal(r.monthlyAmountCents, 2000);          // only the forever one applies
  assert.equal(r.discount.coupon, 'c_forever');      // the one that explains MRR wins
  assert.equal(r.discount.applies_to, undefined);
});
test('a once coupon carries its promotion code through', () => {
  const s = sub(usdPrice(2500), {
    discounts: [{ coupon: { id: 'c_first', percent_off: 50, duration: 'once' }, promotion_code: 'promo_abc' }],
  });
  assert.equal(netMonthlyFromSubscription(s).discount.promotion_code, 'promo_abc');
});
test('promo codes are offered on monthly only', () => {
  assert.equal(promoCodesAllowedForPlan('monthly'), true);
  assert.equal(promoCodesAllowedForPlan('annual'), false);
  assert.equal(promoCodesAllowedForPlan(undefined), false);
  assert.equal(promoCodesAllowedForPlan(null), false);
  assert.equal(promoCodesAllowedForPlan('MONTHLY'), false);   // exact match only
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

// ── Two items: Creator + extra storage (2026-10-17) ─────────────────────────
// Every reader used to take items.data[0] as the plan. Stripe promises no item
// order, so each case below puts the storage item FIRST.
const CFG = {
  creatorProduct: 'prod_creator',
  storageProduct: 'prod_storage',
  creatorPrices: { monthly: 'price_m', annual: 'price_a' },
  storagePrices: { monthly: 'price_sm', annual: 'price_sa' },
};
const item = (id, product, unit, { qty = 1, interval = 'month', count = 1 } = {}) => ({
  id: `si_${id}`,
  quantity: qty,
  price: { id, product, unit_amount: unit, currency: 'usd', recurring: { interval, interval_count: count } },
});
const twoItem = ({ status = 'active', blocks = 2, extra = {} } = {}) => ({
  id: 'sub_two',
  status,
  current_period_end: 1780000000,
  items: { data: [item('price_sm', 'prod_storage', 2500, { qty: blocks }), item('price_m', 'prod_creator', 2500)] },
  ...extra,
});

test('with no config, a single item is the plan — every pre-storage subscription', () => {
  const s = sub(usdPrice(2500));
  const r = subscriptionItems(s);
  assert.equal(r.creator, s.items.data[0]);
  assert.equal(r.storageBlocks, 0);
  assert.deepEqual(r.unknown, []);
  assert.equal(activationDecision(s).live, true, 'existing callers that pass no cfg are unchanged');
});

test('the Creator item is found by product even when storage comes first', () => {
  const s = twoItem();
  const r = subscriptionItems(s, CFG);
  assert.equal(r.creator.price.id, 'price_m');
  assert.equal(r.storageBlocks, 2);
  assert.equal(planFromSubscription(s, CFG), 'monthly', 'never the storage price read as an unknown plan');
  assert.equal(activationDecision(s, CFG).live, true);
});

test('storage is recognised by price id when the config names no products', () => {
  const cfg = { creatorPrices: CFG.creatorPrices, storagePrices: CFG.storagePrices };
  const r = subscriptionItems(twoItem({ blocks: 3 }), cfg);
  assert.equal(r.creator.price.id, 'price_m');
  assert.equal(r.storageBlocks, 3);
});

test('a subscription that is only storage is not a plan', () => {
  const s = { id: 'sub_s', status: 'active', items: { data: [item('price_sm', 'prod_storage', 2500, { qty: 1 })] } };
  assert.deepEqual(activationDecision(s, CFG), { live: false, reason: 'no_creator_item' });
  assert.equal(entitlementFromSubscription(s, { cfg: CFG }).entitled, false);
  assert.equal(shouldDemote(s, { cfg: CFG }), true);
});

test('a Creator price the env does not name still counts as the plan, and is reported', () => {
  // The owner changes the Creator price in Stripe before updating the secret:
  // nobody may be demoted for it, and the operator should hear about it.
  const s = { id: 'sub_n', status: 'active', items: { data: [item('price_new', 'prod_other', 3000, { interval: 'year' })] } };
  const r = subscriptionItems(s, CFG);
  assert.equal(r.creator.price.id, 'price_new');
  assert.equal(r.unknown.length, 1);
  assert.equal(planFromSubscription(s, CFG), 'annual', 'falls back to the interval');
  assert.equal(activationDecision(s, CFG).live, true);
});

test('a plan is read off a plain interval only', () => {
  const quarterly = { status: 'active', items: { data: [item('price_q', 'prod_x', 7500, { count: 3 })] } };
  assert.equal(planFromSubscription(quarterly, CFG), null, 'quarterly is not monthly');
  assert.equal(planFromSubscription(null, CFG), null);
});

test('the mirror counts every block and nothing else', () => {
  const s = twoItem({ blocks: 4 });
  s.items.data.push(item('price_sa', 'prod_storage', 24000, { qty: 'junk' }));
  const m = mirrorFieldsFromSubscription(s, CFG);
  assert.equal(m.storage_blocks, 4, 'a junk quantity adds nothing');
  assert.equal(m.plan, 'monthly');
  assert.equal(m.status, 'active');
  assert.equal(m.cancel_at_period_end, false);
  assert.equal(mirrorFieldsFromSubscription(sub(usdPrice(2500)), CFG).storage_blocks, 0);
});

test('MRR counts the storage blocks beside the plan', () => {
  assert.equal(netMonthlyFromSubscription(twoItem({ blocks: 2 })).monthlyAmountCents, 7500);
});

// ── Dunning: one rule for the webhook, the cron and the SQL twin ────────────
const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const pastDue = (inv, extra = {}) => ({ ...twoItem({ status: 'past_due' }), latest_invoice: inv, ...extra });

test('active and trialing are entitled; incomplete is neither entitled nor demoted', () => {
  assert.equal(entitlementFromSubscription(twoItem(), { cfg: CFG }).entitled, true);
  assert.equal(entitlementFromSubscription(twoItem({ status: 'trialing' }), { cfg: CFG }).entitled, true);
  const inc = twoItem({ status: 'incomplete' });
  assert.equal(entitlementFromSubscription(inc, { cfg: CFG }).entitled, false);
  assert.equal(shouldDemote(inc, { cfg: CFG }), false, 'nothing to demote before a first payment');
});

test('past_due keeps the plan while Stripe is still retrying, inside the grace window', () => {
  const retrying = pastDue({ status: 'open', next_payment_attempt: NOW / 1000 + 3600, created: NOW / 1000 - 5 * 86400 });
  assert.deepEqual(entitlementFromSubscription(retrying, { cfg: CFG, now: NOW }), { entitled: true, reason: 'past_due_retrying' });
  assert.equal(shouldDemote(retrying, { cfg: CFG, now: NOW }), false);
});

test('past_due loses the plan once Stripe stops retrying', () => {
  const givenUp = pastDue({ status: 'open', next_payment_attempt: null, created: NOW / 1000 - 5 * 86400 });
  assert.equal(entitlementFromSubscription(givenUp, { cfg: CFG, now: NOW }).reason, 'past_due_not_retrying');
  assert.equal(shouldDemote(givenUp, { cfg: CFG, now: NOW }), true);
  const uncollectible = pastDue({ status: 'uncollectible', next_payment_attempt: null, created: NOW / 1000 });
  assert.equal(shouldDemote(uncollectible, { cfg: CFG, now: NOW }), true);
});

test('past_due loses the plan after the grace window, whatever the retry schedule', () => {
  const late = pastDue({ status: 'open', next_payment_attempt: NOW / 1000 + 3600, created: NOW / 1000 - (PAST_DUE_GRACE_DAYS + 1) * 86400 });
  assert.equal(entitlementFromSubscription(late, { cfg: CFG, now: NOW }).reason, 'past_due_beyond_grace');
  assert.equal(shouldDemote(late, { cfg: CFG, now: NOW }), true);
});

test('an unexpanded latest_invoice falls back to the period start for the grace window', () => {
  const fresh = pastDue('in_123', { current_period_start: (NOW - 2 * DAY) / 1000 });
  assert.equal(entitlementFromSubscription(fresh, { cfg: CFG, now: NOW }).entitled, true);
  const stale = pastDue('in_123', { current_period_start: (NOW - 30 * DAY) / 1000 });
  assert.equal(entitlementFromSubscription(stale, { cfg: CFG, now: NOW }).entitled, false);
});

test('unpaid, paused, canceled and incomplete_expired demote', () => {
  for (const status of ['unpaid', 'paused', 'canceled', 'incomplete_expired']) {
    assert.equal(shouldDemote(twoItem({ status }), { cfg: CFG }), true, status);
  }
  assert.equal(shouldDemote(null), false);
});

