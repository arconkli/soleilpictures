// teamBillingCore.test.mjs — the Team plan's billing rules (S3). The module
// under test is the ACTUAL edge-function code
// (supabase/functions/_shared/teamBillingCore.mjs), imported directly, as
// activateCore.test.mjs does for the personal plan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEAM_MIN_SEATS,
  TEAM_SEAT_UNIT_AMOUNT,
  TEAM_TRIAL_DAYS,
  TRIM_WINDOW_MS,
  isTeamObject,
  reusableTeamCustomer,
  seatAddKey,
  seatPreviewParams,
  seatSyncKey,
  seatSyncPlan,
  canSyncSeats,
  teamCheckoutParams,
  teamCustomerParams,
  teamItems,
  teamMirrorFields,
  teamPlanFromSubscription,
  teamPortalConfiguration,
  teamPriceIdFor,
  teamPriceMatches,
  trialEndingSoon,
  trimDue,
} from '../../../supabase/functions/_shared/teamBillingCore.mjs';
import { pickReusableCustomer } from '../../../supabase/functions/_shared/activateCore.mjs';
import { TEAM_SEAT_PRICE } from './teamModel.js';

const CFG = {
  creatorProduct: 'prod_creator',
  storageProduct: 'prod_storage',
  teamProduct: 'prod_team',
  creatorPrices: { monthly: 'price_m', annual: 'price_a' },
  storagePrices: { monthly: 'price_sm', annual: 'price_sa' },
  teamPrices: { monthly: 'price_tm', annual: 'price_ta' },
};
const item = (id, product, unit, { qty = 1, interval = 'month' } = {}) => ({
  id: `si_${id}`,
  quantity: qty,
  price: { id, product, unit_amount: unit, currency: 'usd', recurring: { interval, interval_count: 1 } },
});
const teamSub = ({ status = 'active', seats = 5, blocks = 0, extra = {} } = {}) => ({
  id: 'sub_team',
  customer: 'cus_team',
  status,
  metadata: { soleil_kind: 'team' },
  current_period_end: 1_800_000_000,
  items: {
    data: [
      ...(blocks ? [item('price_sm', 'prod_storage', 2500, { qty: blocks })] : []),
      item('price_tm', 'prod_team', 1500, { qty: seats }),
    ],
  },
  ...extra,
});

test('the seat price the code checks is the price the page shows', () => {
  assert.equal(TEAM_SEAT_UNIT_AMOUNT.month, TEAM_SEAT_PRICE.month * 100);
  assert.equal(TEAM_SEAT_UNIT_AMOUNT.year, TEAM_SEAT_PRICE.year * 100);
  assert.equal(TEAM_MIN_SEATS, 3);
  assert.equal(TEAM_TRIAL_DAYS, 14);
});

test('teamPriceMatches refuses a price that would charge what the page did not show', () => {
  const ok = { active: true, currency: 'usd', unit_amount: 1500, billing_scheme: 'per_unit', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } };
  assert.equal(teamPriceMatches(ok, 'monthly'), true);
  assert.equal(teamPriceMatches({ ...ok, unit_amount: 1600 }, 'monthly'), false, 'edited in the dashboard');
  assert.equal(teamPriceMatches(ok, 'annual'), false, 'a monthly price is not the annual one');
  assert.equal(teamPriceMatches({ ...ok, active: false }, 'monthly'), false);
  assert.equal(teamPriceMatches({ ...ok, billing_scheme: 'tiered' }, 'monthly'), false);
  assert.equal(teamPriceMatches({ ...ok, recurring: { ...ok.recurring, usage_type: 'metered' } }, 'monthly'), false);
  assert.equal(teamPriceMatches({ ...ok, unit_amount: 14400, recurring: { interval: 'year', interval_count: 1 } }, 'annual'), true);
  assert.equal(teamPriceMatches(ok, 'weekly'), false);
  assert.equal(teamPriceIdFor('monthly', CFG), 'price_tm');
  assert.equal(teamPriceIdFor('annual', CFG), 'price_ta');
  assert.equal(teamPriceIdFor('monthly', {}), null, 'no price ids: the hold');
});

