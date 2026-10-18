// storageAddon.test.mjs — the extra-storage purchase rules, from the ACTUAL
// edge-function core (supabase/functions/_shared/storageAddonCore.mjs), and
// the lockstep between what the server sells and what the copy says.
//
// The function itself only fetches and writes; every decision that moves
// money or a drive is a pure function tested here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STORAGE_ADDON_UNIT_AMOUNT,
  addonItems,
  addonRefusal,
  idempotencyKey,
  parseTarget,
  previewDiscounted,
  priceMatches,
  prorationAmount,
  prorationDateOk,
  storagePriceIdFor,
} from '../../../supabase/functions/_shared/storageAddonCore.mjs';
import {
  STORAGE_ADDON_BLOCK_LABEL,
  STORAGE_ADDON_HELD,
  STORAGE_ADDON_MAX_BLOCKS,
  STORAGE_ADDON_PRICING,
  PRICING_FAQ,
  storageAddonCopy,
} from './billingCopy.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const CFG = {
  creatorProduct: 'prod_creator',
  storageProduct: 'prod_storage',
  creatorPrices: { monthly: 'price_m', annual: 'price_a' },
  storagePrices: { monthly: 'price_sm', annual: 'price_sa' },
};
const creatorItem = (interval = 'month') => ({
  id: 'si_c',
  quantity: 1,
  price: { id: interval === 'year' ? 'price_a' : 'price_m', product: 'prod_creator', currency: 'usd',
    unit_amount: interval === 'year' ? 24000 : 2500, recurring: { interval, interval_count: 1 } },
});
const storageItem = (qty, interval = 'month') => ({
  id: 'si_s',
  quantity: qty,
  price: { id: interval === 'year' ? 'price_sa' : 'price_sm', product: 'prod_storage', currency: 'usd',
    unit_amount: STORAGE_ADDON_UNIT_AMOUNT[interval], recurring: { interval, interval_count: 1 } },
});
const storagePrice = (over = {}) => ({
  id: 'price_sm', active: true, product: 'prod_storage', currency: 'usd', unit_amount: 2500,
  recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, ...over,
});
const activeSub = ({ blocks = 0, interval = 'month', extra = {} } = {}) => ({
  id: 'sub_1',
  status: 'active',
  customer: 'cus_1',
  items: { data: [...(blocks ? [storageItem(blocks, interval)] : []), creatorItem(interval)] },
  latest_invoice: { status: 'paid' },
  ...extra,
});
const ok = (over = {}) => ({
  configured: true,
  profile: { tier: 'paid', storage_quota_bytes: null },
  grantActive: false,
  mirror: { stripe_subscription_id: 'sub_1' },
  sub: activeSub(),
  cfg: CFG,
  target: 1,
  current: 0,
  maxBlocks: 10,
  usedBytes: 0,
  quotaIfBytes: null,
  price: storagePrice(),
  ...over,
});

// ── What is sold, and what the copy says is sold ────────────────────────────
test('the server sells at exactly the prices the copy states', () => {
  assert.equal(STORAGE_ADDON_UNIT_AMOUNT.month, STORAGE_ADDON_PRICING.monthly.billed * 100);
  assert.equal(STORAGE_ADDON_UNIT_AMOUNT.year, STORAGE_ADDON_PRICING.annual.billed * 100);
  assert.match(STORAGE_ADDON_PRICING.monthly.perLabel, new RegExp(`^\\$${STORAGE_ADDON_PRICING.monthly.billed}/month$`));
  assert.match(STORAGE_ADDON_PRICING.annual.perLabel, new RegExp(`^\\$${STORAGE_ADDON_PRICING.annual.billed}/year$`));
  assert.equal(STORAGE_ADDON_BLOCK_LABEL, '1TB', 'gen-docs pins this label to 0415; a change here is a pricing change');
  assert.equal(STORAGE_ADDON_MAX_BLOCKS, 10);
});

