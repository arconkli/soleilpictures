// trialCore.test.mjs — the Creator trial rule, in one place, three consumers.
//
// Run with: cd boards && node --test src/lib/trialCore.test.mjs
//
// The rule lives in supabase/functions/_shared/trialCore.mjs (the edge
// function decides with it); boards/src/lib/creatorTrial.js is the client
// twin (the modal offers with it); billingCopy.CREATOR_TRIAL_DAYS is the copy
// and docs fact. This file asserts the three agree, and that the edge function
// source actually puts the number on the Stripe session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as core from '../../../supabase/functions/_shared/trialCore.mjs';
import * as twin from './creatorTrial.js';
import { CREATOR_TRIAL_DAYS, CTA, trialNote } from './billingCopy.js';
import { THRESHOLDS } from './upsellEligibility.js';
import { latestDefinition } from './migrationText.mjs';

const here = new URL('.', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, here), 'utf8');

const CASES = [
  // [input, eligible, reason]
  [{ tier: 'demo', cards: 13, cardLimit: 50, trialStartedAt: null }, true, 'body_of_work'],
  [{ tier: 'demo', cards: 13, cardLimit: 100, trialStartedAt: null }, true, 'body_of_work'],
  [{ tier: 'demo', cards: 12, cardLimit: 50, trialStartedAt: null }, false, 'too_early'],
  [{ tier: 'demo', cards: 12, cardLimit: 15, trialStartedAt: null }, true, 'near_cap'],   // 80% of a tiny cap
  [{ tier: 'demo', cards: 40, cardLimit: 50, trialStartedAt: null }, true, 'body_of_work'],
  [{ tier: 'demo', cards: 0, cardLimit: 50, trialStartedAt: null }, false, 'too_early'],
  [{ tier: 'demo', cards: 60, cardLimit: 50, trialStartedAt: '2026-09-01T00:00:00Z' }, false, 'already_trialed'],
  [{ tier: 'paid', cards: 60, cardLimit: 50, trialStartedAt: null }, false, 'not_demo'],
  [{ tier: 'admin', cards: 60, cardLimit: 50, trialStartedAt: null }, false, 'not_demo'],
  [{ tier: null, cards: 60, cardLimit: 50, trialStartedAt: null }, false, 'not_demo'],
  [{ tier: 'demo', cards: NaN, cardLimit: 50, trialStartedAt: null }, false, 'cards_unknown'],
  [{ tier: 'demo', cards: -1, cardLimit: 50, trialStartedAt: null }, false, 'cards_unknown'],
  [{ tier: 'demo', cards: 13, cardLimit: null, trialStartedAt: null }, true, 'body_of_work'], // count alone suffices
  [{ tier: 'demo', cards: 5, cardLimit: null, trialStartedAt: null }, false, 'too_early'],
  [undefined, false, 'not_demo'],
  [null, false, 'not_demo'],
];

test('the rule: demo tier, never trialed, a real body of work or at/near the cap', () => {
  for (const [input, eligible, reason] of CASES) {
    const r = core.creatorTrialEligibility(input);
    assert.equal(r.eligible, eligible, `core eligible for ${JSON.stringify(input)}`);
    assert.equal(r.reason, reason, `core reason for ${JSON.stringify(input)}`);
  }
});

test('the client twin gives identical answers on every case', () => {
  for (const [input] of CASES) {
    assert.deepEqual(twin.creatorTrialEligibility(input), core.creatorTrialEligibility(input),
      `twin agrees for ${JSON.stringify(input)}`);
  }
  assert.equal(twin.TRIAL_MIN_CARDS, core.TRIAL_MIN_CARDS);
  assert.equal(twin.TRIAL_CAP_FRAC, core.TRIAL_CAP_FRAC);
});

test('the trial and the chip agree on what "committed" means', () => {
  assert.equal(core.TRIAL_MIN_CARDS, THRESHOLDS.investedMin,
    'the trial floor is the eligibility floor — an offer should never appear on a chip that has not');
});