test('teamItems finds the seat and the storage blocks whatever their order', () => {
  const r = teamItems(teamSub({ seats: 7, blocks: 2 }), CFG);
  assert.equal(r.seat.price.id, 'price_tm');
  assert.equal(r.seatsBilled, 7);
  assert.equal(r.storageBlocks, 2);
  // A seat price changed in Stripe ahead of the secrets still counts as the seat.
  const odd = { items: { data: [item('price_new', 'prod_other', 1700, { qty: 4 })] } };
  assert.equal(teamItems(odd, CFG).seatsBilled, 4);
  assert.equal(teamPlanFromSubscription(odd, CFG), 'monthly', 'falls back to the interval');
  assert.equal(teamItems(null, CFG).seat, null);
});

test('teamMirrorFields is the whole Stripe half of a mirror row', () => {
  const s = teamSub({ status: 'trialing', seats: 4, blocks: 1, extra: { trial_end: 1_800_000_000, cancel_at_period_end: true } });
  assert.deepEqual(teamMirrorFields(s, CFG), {
    stripe_customer_id: 'cus_team',
    stripe_subscription_id: 'sub_team',
    plan: 'monthly',
    status: 'trialing',
    seats_billed: 4,
    storage_blocks: 1,
    current_period_end: new Date(1_800_000_000 * 1000).toISOString(),
    cancel_at_period_end: true,
    trial_end: new Date(1_800_000_000 * 1000).toISOString(),
  });
  assert.equal(teamMirrorFields({ ...s, customer: { id: 'cus_x' }, trial_end: null }, CFG).stripe_customer_id, 'cus_x');
  assert.equal(teamMirrorFields({ ...s, trial_end: null }, CFG).trial_end, null);
});

test('seatSyncPlan: the database owns the seats and Stripe follows', () => {
  assert.deepEqual(seatSyncPlan({ desired: 6, billed: 5, status: 'active' }), { action: 'update', quantity: 6, proration: 'always_invoice' });
  assert.deepEqual(seatSyncPlan({ desired: 6, billed: 5, status: 'trialing' }), { action: 'update', quantity: 6, proration: 'none' },
    'a trial is synced too, with no proration: the first invoice bills the seats it ends with');
  assert.deepEqual(seatSyncPlan({ desired: 6, billed: 5, status: 'past_due' }), { action: 'update', quantity: 6, proration: 'always_invoice' });
  assert.deepEqual(seatSyncPlan({ desired: 4, billed: 6, status: 'active' }), { action: 'update', quantity: 4, proration: 'none' },
    'going down credits nothing');
  assert.deepEqual(seatSyncPlan({ desired: 5, billed: 5, status: 'active' }), { action: 'none' });
  assert.deepEqual(seatSyncPlan({ desired: 2, billed: 5, status: 'active' }), { action: 'none' }, 'never under 3');
  for (const status of ['canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused', null]) {
    assert.deepEqual(seatSyncPlan({ desired: 6, billed: 5, status }), { action: 'none' }, status);
    assert.equal(canSyncSeats(status), false, status);
  }
  for (const status of ['active', 'trialing', 'past_due']) assert.equal(canSyncSeats(status), true, status);
});

test('seatSyncPlan: a closed team stops paying at once', () => {
  for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'paused']) {
    assert.deepEqual(seatSyncPlan({ desired: 5, billed: 5, status, closed: true }), { action: 'cancel' }, status);
  }
  assert.deepEqual(seatSyncPlan({ desired: 5, billed: 5, status: 'canceled', closed: true }), { action: 'none' });
  assert.deepEqual(seatSyncPlan({ desired: 5, billed: 5, status: null, closed: true }), { action: 'none' });
});

test('trimDue: unused seats drop just before a renewal, never during a trial', () => {
  const now = 1_800_000_000_000;
  const soon = new Date(now + TRIM_WINDOW_MS - 60_000).toISOString();
  assert.equal(trimDue({ status: 'active', cancelAtPeriodEnd: false, periodEnd: soon, now }), true);
  assert.equal(trimDue({ status: 'active', cancelAtPeriodEnd: false, periodEnd: new Date(now + TRIM_WINDOW_MS + 60_000).toISOString(), now }), false);
  assert.equal(trimDue({ status: 'trialing', cancelAtPeriodEnd: false, periodEnd: soon, now }), false, 'a trial converts with the seats its buyer chose');
  assert.equal(trimDue({ status: 'active', cancelAtPeriodEnd: true, periodEnd: soon, now }), false, 'nothing renews');
  assert.equal(trimDue({ status: 'active', cancelAtPeriodEnd: false, periodEnd: new Date(now - 1000).toISOString(), now }), false);
  assert.equal(trimDue({ status: 'active', cancelAtPeriodEnd: false, periodEnd: null, now }), false);
});

