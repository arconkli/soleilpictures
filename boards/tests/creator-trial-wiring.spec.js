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
    for (const rel of ['src/auth/PricingPage.jsx', 'src/pages/PublicPricingPage.jsx']) {
      let src = '';
      try { src = read(rel); } catch { continue; }
      expect(src, rel).not.toMatch(/tryCreator|creatorTrialEligibility|trial: true/);
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

    // ...which requires the attribution to reach Stripe's metadata at all.
    const c = read('../supabase/functions/create-checkout-session/index.ts');
    expect(c).toMatch(/\.\.\.\(surface \? \{ surface: String\(surface\)\.slice\(0, 60\) \} : \{\}\),/);
    expect(c).toMatch(/if \(typeof body\.surface === "string"\) surface = body\.surface;/);
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