test('extra storage is offered, and the docs that describe it ship with it', () => {
  // The hold lifted (2026-10-18) in the commit that shipped the docs
  // (CLAUDE.md: a public surface changes its docs in the same commit). Every
  // figure reaches the page through a fact, never typed, so a price or block
  // change cannot leave the docs behind.
  assert.equal(STORAGE_ADDON_HELD, false);
  const plans = readFileSync(join(HERE, '../../content/docs/account/plans.md'), 'utf8');
  assert.match(plans, /^## More storage$/m, 'account/plans.md has the section the app links to');
  for (const fact of ['storageAddonSize', 'storageAddonMonthly', 'storageAddonAnnual', 'storageAddonMax']) {
    assert.match(plans, new RegExp(`\\{\\{fact:${fact}\\}\\}`), `account/plans.md states ${fact} through its fact`);
  }
  assert.doesNotMatch(plans, /\$25\/month|\$240\/year/, 'no add-on price is typed into the docs');
  const faq = PRICING_FAQ.find((f) => /more storage/i.test(f.q));
  assert.ok(faq, 'the pricing FAQ answers "can I get more storage?"');
  assert.ok(faq.a.includes(STORAGE_ADDON_PRICING.monthly.perLabel) && faq.a.includes(STORAGE_ADDON_PRICING.annual.perLabel),
    'with both prices, from the same constants the sheet uses');
});

test('the sheet states Stripe\'s amount, never one of its own', () => {
  const add = storageAddonCopy({ interval: 'month', amountToday: 1840 });
  assert.match(add.body, /^\$18\.40 today for the rest of this month, then \$25\/month/);
  assert.match(add.cta, /^Add 1TB — \$25\/month$/);
  const yearly = storageAddonCopy({ interval: 'year', amountToday: 19800 });
  assert.match(yearly.body, /^\$198 today for the rest of this year, then \$240\/year/);
  const remove = storageAddonCopy({ interval: 'month', creditNext: 1250, removing: true });
  assert.match(remove.body, /\(\$12\.50\)/);
  assert.match(remove.cta, /^Remove 1TB$/);
});

// ── The price ───────────────────────────────────────────────────────────────
test('the storage price follows the plan\'s interval', () => {
  assert.equal(storagePriceIdFor(creatorItem('month'), CFG), 'price_sm');
  assert.equal(storagePriceIdFor(creatorItem('year'), CFG), 'price_sa');
  const quarterly = creatorItem('month');
  quarterly.price.recurring.interval_count = 3;
  assert.equal(storagePriceIdFor(quarterly, CFG), null);
  assert.equal(storagePriceIdFor(null, CFG), null);
});

test('a Stripe price that does not say what we sell is refused', () => {
  const c = creatorItem('month');
  assert.equal(priceMatches(storagePrice(), c, CFG), true);
  for (const [why, p] of [
    ['inactive', storagePrice({ active: false })],
    ['another product', storagePrice({ product: 'prod_other' })],
    ['another amount', storagePrice({ unit_amount: 2000 })],
    ['another currency', storagePrice({ currency: 'eur' })],
    ['another interval', storagePrice({ recurring: { interval: 'year', interval_count: 1 } })],
    ['metered', storagePrice({ recurring: { interval: 'month', interval_count: 1, usage_type: 'metered' } })],
    ['missing', null],
  ]) {
    assert.equal(priceMatches(p, c, CFG), false, why);
  }
  assert.equal(priceMatches(storagePrice(), c, { ...CFG, storageProduct: null }), false, 'no product configured, nothing sold');
});

// ── Who may buy ─────────────────────────────────────────────────────────────
test('a clean increase and a clean removal are allowed', () => {
  assert.equal(addonRefusal(ok()), null);
  assert.equal(addonRefusal(ok({ sub: activeSub({ blocks: 2 }), current: 2, target: 1, usedBytes: 100, quotaIfBytes: 1000 })), null);
});

test('refusals come in order, most fundamental first', () => {
  const cases = [
    ['not_configured', { configured: false }],
    ['quota_override', { profile: { tier: 'paid', storage_quota_bytes: 123 } }],
    ['no_subscription', { profile: { tier: 'demo', storage_quota_bytes: null } }],
    ['no_subscription', { mirror: null, sub: null }],
    ['contact_support', { mirror: null, sub: null, grantActive: true }],
    ['trial_active', { sub: { ...activeSub(), status: 'trialing' } }],
    ['past_due', { sub: { ...activeSub(), status: 'past_due' } }],
    ['past_due', { sub: { ...activeSub(), latest_invoice: { status: 'open' } } }],
    ['not_active', { sub: { ...activeSub(), status: 'incomplete' } }],
    ['schedule_attached', { sub: { ...activeSub(), schedule: 'sub_sched_1' } }],
    ['cancel_pending', { sub: { ...activeSub(), cancel_at_period_end: true } }],
    ['payment_pending', { sub: { ...activeSub(), pending_update: { expires_at: 1 } } }],
    // A 3D Secure add leaves its proration invoice open: still "finish the
    // payment", never "your payment failed".
    ['payment_pending', { sub: { ...activeSub(), pending_update: { expires_at: 1 }, latest_invoice: { status: 'open' } } }],
    ['bad_request', { target: null }],
    ['price_mismatch', { price: storagePrice({ unit_amount: 1 }) }],
    ['discounted_subscription', { sub: { ...activeSub(), discounts: ['di_1'] } }],
  ];
  for (const [code, over] of cases) {
    assert.equal(addonRefusal(ok(over))?.code, code, code);
  }
});

test('a removal that would strand stored files is refused', () => {
  const r = addonRefusal(ok({ sub: activeSub({ blocks: 2 }), current: 2, target: 1, usedBytes: 2000, quotaIfBytes: 1000 }));
  assert.deepEqual(r, { code: 'over_usage', used_bytes: 2000, quota_bytes: 1000 });
});

test('removing is never priced, so a mismatched price does not block it', () => {
  // A removal must work even if the price was edited in Stripe — the owner's
  // mistake must not trap a customer into paying.
  assert.equal(addonRefusal(ok({ sub: activeSub({ blocks: 1 }), current: 1, target: 0, quotaIfBytes: 10, price: null })), null);
});

test('two storage items on one subscription is a support case, not a guess', () => {
  const sub = activeSub({ blocks: 1 });
  sub.items.data.push(storageItem(2, 'month'));
  assert.equal(addonRefusal(ok({ sub, current: 3, target: 4 }))?.code, 'contact_support');
});

test('the requested total is a whole number inside the limit', () => {
  for (const [raw, want] of [[0, 0], [1, 1], [10, 10], [11, null], [-1, null], [1.5, null], ['2', null], [null, null], [undefined, null]]) {
    assert.equal(parseTarget(raw, 10), want, String(raw));
  }
});

// ── The update ──────────────────────────────────────────────────────────────
test('the update sets a total: add an item, change its quantity, or remove it', () => {
  assert.deepEqual(addonItems({ storageItem: null, priceId: 'price_sm', target: 2 }), [{ price: 'price_sm', quantity: 2 }]);
  assert.deepEqual(addonItems({ storageItem: { id: 'si_s' }, priceId: 'price_sm', target: 3 }), [{ id: 'si_s', quantity: 3 }]);
  assert.deepEqual(addonItems({ storageItem: { id: 'si_s' }, priceId: 'price_sm', target: 0 }), [{ id: 'si_s', deleted: true }]);
});

test('the amount is the proration lines of the preview, in either API shape', () => {
  const inv = { lines: { data: [
    { amount: 1840, proration: true },
    { amount: -300, parent: { subscription_item_details: { proration: true } } },
    { amount: 2500, proration: false },
  ] } };
  assert.equal(prorationAmount(inv), 1540);
  assert.equal(prorationAmount(null), 0);
});

test('a discount anywhere on the preview refuses an increase', () => {
  assert.equal(previewDiscounted({ total_discount_amounts: [{ amount: 0 }] }), false);
  assert.equal(previewDiscounted({ total_discount_amounts: [{ amount: 500 }] }), true);
  assert.equal(previewDiscounted({}), false);
});

test('the apply reuses a fresh preview\'s proration date, never an old one', () => {
  const now = 1_800_000_000;
  assert.equal(prorationDateOk(now - 60, now), true);
  assert.equal(prorationDateOk(now - 16 * 60, now), false, 'stale preview');
  assert.equal(prorationDateOk(now + 3600, now), false, 'from the future');
  assert.equal(prorationDateOk(1.5, now), false);
});

test('one idempotency key per click, and only for a real request id', () => {
  const id = '3f1c2a9e-5b7d-4e2f-9a1b-0c3d4e5f6a7b';
  assert.equal(idempotencyKey('user-1', id), `addon:user-1:${id}`);
  assert.equal(idempotencyKey('user-1', id.toUpperCase()), `addon:user-1:${id}`, 'case does not make a second key');
  assert.equal(idempotencyKey('user-1', 'not-a-uuid'), null);
  assert.equal(idempotencyKey('user-1', undefined), null);
});