test('one number of days, everywhere', () => {
  assert.equal(core.CREATOR_TRIAL_DAYS, CREATOR_TRIAL_DAYS, 'billingCopy and trialCore agree');
  assert.equal(twin.CREATOR_TRIAL_DAYS, CREATOR_TRIAL_DAYS);
  assert.ok(CTA.tryCreator.includes(String(CREATOR_TRIAL_DAYS)), 'the button says the number');
  assert.ok(trialNote('monthly').includes(String(CREATOR_TRIAL_DAYS)), 'the note says the number');
  assert.ok(trialNote('monthly').includes('$25/mo') && trialNote('annual').includes('$240/yr'),
    'the note names the price that follows, per plan');
  assert.match(trialNote('monthly'), /Card required/, 'the note is honest about the card');
});

test('the edge function puts the trial on the Stripe session, card required, and decides server-side', () => {
  const src = read('../../../supabase/functions/create-checkout-session/index.ts');
  assert.match(src, /trial_period_days: CREATOR_TRIAL_DAYS/, 'the day count is the shared constant, not a literal');
  assert.match(src, /payment_method_collection: trial \? "always" : "if_required"/, 'a trial collects a card');
  assert.match(src, /missing_payment_method: "cancel"/, 'a trial with no card on file cancels, never limps');
  assert.match(src, /userClient\.rpc\("get_my_tier"\)/, 'eligibility is read AS THE CALLER');
  assert.match(src, /customerHasTrialed\(subs\.data\)/, 'Stripe is asked whether the customer ever trialed');
  assert.match(src, /error: "trial_not_available"/, 'a refusal has a stable code');
  assert.doesNotMatch(src, /trial_period_days: \d/, 'no typed day count');
});

test('the trial is stamped when it STARTS, on the activation path, never on session creation', () => {
  const act = read('../../../supabase/functions/_shared/activate.ts');
  assert.match(act, /if \(status === "trialing"\)/);
  assert.match(act, /creator_trial_started_at: new Date\(\)\.toISOString\(\)/);
  assert.match(act, /\.is\("creator_trial_started_at", null\)/, 'the first timestamp is kept');
  const cks = read('../../../supabase/functions/create-checkout-session/index.ts');
  assert.doesNotMatch(cks, /creator_trial_started_at:/, 'session creation writes no stamp');
});

test('customerHasTrialed reads Stripe subscriptions, any status', () => {
  assert.equal(core.customerHasTrialed([]), false);
  assert.equal(core.customerHasTrialed(null), false);
  assert.equal(core.customerHasTrialed([{ status: 'active', trial_end: null }]), false);
  assert.equal(core.customerHasTrialed([{ status: 'canceled', trial_end: 1_700_000_000 }]), true);
  assert.equal(core.customerHasTrialed([{ status: 'trialing', trial_start: 1_700_000_000 }]), true);
  assert.equal(core.customerHasTrialed([null, { status: 'active' }]), false);
});

test('the admin trial funnel computes eligibility from the same constants', () => {
  // The deck's "eligible today" number is SQL, not JS, so it cannot import the
  // rule. If these two drift, the dashboard quietly reports a different
  // population than the one the server will actually let start a trial, and
  // nothing else would catch it.
  const fn = latestDefinition('admin_trial_funnel');
  assert.ok(fn, 'admin_trial_funnel must exist in a migration');
  const minCards = /v_min_cards\s+constant\s+int\s*:=\s*(\d+)/.exec(fn.body);
  const capFrac = /v_cap_frac\s+constant\s+numeric\s*:=\s*([0-9.]+)/.exec(fn.body);
  assert.ok(minCards, 'the SQL must declare v_min_cards');
  assert.ok(capFrac, 'the SQL must declare v_cap_frac');
  assert.equal(Number(minCards[1]), core.TRIAL_MIN_CARDS,
    'admin_trial_funnel v_min_cards has drifted from trialCore.TRIAL_MIN_CARDS');
  assert.equal(Number(capFrac[1]), core.TRIAL_CAP_FRAC,
    'admin_trial_funnel v_cap_frac has drifted from trialCore.TRIAL_CAP_FRAC');
  // A trial in flight must never be folded into revenue.
  assert.match(fn.body, /'On trial right now'/);
  assert.match(fn.body, /never counted as revenue/i);
});