test('trialEndingSoon: the last three days of a trial', () => {
  const now = 1_800_000_000_000;
  assert.equal(trialEndingSoon({ status: 'trialing', trialEnd: new Date(now + 2 * 86_400_000).toISOString(), now }), true);
  assert.equal(trialEndingSoon({ status: 'trialing', trialEnd: new Date(now + 5 * 86_400_000).toISOString(), now }), false);
  assert.equal(trialEndingSoon({ status: 'active', trialEnd: new Date(now + 86_400_000).toISOString(), now }), false);
});

test('teamCheckoutParams: a card always, the trial only when offered, the team stamped everywhere', () => {
  const p = teamCheckoutParams({
    customerId: 'cus_t', priceId: 'price_tm', seats: 5, trial: true, checkoutId: 'chk', ownerId: 'u1',
    successUrl: 'https://x/team?checkout=done', cancelUrl: 'https://x/team?checkout=canceled', nowMs: 1_800_000_000_000,
  });
  assert.equal(p.mode, 'subscription');
  assert.deepEqual(p.line_items, [{ price: 'price_tm', quantity: 5 }]);
  assert.equal(p.payment_method_collection, 'always');
  assert.equal(p.subscription_data.trial_period_days, 14);
  assert.equal(p.subscription_data.trial_settings.end_behavior.missing_payment_method, 'cancel');
  assert.equal(p.expires_at, 1_800_000_000 + 3600);
  assert.equal(isTeamObject(p), true, 'the session');
  assert.equal(isTeamObject(p.subscription_data), true, 'the subscription');
  assert.equal(p.metadata.soleil_team_checkout, 'chk');
  assert.equal('client_reference_id' in p, false, 'the webhook log reads that as a person');
  assert.equal('allow_promotion_codes' in p, false);
  assert.equal('supabase_user_id' in p.metadata, false);
  const again = teamCheckoutParams({ customerId: 'c', priceId: 'p', seats: 3, trial: false, checkoutId: 'k', ownerId: 'u', orgId: 'o', successUrl: 's', cancelUrl: 'c' });
  assert.equal(again.subscription_data.trial_period_days, undefined, 'paying again: no second trial');
  assert.equal(again.metadata.soleil_org_id, 'o');
});

test('a team customer is never a person\'s, and is reused only by its own owner', () => {
  const c = { id: 'cus_t', ...teamCustomerParams({ name: 'Studio', email: 'a@example.com', ownerId: 'u1', checkoutId: 'k' }) };
  assert.equal(isTeamObject(c), true);
  assert.equal(c.metadata.supabase_user_id, undefined);
  assert.equal(pickReusableCustomer([c], 'u1'), null, 'the Creator checkout skips it');
  assert.equal(reusableTeamCustomer(c, 'u1'), true);
  assert.equal(reusableTeamCustomer(c, 'u2'), false);
  assert.equal(reusableTeamCustomer({ ...c, deleted: true }, 'u1'), false);
  assert.equal(reusableTeamCustomer({ id: 'cus_p', metadata: { supabase_user_id: 'u1' } }, 'u1'), false);
});

test('the team portal changes no seats and no plan', () => {
  const p = teamPortalConfiguration('https://x/team');
  assert.equal(p.features.subscription_update.enabled, false);
  assert.equal(p.features.subscription_cancel.mode, 'at_period_end');
  assert.equal(p.features.payment_method_update.enabled, true);
  assert.equal(p.features.invoice_history.enabled, true);
  assert.equal(p.default_return_url, 'https://x/team');
  assert.ok(p.metadata.soleil, 'found again by its tag');
});

test('a seat preview prices the change the apply makes', () => {
  assert.deepEqual(
    seatPreviewParams({ customerId: 'c', subscriptionId: 's', seatItemId: 'si', quantity: 6, prorationDate: 1700000000 }),
    { customer: 'c', subscription: 's', subscription_details: { items: [{ id: 'si', quantity: 6 }], proration_behavior: 'always_invoice', proration_date: 1700000000 } },
  );
});

test('idempotency keys: a sync converges, a click is its own request', () => {
  assert.equal(seatSyncKey('o', 12, 6), 'team-seats:o:12:6');
  assert.equal(seatSyncKey('o', null, 6), 'team-seats:o:0:6');
  assert.equal(seatAddKey('o', 'not-a-uuid'), null);
  assert.equal(seatAddKey('o', 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'), 'team-seats-add:o:a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
});
