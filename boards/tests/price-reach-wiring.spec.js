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
    // The sentence moved into billingCopy (nearCapSentence) when the trial
    // shipped, so App no longer holds the literal — which quietly broke this
    // guard rather than the behaviour. Assert where it lives now: App calls the
    // shared builder, and the builder's non-trial branch carries the price.
    expect(app()).toMatch(/nearCapSentence\(\{ count, limit, trialOffer \}\)/);
    const copy = read('src/lib/billingCopy.js');
    const fn = copy.slice(copy.indexOf('export function nearCapSentence('));
    expect(fn.slice(0, 500)).toMatch(/Creator lifts the cap, \$\{PRICE_FROM_LABEL\}/);
    expect(app()).toMatch(/markPriceSeen\(user\.id, 'cap_toast'\)/);
    // …and a TRIAL impression must not stamp price_seen: no number was shown.
    expect(app()).toMatch(/if \(!trialOffer && user\?\.id && markPriceSeen\(user\.id, 'cap_toast'\)\)/);
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
    // The real invariant is the second line: no surface may type a price. The
    // FIRST line has to follow the label, and the banner stopped holding it
    // directly when firstValueSentence() took over its body — so it is checked
    // against the builder it now renders instead.
    for (const src of [chip(), banner(), modal(), page()]) {
      expect(src).not.toMatch(/\$2[05]\/mo/);
    }
    // The AMBIENT surfaces — the pill, the banner, the toast — carry the
    // compact "from $N/mo" label, because they have room for a label and not a
    // price row.
    expect(chip()).toMatch(/PRICE_FROM_LABEL/);
    expect(chip()).toMatch(/upgrade-chip-price/);
    expect(banner()).toMatch(/firstValueSentence\(trialOffer\)/);
    const copy = read('src/lib/billingCopy.js');
    const fv = copy.slice(copy.indexOf('export function firstValueSentence('));
    expect(fv.slice(0, 400)).toMatch(/\$\{PRICE_FROM_LABEL\}/);

    // The MODAL shows the real price row instead. It used to repeat the label
    // inside a sentence describing the product, and once every benefit grew an
    // explanation that sentence was the same claim twice — so it went, and the
    // price is now where a price belongs. Still derived, never typed:
    // CreatorPriceRow reads planPerMonth(), and the struck monthly rate beside
    // the annual one reads PRICING.monthly.perMonth.
    expect(modal()).toMatch(/<CreatorPriceRow plan=\{plan\} \/>/);
    const bits = read('src/components/PricingBits.jsx');
    expect(bits).toMatch(/\$\{planPerMonth\(plan\)\}/);
    expect(bits).toMatch(/PRICING\.monthly\.perMonth/);
    // With the "/mo" suffix, as in the loop above: that is what makes a string
    // a price CLAIM rather than a mention. Without it this tripped on the
    // comment in PricingBits explaining why the struck rate is honest — the
    // guard failing on its own rationale, for the third time in this repo.
    expect(bits).not.toMatch(/\$2[05]\/mo/);
  });

  test('the chip records its impression, and every priced surface stamps price_seen once', () => {
    const c = chip();
    expect(c).toMatch(/EV\.UP_CHIP_VIEW/);
    // Three-way since the trial: a trial impression is not a priced one, and
    // collapsing them would make the offer-reach denominator unreadable.
    expect(c).toMatch(/up_chip_view:\$\{showTrial \? 'trial' : showPrice \? 'price' : 'label'\}/);
    expect(c).toMatch(/notePriceSeen\('chip'\)/);
    expect(c).toMatch(/notePriceSeen\('first_value'\)/);
    // The stamp goes through the shared, re-reading, serialised writer: a bare
    // { upgrade_prompts: {…} } write replaces the object wholesale (the SQL
    // merges at the top level only) and a locally-held copy loses the race.
    expect(c).toMatch(/stampUpgradePrompt\(\{ price_seen_at: at/);
    expect(c).toMatch(/stampUpgradePrompt\(\{ first_value_shown_at: at \}\)/);
    expect(c).not.toMatch(/updateOwnSettings\(/);
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

test.describe('review fixes', () => {
  const app = () => readFileSync(new URL('src/App.jsx', new URL('../', import.meta.url)), 'utf8');

  test('a declined trial falls back to buying Creator instead of dead-ending', () => {
    const s = readFileSync(new URL('src/components/PricingModal.jsx', new URL('../', import.meta.url)), 'utf8');
    // trialOffer is render state the 403 could not change, so every retry
    // re-sent trial:true and was refused identically — leaving the only
    // in-product buy button permanently unable to buy.
    expect(s).toMatch(/const \[trialRefused, setTrialRefused\] = useState\(false\)/);
    expect(s).toMatch(/const trialOffer = !trialRefused &&/);
    expect(s).toMatch(/if \(checkoutErrorKind\(err\) === 'trial'\) setTrialRefused\(true\)/);
  });

  test('the trial is decided on the SERVER card count, not the optimistic one', () => {
    // useMyTier.demoCardCount is the server count plus an optimistic delta.
    // The server re-decides this exact rule against card_index, and the
    // threshold is an exact boundary, so the delta offers a trial that is then
    // refused.
    expect(readFileSync(new URL('src/hooks/useMyTier.js', new URL('../', import.meta.url)), 'utf8'))
      .toMatch(/serverCardCount/);
    expect(readFileSync(new URL('src/components/PricingModal.jsx', new URL('../', import.meta.url)), 'utf8'))
      .toMatch(/cards: serverCardCount/);
  });

  test('every price surface writes the durable stamp through one serialised writer', () => {
    // merge_profile_settings merges at the TOP level, so a bare write replaces
    // upgrade_prompts wholesale. The chip's local copy is {} until an async
    // read resolves, and its own impression effect can fire in the same commit.
    const w = readFileSync(new URL('src/lib/upgradePrompts.js', new URL('../', import.meta.url)), 'utf8');
    expect(w).toMatch(/let chain = Promise\.resolve\(\)/);
    expect(w).toMatch(/await getOwnProfile\(\)/);
    for (const rel of ['src/components/UpgradeChip.jsx', 'src/components/PricingModal.jsx', 'src/auth/PricingPage.jsx', 'src/App.jsx']) {
      const src = readFileSync(new URL(rel, new URL('../', import.meta.url)), 'utf8');
      expect(src, rel).toMatch(/stampUpgradePrompt\(/);
      expect(src, rel).not.toMatch(/updateOwnSettings\(\{ upgrade_prompts/);
    }
  });

  test('the cap wall is not clobbered by the file-type pitch on a list drop', () => {
    const s = app();
    // preflightImport can surface the wall AND spend its once-per-ceiling
    // latch; an unconditional storage modal after it replaced a wall that had
    // already been paid for.
    //
    // The `over === 0` condition is still the local guard, but it is no longer
    // the only one — and it never covered the canvas path, where the same
    // collision cost a real cap-hit modal 16ms of life on 2026-09-17. The
    // durable fix is the shared slot: the wall claims, so the storage gate
    // stands down wherever it fires from.
    expect(s).toMatch(/const explained = csFiles\.own && over === 0 \? pitchStorageGate\(\) : false/);
    expect(s).toMatch(/claimUpsellSlot\('storage-gate'\)/);
    expect(s).toMatch(/const openCapWall = useCallback/);
    // n_accepted has always meant "passed the file-type gate" — reading it off
    // the post-preflight array redefined it as "survived the cap".
    expect(s).toMatch(/n_accepted: nClassified/);
    expect(s).toMatch(/n_over: over/);
  });

  test('the near-cap toast queues with the other load-time upsells and reports every ceiling', () => {
    const s = app();
    expect(s).toMatch(/claimUpsellSlot\('cap-toast'\)/);
    expect(s).toMatch(/up_cap_toast:near:\$\{limit\}/);
    expect(readFileSync(new URL('src/lib/upsellSlot.js', new URL('../', import.meta.url)), 'utf8'))
      .toMatch(/'cap-toast'/);
  });
});
