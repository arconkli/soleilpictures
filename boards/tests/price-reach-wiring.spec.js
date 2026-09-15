// price-reach-wiring.spec.js — source-guard for "the price is where the
// committed can see it". ?local=1 mounts LocalBoardsApp, so App.jsx's body is
// unreachable in the harness; its wiring is asserted on CODE SHAPE (the
// collab-nudge idiom). The chip, banner and modal have live specs
// (upsell-eligibility, first-value-upgrade, pricing-flow); this file covers
// the App.jsx reconcile path and the cross-surface invariants.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
const app = () => read('src/App.jsx');
const chip = () => read('src/components/UpgradeChip.jsx');
const banner = () => read('src/components/FirstValueUpgradeBanner.jsx');
const modal = () => read('src/components/PricingModal.jsx');
const page = () => read('src/auth/PricingPage.jsx');
const catalog = () => read('src/lib/analyticsEvents.js');
const elig = () => read('src/lib/upsellEligibility.js');

test.describe('price reach wiring', () => {
  test('the approaching-limit warning is owed on ARRIVAL, not only on an add', () => {
    const s = app();
    // The reconcile rule runs when the server count lands…
    expect(s).toMatch(/shouldWarnNearCapNow\(\{ count, limit, warnedAtLimit: warnedAt \}\)/);
    // …keyed on the reconciled numbers…
    expect(s).toMatch(/\[myTier\.loading, myTier\.tier, myTier\.demoCardCount, myTier\.effectiveCardLimit, user\?\.id\]/);
    // …and both paths share ONE toast body through the ref, so a returning
    // user cannot be warned twice across a reload.
    expect(s).toMatch(/showNearCapToastRef\.current\?\.\(cs, 'near'\)/);
    expect(s).toMatch(/showNearCapToastRef\.current\?\.\(\{ count, limit \}, 'arrival'\)/);
    expect(s).toMatch(/markNearCapWarned\(user\?\.id, limit\)/);
    expect(s).toMatch(/nearCapWarnedAt\(user\?\.id\) === (cs\.)?limit/);
  });

  test('the near-cap toast carries the price and stamps the first impression', () => {
    const s = app();
    const toast = s.indexOf('Creator lifts the cap, ${PRICE_FROM_LABEL}');
    expect(toast).toBeGreaterThan(0);
    expect(s).toMatch(/markPriceSeen\(user\.id, 'cap_toast'\)/);
  });

  test('the warning line sits below the urgent line', () => {
    const s = elig();
    expect(s).toMatch(/warnFrac:\s*0\.80/);
    expect(s).toMatch(/urgentFrac:\s*0\.90/);
    // shouldWarnNearCap reads the WARN line, not the chip's urgent line.
    const fn = s.slice(s.indexOf('export function shouldWarnNearCap('), s.indexOf('export function shouldWarnNearCapNow('));
    expect(fn).toMatch(/warnCapAt\(cap\)/);
    expect(fn).not.toMatch(/nearCapAt\(cap\)/);
  });

  test('a real body of work is eligible under any cap, at revision e2', () => {
    const s = elig();
    expect(s).toMatch(/ELIGIBILITY_REV = 'e2'/);
    expect(s).toMatch(/investedMin:\s*13/);
    expect(s).toMatch(/cards >= THRESHOLDS\.investedMin/);
  });

  test('every ambient surface carries the derived price label, never a typed number', () => {
    for (const src of [chip(), banner(), modal()]) {
      expect(src).toMatch(/PRICE_FROM_LABEL/);
      expect(src).not.toMatch(/\$2[05]\/mo/);
    }
    expect(chip()).toMatch(/upgrade-chip-price/);
    expect(modal()).toMatch(/Creator lifts the cap, \{PRICE_FROM_LABEL\}/);
  });

  test('the chip records its impression, and every priced surface stamps price_seen once', () => {
    const c = chip();
    expect(c).toMatch(/EV\.UP_CHIP_VIEW/);
    expect(c).toMatch(/up_chip_view:\$\{showPrice \? 'price' : 'label'\}/);
    expect(c).toMatch(/notePriceSeen\('chip'\)/);
    expect(c).toMatch(/notePriceSeen\('first_value'\)/);
    // The stamp spreads the object as read: a bare { upgrade_prompts: {…} }
    // write would erase the first-value once-flag (top-level merge).
    expect(c).toMatch(/upgrade_prompts: promptsRef\.current/);
    expect(c).not.toMatch(/upgrade_prompts: \{ first_value_shown_at: at \}/);
    expect(modal()).toMatch(/markPriceSeen\(user\.id, 'modal'\)/);
    expect(page()).toMatch(/markPriceSeen\(user\.id, 'page'\)/);
    expect(catalog()).toMatch(/PRICE_SEEN:\s*'price_seen'/);
    expect(catalog()).toMatch(/UP_CHIP_VIEW:\s*'up_chip_view'/);
  });

  test('a checkout failure is classified, so a misconfiguration can never read as an outage', () => {
    const c = read('src/lib/checkout.js');
    expect(c).toMatch(/kind: checkoutErrorKind\(e\)/);
    const e = read('src/lib/checkoutErrors.js');
    expect(e).toMatch(/export function checkoutErrorKind/);
    expect(e).toMatch(/no such price/i);
  });
});
