// creatorIntent.test.mjs — the "Get Creator" click survives sign-in, and nothing
// else does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  stashCreatorIntent, readCreatorIntent, clearCreatorIntent, isFreeStartCta,
  CREATOR_INTENT_KEY, CREATOR_INTENT_MAX_AGE_MS,
} from './creatorIntent.js';
import { claimUpsellSlot, __resetUpsellSlot } from './upsellSlot.js';
import { creatorIntentLabels, PLAN_NAME, PRICING } from './billingCopy.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8');

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    raw: m,
  };
}

test('a stashed intent reads back with its plan and age', () => {
  const s = memoryStorage();
  assert.equal(stashCreatorIntent({ plan: 'annual', now: 1_000 }, s), true);
  const got = readCreatorIntent({ now: 61_000 }, s);
  assert.deepEqual(got, { plan: 'annual', from: 'public_pricing', ageMs: 60_000, planName: null, priceLabel: null });
});

test('an unknown plan is stored as monthly, the page default', () => {
  const s = memoryStorage();
  stashCreatorIntent({ plan: 'lifetime', now: 0 }, s);
  assert.equal(readCreatorIntent({ now: 1 }, s).plan, 'monthly');
});

test('an expired intent is gone, and removed on read', () => {
  const s = memoryStorage();
  stashCreatorIntent({ plan: 'monthly', now: 0 }, s);
  assert.equal(readCreatorIntent({ now: CREATOR_INTENT_MAX_AGE_MS + 1 }, s), null);
  assert.equal(s.raw.has(CREATOR_INTENT_KEY), false, 'an expired entry must not linger');
});

test('garbage, a missing timestamp and a future timestamp all read as nothing', () => {
  for (const raw of ['not json', '{"plan":"monthly"}', '{"plan":"monthly","at":null}', '{"plan":"x","at":1}']) {
    const s = memoryStorage();
    s.setItem(CREATOR_INTENT_KEY, raw);
    assert.equal(readCreatorIntent({ now: 10 }, s), null, raw);
    assert.equal(s.raw.has(CREATOR_INTENT_KEY), false, `malformed ${raw} must be cleared`);
  }
  const s = memoryStorage();
  stashCreatorIntent({ plan: 'monthly', now: 1_000 }, s);
  assert.equal(readCreatorIntent({ now: 10 }, s), null, 'a clock that went backwards is not a fresh intent');
});

test('storage that throws never breaks the page', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  assert.equal(stashCreatorIntent({ plan: 'monthly' }, broken), false);
  assert.equal(readCreatorIntent({}, broken), null);
  assert.doesNotThrow(() => clearCreatorIntent(broken));
});

test('clear removes it', () => {
  const s = memoryStorage();
  stashCreatorIntent({ plan: 'monthly', now: 0 }, s);
  clearCreatorIntent(s);
  assert.equal(readCreatorIntent({ now: 1 }, s), null);
});

// ── Wiring ──────────────────────────────────────────────────────────────────

test('the public Get Creator button writes the intent BEFORE it navigates away', () => {
  const page = read('auth/PublicPricingPage.jsx');
  const stash = page.indexOf('stashCreatorIntent(');
  const nav = page.indexOf("window.location.assign('/')");
  assert.ok(stash > 0, 'PublicPricingPage no longer stashes the Creator intent');
  assert.ok(nav > 0 && stash < nav, 'the intent must be written before the page leaves');
});

