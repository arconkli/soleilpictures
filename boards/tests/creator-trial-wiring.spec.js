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
    expect(s).toMatch(/creatorTrialEligibility\(\{\s*tier, cards: serverCardCount, cardLimit: effectiveCardLimit, trialStartedAt: creatorTrialStartedAt,?\s*\}\)\.eligible/);
    expect(s).toMatch(/startCheckout\(\{ plan, surface, trial: trialOffer \}\)/);
    expect(s).toMatch(/trial: trialOffer,/);                       // on pricing_creator_intent
    expect(s).toMatch(/trialOffer \? CTA\.tryCreator : CTA\.getCreator/);
    expect(s).toMatch(/upgrade-trial-note/);
  });

  test('the public pricing page and the signed-in /pricing route never offer it', () => {
    for (const rel of ['src/auth/PricingPage.jsx', 'src/pages/PublicPricingPage.jsx']) {
      let src = '';
      try { src = read(rel); } catch { continue; }
      expect(src, rel).not.toMatch(/tryCreator|creatorTrialEligibility|trial: true/);
    }
  });

  test('checkout carries the flag and a refusal has honest copy', () => {
    const c = read('src/lib/checkout.js');
    expect(c).toMatch(/startCheckout\(\{ plan, surface, trial = false \}\)/);
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
});
