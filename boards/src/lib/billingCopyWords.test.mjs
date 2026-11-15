// billingCopyWords.test.mjs — the app-only words say exactly what billingCopy.js
// says: every table, every label, every case of every function.
//
//   node --import ./scripts/linguiNode.mjs --test src/lib/billingCopyWords.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as shared from './billingCopy.js';
import * as words from './billingCopyWords.js';

// A getter table read in full, so a getter and a string compare alike.
const plain = (v) => JSON.parse(JSON.stringify(v));

test('the one-line labels are what the constants say', () => {
  assert.equal(words.priceFromLabel(), shared.PRICE_FROM_LABEL);
  assert.equal(words.trialFromLabel(), shared.TRIAL_FROM_LABEL);
  assert.equal(words.savingsPctLabel(), shared.SAVINGS_PCT_LABEL);
});

test('planBilling and the CTAs read the same', () => {
  for (const p of ['monthly', 'annual', undefined]) assert.deepEqual(words.planBilling(p), shared.planBilling(p), String(p));
  for (const k of Object.keys(shared.CTA)) {
    if (typeof shared.CTA[k] === 'function') {
      for (const p of ['monthly', 'annual']) assert.equal(words.CTA[k](p), shared.CTA[k](p), `${k} ${p}`);
    } else assert.equal(words.CTA[k], shared.CTA[k], k);
  }
  assert.deepEqual(Object.keys(words.CTA).sort(), Object.keys(shared.CTA).sort());
});

test('the extra-storage sheet reads the same for every interval and amount', () => {
  for (const interval of ['month', 'year']) {
    for (const amountToday of [0, 100, 1840, 2500]) {
      for (const creditNext of [0, 500, 1840]) {
        for (const removing of [false, true]) {
          const o = { interval, amountToday, creditNext, removing };
          assert.deepEqual(words.storageAddonCopy(o), shared.storageAddonCopy(o), JSON.stringify(o));
        }
      }
    }
  }
  assert.deepEqual(words.storageAddonCopy(), shared.storageAddonCopy());
});

test('the benefits, the free features and the limit sentence read the same', () => {
  assert.deepEqual(plain(words.CREATOR_BENEFITS), plain(shared.CREATOR_BENEFITS));
  for (const cardLimit of [undefined, 0, 50, 25, shared.REFERRED_START_CARDS, 'x']) {
    assert.deepEqual(plain(words.creatorBenefits({ cardLimit })), plain(shared.creatorBenefits({ cardLimit })), String(cardLimit));
    assert.equal(words.freeLimitSentence({ cardLimit }), shared.freeLimitSentence({ cardLimit }), String(cardLimit));
  }
  assert.deepEqual(plain(words.creatorBenefits()), plain(shared.creatorBenefits()));
  assert.deepEqual(words.demoFeatures(), shared.DEMO_FEATURES);
});

test('the walls and the ambient offers read the same', () => {
  for (const own of [true, false]) for (const paid of [true, false]) {
    assert.equal(words.storageFullMessage({ own, paid }), shared.storageFullMessage({ own, paid }), `${own} ${paid}`);
  }
  assert.deepEqual(plain(words.STORAGE_FULL_COPY), plain(shared.STORAGE_FULL_COPY));
  for (const t of [true, false]) {
    assert.equal(words.firstValueSentence(t), shared.firstValueSentence(t));
    for (const [count, limit] of [[48, 50], [1, 1], [24, 25]]) {
      assert.equal(words.nearCapSentence({ count, limit, trialOffer: t }), shared.nearCapSentence({ count, limit, trialOffer: t }));
    }
  }
  assert.equal(words.newProjectSentence({ count: 40, limit: 50 }), shared.newProjectSentence({ count: 40, limit: 50 }));
});

test('the pricing page, its comparison and its questions read the same', () => {
  assert.deepEqual(plain(words.PRICING_INTENT_COPY), plain(shared.PRICING_INTENT_COPY));
  assert.deepEqual(plain(words.PRICING_PAGE), plain(shared.PRICING_PAGE));
  assert.deepEqual(plain(words.PLAN_COMPARISON), plain(shared.PLAN_COMPARISON));
  assert.deepEqual(plain(words.PRICING_FAQ), plain(shared.PRICING_FAQ));
});

