// creator-trial-wiring.spec.js — the Creator trial is offered in-product, to a
// real body of work, decided server-side, stamped when it starts.
//
// The modal's live behaviour is in pricing-flow.spec.js; the edge-function
// and activation-path invariants are covered by trialCore.test.mjs under
// node. This file guards the CLIENT wiring that ?local=1 cannot exercise and
// the one surface that must NOT offer the trial.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');

test.describe('creator trial wiring', () => {
  test('the modal offers the trial from the shared rule and sends the flag to checkout', () => {
    const s = read('src/components/PricingModal.jsx');
    expect(s).toMatch(/const trialDecision = creatorTrialEligibility\(\{\s*tier, cards: serverCardCount, cardLimit: effectiveCardLimit, trialStartedAt: creatorTrialStartedAt,?\s*\}\);/);
    expect(s).toMatch(/const trialOffer = !trialRefused && trialDecision\.eligible;/);
    expect(s).toMatch(/startCheckout\(\{ plan, surface, header, via, trial: trialOffer \}\)/);
    expect(s).toMatch(/trial: trialOffer,/);                       // on pricing_creator_intent
    expect(s).toMatch(/trialOffer \? CTA\.tryCreator : CTA\.getCreator/);
    expect(s).toMatch(/upgrade-trial-note/);
  });

  test('the public pricing page and the signed-in /pricing route never offer it', () => {
    // Both paths are read STRICTLY. The previous version named
    // src/pages/PublicPricingPage.jsx — which has never existed, the file is
    // under src/auth/ — inside a `try { … } catch { continue; }`, so the public
    // page silently opted out of the one guard that protects the
    // invitation-only rule. A missing file is now a failure, not a skip.
    for (const rel of ['src/auth/PricingPage.jsx', 'src/auth/PublicPricingPage.jsx']) {
      const src = read(rel);
      expect(src.length, `${rel} is readable`).toBeGreaterThan(0);
      expect(src, rel).not.toMatch(/tryCreator|creatorTrialEligibility|trial: true/);
      // …and none of the ambient trial copy may leak onto a price list either.
      expect(src, rel).not.toMatch(/TRIAL_FROM_LABEL|firstValueSentence|nearCapSentence/);
    }
  });

  test('checkout carries the flag and a refusal has honest copy', () => {
    const c = read('src/lib/checkout.js');
    expect(c).toMatch(/startCheckout\(\{ plan, surface, header = null, via = null, trial = false \}\)/);
    expect(c).toMatch(/trial: Boolean\(trial\)/);
    const e = read('src/lib/checkoutErrors.js');
    expect(e).toMatch(/trial_not_available:/);
    expect(e).toMatch(/return 'trial'/);
  });

  test('the tier store reads the stamp, and the harness can fake a prior trial', () => {
    expect(read('src/hooks/useMyTier.js')).toMatch(/creatorTrialStartedAt: row\?\.creator_trial_started_at \|\| null/);
    expect(read('src/lib/localMode.js')).toMatch(/creatorTrialStartedAt: q\.get\('trialed'\) === '1'/);
  });

  test('the docs state the trial from the same fact the code enforces', () => {
    const doc = read('content/docs/account/plans.md');
    expect(doc).toMatch(/\{\{fact:creatorTrialDays\}\}/);
    expect(doc).not.toMatch(/\b14 days\b/);
    expect(read('scripts/gen-docs.mjs')).toMatch(/creatorTrialDays: String\(CREATOR_TRIAL_DAYS\)/);
  });

  test('the exposure row records whether the trial was actually on the button', () => {
    // Without this the trial has no denominator: an exposure ending in a
    // dismiss is byte-identical whether the CTA read "Try Creator free for 14
    // days" or "Get Creator". It is NOT reconstructible from demo_cards —
    // the offer is decided on the SERVER count and demo_cards is optimistic.
    const m = read('src/components/PricingModal.jsx');
    expect(m).toMatch(/trial: trialOffer, trialReason: trialDecision\.reason,/);
    expect(m).toMatch(/serverCards: Number\.isFinite\(serverCardCount\) \? serverCardCount : null,/);

    const u = read('src/lib/upsellMetrics.js');
    expect(u).toMatch(/trial: trialAtView,/);
    expect(u).toMatch(/trial_reason: trialReasonAtView,/);
    expect(u).toMatch(/server_cards: serverCardsAtView,/);
    // Latched, not read live: the envelope refreshes on every render and a
    // focus refetch can flip the CTA mid-exposure while the summary fires once.
    expect(u).toMatch(/function noteTrial\(st\) \{/);
    expect(u).toMatch(/if \(!st \|\| typeof st\.trial !== 'boolean'\) return;/);
    expect(u).toMatch(/noteTrial\(curUserState\);/);
  });

  test('the sale carries the trial flag and the pitch that produced it', () => {
    // A trial start and a sale both arrive as checkout.session.completed with
    // amount_total 0 (a 100%-off promo is 0 too), so without the flag the
    // product's first trial would register as its first sale — permanently.
    const w = read('../supabase/functions/stripe-webhook/index.ts');
    expect(w).toMatch(/trial: m\.trial === "1",/);
    expect(w).toMatch(/status: subscription\?\.status \?\? null,/);
    expect(w).toMatch(/header: m\.header \?\? null,/);

    // A trial start has exactly ONE write path (activate.ts), but
    // onSubscriptionUpdated is the OTHER way a user reaches paid tier on
    // 'trialing'. If checkout.session.completed is delayed or arrives second,
    // the user would hold paid tier with a live Stripe trial and no row
    // anywhere saying a trial happened — and every trial counter, plus the
    // never-twice guard, reads that one column.
    const updated = w.slice(w.indexOf('async function onSubscriptionUpdated'),
                            w.indexOf('// charge.refunded / charge.dispute.created'));
    expect(updated).toMatch(/if \(full\.status === "trialing"\) \{/);
    expect(updated).toMatch(/\.is\("creator_trial_started_at", null\)/);

    // ...which requires the attribution to reach Stripe's metadata at all, and
    // specifically the SESSION metadata: the webhook reads `session.metadata`,
    // so the same keys on subscription_data.metadata would read back as null
    // and "fixed" attribution would be blank on every row.
    const c = read('../supabase/functions/create-checkout-session/index.ts');
    expect(c).toMatch(/if \(typeof body\.surface === "string"\) surface = body\.surface;/);
    const sessionMeta = c.slice(c.indexOf('      metadata: {'), c.indexOf('      subscription_data: {'));
    expect(sessionMeta).toMatch(/surface: surface\.slice\(0, 60\)/);
    expect(sessionMeta).toMatch(/header:  header\.slice\(0, 60\)/);
    expect(sessionMeta).toMatch(/via:     via\.slice\(0, 60\)/);
    // And the webhook must still be reading the session's, not the subscription's.
    expect(w).toMatch(/const m = session\.metadata \?\? \{\};/);
  });


  // ── The trial on the AMBIENT surfaces (studio_v4) ────────────────────────
  //
  // Until studio_v4 `creatorTrial` was referenced in exactly one rendering
  // component — PricingModal — so the trial was only discoverable by clicking
  // through, and only a small fraction of the people who saw a price ever saw
  // it. The chip, the first-value banner and the approaching-limit toast now
  // lead with the invitation when the viewer is eligible, and the price when
  // not.

  test('the chip offers the trial, decided on the SERVER count', () => {
    const c = read('src/components/UpgradeChip.jsx');
    // Same rule, same input as the modal. demoCardCount is optimistic and runs
    // BACKWARDS on delete, so a chip keyed on it would offer a trial the
    // server then refuses — a broken button.
    expect(c).toMatch(/const trialDecision = creatorTrialEligibility\(\{\s*tier, cards: serverCardCount, cardLimit, trialStartedAt: creatorTrialStartedAt,?\s*\}\);/);
    expect(c).toMatch(/const trialOffer = trialDecision\.eligible;/);
    // The two offers are mutually exclusive by construction — an invitation
    // beside a request reads as a discount rather than a gift.
    expect(c).toMatch(/const showPrice = \(showCount \|\| near\) && !trialOffer;/);
    // …and the trial ignores the pressure ladder on purpose: eligibility starts
    // at thirteen cards, which is below the 50% line where `count` begins.
    expect(c).toMatch(/const showTrial = trialOffer;/);
  });

  test('a trial impression does not stamp price_seen', () => {
    // price_seen means A NUMBER WAS SHOWN. Stamping it on a trial impression
    // would put a row behind an impression that never happened, and the reach
    // metric would then repeat the lie back to us.
    const c = read('src/components/UpgradeChip.jsx');
    expect(c).toMatch(/if \(!trialOffer\) notePriceSeen\('first_value'\);/);
    expect(c).toMatch(/if \(showPrice\) notePriceSeen\('chip'\);/);
    const a = read('src/App.jsx');
    expect(a).toMatch(/if \(!trialOffer && user\?\.id && markPriceSeen\(user\.id, 'cap_toast'\)\)/);
  });

  test('the impression row keeps the two offers separable', () => {
    // Without trial_shown, a fall in price_seen after this ships reads as lost
    // reach when it is actually the trial landing.
    const c = read('src/components/UpgradeChip.jsx');
    expect(c).toMatch(/price_shown: showPrice, trial_shown: showTrial, trial_reason: trialDecision\.reason,/);
    expect(c).toMatch(/up_chip_view:\$\{showTrial \? 'trial' : showPrice \? 'price' : 'label'\}/);
    const a = read('src/App.jsx');
    expect(a).toMatch(/count, limit, at, trial_shown: trialOffer,/);
  });

  test('the banner and the toast take the offer from the same rule', () => {
    const c = read('src/components/UpgradeChip.jsx');
    expect(c).toMatch(/<FirstValueUpgradeBanner trialOffer=\{trialOffer\}/);
    const b = read('src/components/FirstValueUpgradeBanner.jsx');
    expect(b).toMatch(/firstValueSentence\(trialOffer\)/);
    expect(b).toMatch(/trialOffer \? CTA\.tryCreatorShort : 'See Creator'/);
    const a = read('src/App.jsx');
    expect(a).toMatch(/const trialOffer = creatorTrialEligibility\(\{/);
    expect(a).toMatch(/cards: myTier\.serverCardCount,/);
    expect(a).toMatch(/message: nearCapSentence\(\{ count, limit, trialOffer \}\)/);
  });

  test('a body of work sees the trial on the pill; someone who already had one sees the price', async ({ page }) => {
    // Twenty cards on a 50-card cap: trial-eligible (13+), but only 40% of the
    // way up — below the `count` pressure line. This is exactly the band the
    // change is aimed at, and the band the price ladder alone never reached.
    await page.goto('/?local=1&reset=1&tier=demo&cards=20&limit=50');
    const chip = page.locator('.upgrade-chip');
    await expect(chip).toBeVisible();
    await expect(chip.locator('.upgrade-chip-trial')).toHaveText(/\d+ days free/);
    await expect(chip.locator('.upgrade-chip-price')).toHaveCount(0);

    // The one-per-account rule is what flips it back to the price.
    await page.goto('/?local=1&reset=1&tier=demo&cards=20&limit=50&trialed=1');
    await expect(page.locator('.upgrade-chip')).toBeVisible();
    await expect(page.locator('.upgrade-chip-trial')).toHaveCount(0);
  });

  test('the trial never reaches a surface that is not an in-product invitation', async ({ page }) => {
    // What protects a premium position is WHO is offered the trial and WHERE.
    // A "START FREE TRIAL" banner on the public price list is the thing this
    // deliberately is not.
    await page.goto('/pricing');
    // Prove the page actually rendered first — a blank page passes a bare
    // "does not contain" assertion trivially.
    await expect(page.getByText('Creator').first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/days free/i);
    await expect(page.locator('body')).not.toContainText(/free for \d+ days/i);
  });

  test('a refused trial records WHY the server refused', () => {
    // already_trialed is the anti-abuse sweep working; too_early means our
    // cached count was stale and we offered something we shouldn't have.
    // Opposite problems, previously byte-identical rows.
    const c = read('src/lib/checkout.js');
    expect(c).toMatch(/if \(body\.reason\) err\.reason = body\.reason;/);
    expect(c).toMatch(/reason: e\?\.reason \?\? null,/);
  });
});