test('the conversion funnel counts exposures, not the latched pricing_view', () => {
  // pricing_view is logEventOnce per pageload, so a modal that re-mounts forty
  // times logs one view. Any rate built on it overstates itself. The RPC must
  // use up_exposure_summary as the denominator.
  const fn = latestDefinition('admin_conversion_funnel');
  assert.ok(fn, 'admin_conversion_funnel must exist in a migration');
  assert.match(fn.body, /count\(\*\) filter \(where event = 'up_exposure_summary'\)\s+as exposures/);
  assert.doesNotMatch(fn.body, /as exposures[\s\S]{0,40}pricing_view/);
  // Admin-only, and the guard runs before any data is touched.
  const guardAt = fn.body.indexOf('_require_admin');
  const queryAt = fn.body.indexOf('analytics_events');
  assert.ok(guardAt > 0 && guardAt < queryAt, 'the admin guard must precede the query');
});

test('a trial is one per PERSON: the address is swept, not just the reusable customer', () => {
  // Deleting the account cascades the profile away (taking
  // creator_trial_started_at) and leaves the old Stripe customer stamped with
  // the dead uuid, which pickReusableCustomer then correctly refuses to reuse —
  // so the customer-scoped backstop never even looked at it. Both guards were
  // keyed to state one delete destroys together.
  const src = read('../../../supabase/functions/create-checkout-session/index.ts');
  assert.match(src, /emailCustomers = found\.data\.filter/, 'the address lookup is kept, not discarded');
  assert.match(src, /if \(!customerId \|\| trial\)/, 'and it runs for a trial even when a customer is already known');
  assert.match(src, /for \(const c of emailCustomers\)/, 'every customer on the address is asked');
  assert.match(src, /reason: t\.error \? "tier_unreadable" : everTrialed \? "already_trialed"/);
});

test('the outage fallback can activate a trial, which settles with nothing due', () => {
  // A trial checkout settles payment_status 'no_payment_required', not 'paid'.
  // Rejecting that made verify-checkout-session inert for exactly the checkout
  // that collects no money: with the webhook lost, a trialing customer would
  // sit on the free tier until Stripe charged them a fortnight later.
  const src = read('../../../supabase/functions/verify-checkout-session/index.ts');
  assert.match(src, /session\.payment_status === "no_payment_required"/);
  assert.match(src, /const settled = session\.payment_status === "paid"/);
  assert.match(src, /if \(!settled \|\| session\.status !== "complete"\)/);
});

test('money is money: a trialing subscription is not revenue', () => {
  // admin_stats and capture_metrics_daily both summed ('active','trialing'),
  // and metrics_daily is a snapshot table that is never backfilled — a wrong
  // row is wrong forever.
  const stats = latestDefinition('admin_stats');
  assert.ok(stats, 'admin_stats must exist in a migration');
  const mrr = /'mrr_cents',[\s\S]*?from public\.subscriptions\s+where status ([^\n]*)/.exec(stats.body);
  assert.ok(mrr, 'admin_stats must compute mrr_cents from subscriptions');
  assert.match(mrr[1], /= 'active'/, "admin_stats MRR must be 'active' only");
  assert.doesNotMatch(mrr[1], /trialing/, 'a trial is not revenue');
  assert.match(stats.body, /'trialing_subs'/, 'but a live trial stays visible beside it');

  const daily = latestDefinition('capture_metrics_daily');
  assert.ok(daily, 'capture_metrics_daily must exist in a migration');
  assert.match(daily.body, /from public\.subscriptions where status = 'active'/);
  assert.doesNotMatch(daily.body, /status in \('active', 'trialing'\)/);
});

test('first_paid_at means money, and the referral reward survives a trial', () => {
  // The reward chokepoint was AFTER INSERT gated on status 'active'. A trial
  // INSERTs as 'trialing' and converts by UPDATE, so a referred friend who came
  // through the trial paid their referrer nothing.
  const fn = latestDefinition('_stamp_first_paid');
  assert.ok(fn, '_stamp_first_paid must exist in a migration');
  assert.match(fn.body, /new\.status = 'active'/, 'the stamp requires a cleared charge');
  assert.match(fn.body, /tg_op = 'INSERT' or old\.status is distinct from 'active'/,
    'and the reward is edge-triggered on the transition into active');
  const mig = read('../../../supabase/migrations/0327_trial_aware_money.sql');
  assert.match(mig, /after insert or update of status on public\.subscriptions/,
    'the trigger has to see the trial -> active UPDATE');
});