test('the offer modal\'s rows read the same', () => {
  for (const o of [undefined, {}, { cards: 3, limit: 50 }, { cards: 0, limit: 50 }, { cards: 3 }]) {
    assert.deepEqual(words.currentPlanRow(o), shared.currentPlanRow(o), JSON.stringify(o));
  }
  for (const p of ['monthly', 'annual', 'x']) {
    assert.deepEqual(words.trialPrice(p), shared.trialPrice(p), p);
    assert.equal(words.trialNote(p), shared.trialNote(p), p);
  }
  const GB = 1024 ** 3;
  for (const cards of [undefined, 0, 1, 2, 48]) for (const clusters of [undefined, 1, 5]) for (const storageBytes of [undefined, 0, 5e8, 3 * GB]) {
    const o = { cards, clusters, storageBytes };
    assert.equal(words.ownWorkSummary(o), shared.ownWorkSummary(o), JSON.stringify(o));
  }
  assert.equal(words.ownWorkSummary(), shared.ownWorkSummary());
});

test('the Billing tab reads the same for every tier, plan and status', () => {
  for (const tier of ['admin', 'paid', 'demo', 'waitlist', 'x', undefined]) {
    for (const plan of ['monthly', 'annual']) {
      for (const grantBacked of [false, true]) {
        for (const subscriptionStatus of [undefined, 'active', 'trialing']) {
          for (const cardLimit of [undefined, 50]) {
            const o = { tier, plan, demoCardCount: 7, grantBacked, cardLimit, subscriptionStatus };
            assert.equal(words.planLabel(o), shared.planLabel(o), JSON.stringify(o));
          }
        }
      }
    }
  }
  assert.equal(words.planLabel(), shared.planLabel());
  for (const o of [undefined, { grantActive: false }, { grantActive: true }, { grantActive: true, grantExpiresAt: 'nope' }, { grantActive: true, grantExpiresAt: '2027-03-09T12:00:00Z' }]) {
    assert.equal(words.grantCopy(o), shared.grantCopy(o), JSON.stringify(o));
  }
  for (const d of [null, 'nope', '2027-03-09T12:00:00Z']) for (const o of [{}, { cancel: true }, { trial: true }]) {
    assert.deepEqual(words.formatPeriodEnd(d, o), shared.formatPeriodEnd(d, o), `${d} ${JSON.stringify(o)}`);
  }
  for (const s of ['trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled', 'incomplete', 'incomplete_expired', 'weird', '', null, undefined]) {
    assert.equal(words.statusLabel(s), shared.statusLabel(s), String(s));
  }
});

// ── Money and sizes in the reader's language (16b) ──
import { setUiLocale } from './uiLocale.js';

const nb = (s) => s.replace(/[\u00a0\u202f]/g, ' ');
const inLocale = (l, fn) => { setUiLocale(l); try { return fn(); } finally { setUiLocale('en'); } };
test('centsLabel, subscribeShort and storageAmountLabel: English as ever; fr and ru write them their way', () => {
  assert.equal(words.centsLabel(2500), '$25');
  assert.equal(words.centsLabel(1840), '$18.40');
  assert.equal(words.CTA.subscribeShort('annual'), shared.CTA.subscribeShort('annual'));
  for (const n of [0, 5e5, 233 * 1024 ** 2, 1.4 * 1024 ** 3, 3 * 1024 ** 4]) {
    assert.equal(words.storageAmountLabel(n), shared.storageAmountLabel(n), String(n));
  }
  assert.equal(words.storageAmountLabel(0), null);
  assert.equal(nb(inLocale('fr', () => words.centsLabel(1840))), '18,40 $US');
  assert.equal(nb(inLocale('ru', () => words.centsLabel(2500))), '25 $');
  assert.equal(nb(inLocale('fr', () => words.CTA.subscribeShort('annual'))), 'Subscribe — 20 $US/mo');
  assert.equal(nb(inLocale('fr', () => words.storageAmountLabel(1.4 * 1024 ** 3))), '1,4 Go');
  assert.equal(nb(inLocale('ru', () => words.storageAmountLabel(233 * 1024 ** 2))), '233 МБ');
});

