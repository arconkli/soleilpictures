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