test('the app claims the slot before it opens the resumed offer', () => {
  const hook = read('hooks/useCreatorIntentResume.js');
  const claim = hook.indexOf("claimUpsellSlot('pricing-intent')");
  const open = hook.indexOf('resumeRef.current(intent.plan)');
  assert.ok(claim > 0 && open > 0 && claim < open,
    'an offer opened without claiming the slot is the 16 ms cap-wall bug: ambient surfaces have nothing to defer to');
  // A claim, not a regex: upsellSlot.js names 'pricing-intent' in its comments,
  // so a source match passed even with the kind deleted from KINDS — and an
  // unknown kind fails CLOSED, which would silently stop every resumed offer.
  __resetUpsellSlot();
  assert.equal(claimUpsellSlot('pricing-intent', 1_000_000, null), true, "upsellSlot no longer knows the 'pricing-intent' kind");
  __resetUpsellSlot();
  const app = read('App.jsx');
  assert.match(app, /useCreatorIntentResume\(/, 'App no longer resumes a stashed Creator intent');
});

test('the intent carries the plan name and price the sign-in screen shows', () => {
  const s = memoryStorage();
  stashCreatorIntent({ plan: 'annual', now: 0, planName: 'Creator', priceLabel: '$20/mo billed annually' }, s);
  const got = readCreatorIntent({ now: 1 }, s);
  assert.equal(got.planName, 'Creator');
  assert.equal(got.priceLabel, '$20/mo billed annually');
  // Labels are the visitor's own storage: anything that does not look like a
  // plan name or a price is dropped, never rendered.
  s.setItem(CREATOR_INTENT_KEY, JSON.stringify({ plan: 'monthly', at: 0, planName: '<img src=x onerror=alert(1)>', priceLabel: 'x'.repeat(200) }));
  const odd = readCreatorIntent({ now: 1 }, s);
  assert.equal(odd.plan, 'monthly');
  assert.equal(odd.planName, null);
  assert.equal(odd.priceLabel, null);
});

test('the labels /pricing writes come from billingCopy and pass the reader', () => {
  for (const plan of ['monthly', 'annual']) {
    const l = creatorIntentLabels(plan);
    const s = memoryStorage();
    stashCreatorIntent({ plan, now: 0, ...l }, s);
    const got = readCreatorIntent({ now: 1 }, s);
    assert.equal(got.planName, PLAN_NAME, plan);
    assert.equal(got.priceLabel, l.priceLabel, `${plan}: a real price label must survive the reader's check`);
  }
  assert.equal(creatorIntentLabels('monthly').priceLabel, PRICING.monthly.billedLabel);
  assert.ok(creatorIntentLabels('annual').priceLabel.startsWith(PRICING.annual.perMonthLabel));
});

test('a free start clears an earlier Get Creator, and the sign-in form never does', () => {
  const page = read('auth/PublicPricingPage.jsx');
  assert.match(page, /clearCreatorIntent\(\)/, 'Start free on /pricing must clear a pending Creator intent');
  const lp = read('hooks/useLandingEngagement.js');
  const props = lp.slice(lp.indexOf('ctaProps(pos, href, extra)'));
  assert.match(props.slice(0, 900), /if \(isFreeStartCta\(pageKind, pos, extra\)\) clearCreatorIntent\(\);/,
    'a landing free start must clear a pending Creator intent');
  // The shared-board buttons call the tracker directly, so they clear too.
  assert.match(read('components/PublicBoardView.jsx'), /if \(isFreeStartCta\('share', surface\)\) clearCreatorIntent\(\);/);
  // lpCtaClick is what the sign-in form calls; clearing there would throw away
  // the intent on the very sign-in /pricing sent the visitor to.
  assert.ok(!/clearCreatorIntent/.test(read('lib/landingMetrics.js')), 'landingMetrics (lpCtaClick) must not clear the intent');
});

test('only a free start drops the intent', () => {
  // Free starts, wherever they sit.
  for (const [kind, pos] of [['tool', 'hero'], ['compare', 'topbar'], ['tool', 'plan_block'], ['listicle', 'closing'],
    ['explore', 'band'], ['not_found', 'topbar'], ['share', 'topbar'], ['share', 'remix']]) {
    assert.equal(isFreeStartCta(kind, pos), true, `${kind}/${pos} is a free start`);
  }
  // Not free starts: browse links, the logo, the way back into the app, a
  // sign-in link, and adding a template.
  assert.equal(isFreeStartCta('tool', 'topbar_pricing', { intent: 'nav' }), false);
  assert.equal(isFreeStartCta('listicle', 'brand'), false, 'the logo goes home; it is not a plan choice');
  assert.equal(isFreeStartCta('docs', 'nav'), false, '"Open Clusters" from the docs');
  assert.equal(isFreeStartCta('changelog', 'nav'), false);
  assert.equal(isFreeStartCta('share', 'signin'), false);
  assert.equal(isFreeStartCta('template', 'topbar'), false, '"Use this template" says nothing about plans');
  assert.equal(isFreeStartCta('template_community', 'topbar'), false);
});

test('the resumed offer waits for the first run, pauses the tour, and has its own header', () => {
  const app = read('App.jsx');
  assert.match(app, /ready: !myTier\.loading && !!myTier\.tier && yb\.ready && firstRunSettled,/,
    'the resumed offer must wait for the board and the first run to settle');
  assert.match(app, /journey\(EV\.PS_SEED_DONE[^\n]*\n\s*setFirstRunSettled\(true\);/, 'a finished seed settles the first run');
  // The safety net starts with the board, from a stored deadline, and does not
  // restart when useMyTier hands back a fresh onboarding object.
  assert.match(app, /if \(myTier\.loading \|\| !yb\.ready\) return undefined;\s*if \(!settleDeadlineRef\.current\) settleDeadlineRef\.current = Date\.now\(\) \+ 10_000;/);
  assert.match(app, /\}, \[firstRunSettled, onboardingSeeded, myTier\.loading, yb\.ready\]\);/);
  assert.match(app, /enabled: tourActive && upgradeReason !== 'pricing-intent',/, 'the tour must pause under the offer');
  assert.match(app, /showCoachmark && !onboardingArmB && upgradeReason !== 'pricing-intent'/, 'so must the coachmark');
  const um = read('components/UpgradeModal.jsx');
  assert.match(um, /reason === 'pricing-intent' \? 'pricing-intent'/, 'pricing-intent needs its own header');
  const pm = read('components/PricingModal.jsx');
  assert.match(pm, /header === 'pricing-intent' \? PRICING_INTENT_COPY\.title/);
  // The invite-for-free-cards alternative is offered on the generic and
  // first-value headers only — never to someone who asked to pay.
  assert.match(pm, /\(header === 'first-value' \|\| header === null\) && \(/);
  const gate = read('auth/AuthGate.jsx');
  assert.match(gate, /readCreatorIntent\(\)/, 'the sign-in screen should say the offer is waiting');
});