// ── billingCopy's own labels, in the reader's language ──────────────────────

const STORAGE_LABELS = [shared.CREATOR_STORAGE_LABEL, shared.FREE_STORAGE_LABEL, shared.TRIAL_STORAGE_LABEL, shared.STORAGE_ADDON_BLOCK_LABEL];
const labelsIn = (l) => inLocale(l, () => ({
  monthlyBilled: words.billed('monthly'),
  annualBilled: words.billed('annual'),
  monthlyPer: words.perMonth('monthly'),
  annualPer: words.perMonth('annual'),
  savings: words.savings(),
  addonMonth: words.addonBilled('month'),
  addonYear: words.addonBilled('year'),
  storage: STORAGE_LABELS.map(words.storageLabel),
}));

test('in English every label helper is billingCopy’s own label', () => {
  assert.equal(words.billed('monthly'), shared.PRICING.monthly.billedLabel);
  assert.equal(words.billed('annual'), shared.PRICING.annual.billedLabel);
  assert.equal(words.perMonth('monthly'), shared.PRICING.monthly.perMonthLabel);
  assert.equal(words.perMonth('annual'), shared.PRICING.annual.perMonthLabel);
  assert.equal(words.savings(), shared.PRICING.annual.savings);
  assert.equal(words.addonBilled('month'), shared.STORAGE_ADDON_PRICING.monthly.perLabel);
  assert.equal(words.addonBilled('year'), shared.STORAGE_ADDON_PRICING.annual.perLabel);
  assert.equal(words.creatorStorageLabel(), shared.CREATOR_STORAGE_LABEL);
  assert.equal(words.freeStorageLabel(), shared.FREE_STORAGE_LABEL);
  assert.equal(words.trialStorageLabel(), shared.TRIAL_STORAGE_LABEL);
  assert.equal(words.addonBlockLabel(), shared.STORAGE_ADDON_BLOCK_LABEL);
});

test('every storage label in billingCopy.js is one the label parser reads', () => {
  for (const label of STORAGE_LABELS) assert.match(label, /^(\d+)(TB|GB|MB)$/, label);
  assert.equal(inLocale('fr', () => words.storageLabel('about a terabyte')), 'about a terabyte');
});

test('in French and Russian the labels are written the reader’s way', () => {
  for (const l of ['fr', 'ru']) {
    const x = labelsIn(l);
    const lead = (s, n) => assert.match(nb(s), new RegExp(`^${n}\\D`), `${l} ${s}`);
    lead(x.monthlyBilled, shared.PRICING.monthly.billed);
    lead(x.annualBilled, shared.PRICING.annual.billed);
    lead(x.addonMonth, shared.STORAGE_ADDON_PRICING.monthly.billed);
    lead(x.addonYear, shared.STORAGE_ADDON_PRICING.annual.billed);
    lead(x.savings, shared.PRICING.annual.savings.match(/\d+/)[0]);
    lead(x.monthlyPer, shared.PRICING.monthly.perMonth);
    lead(x.annualPer, shared.PRICING.annual.perMonth);
    // Without a catalog a message is its English source, so the period word is
    // not asserted; the number is Intl's and no "$" comes before the digits.
    for (const k of ['monthlyBilled', 'annualBilled', 'addonMonth', 'addonYear', 'savings', 'monthlyPer', 'annualPer']) {
      assert.doesNotMatch(x[k], /\$\d/, `${l} ${k}: ${x[k]}`);
    }
    for (const s of x.storage) assert.doesNotMatch(s, /\d\s?(TB|GB|MB)/, `${l} ${s}`);
  }
  const fr = labelsIn('fr');
  assert.deepEqual(fr.storage.map(nb), ['1 To', '5 Go', '100 Go', '1 To']);
  assert.equal(nb(labelsIn('ru').storage[0]), '1 ТБ');
});

test('the language is read when a label is asked for, never frozen at import', () => {
  const fr = labelsIn('fr').monthlyBilled;
  assert.equal(words.billed('monthly'), shared.PRICING.monthly.billedLabel);
  assert.equal(labelsIn('fr').monthlyBilled, fr);
});
