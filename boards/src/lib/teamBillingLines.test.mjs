// teamBillingLines.test.mjs — the sentences Seats & billing says about the
// plan, the card and the receipts, and the fallbacks to today's wording when
// the team-billing "summary" hasn't answered. Dates are built in local time
// at noon, so the day reads the same wherever the tests run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  amountLabel, receiptDate, planLines, autoAddLines, brandName, cardLines, receiptRows, noReceiptsLine,
} from './teamBillingLines.js';

const at = (m, d, y = 2026) => new Date(y, m - 1, d, 12).getTime();
const NOW = at(12, 15);

const TRIAL = { interval: 'month', seats: 15, renewsAt: at(11, 29), trialEndsAt: at(11, 29), status: 'trialing', cancelAtPeriodEnd: false };
const ACTIVE = { interval: 'month', seats: 17, renewsAt: at(12, 29), trialEndsAt: null, status: 'active', cancelAtPeriodEnd: false };
const NEXT = { amount: 42500, currency: 'usd', date: at(12, 29) };

test('amountLabel: minor units, whole amounts drop the cents, fixed keeps them', () => {
  assert.equal(amountLabel(37500, 'usd'), '$375');
  assert.equal(amountLabel(4167, 'usd'), '$41.67');
  assert.equal(amountLabel(37500, 'usd', { fixed: true }), '$375.00');
  assert.equal(amountLabel(4167, 'usd', { fixed: true }), '$41.67');
  assert.equal(amountLabel(123456789, 'usd'), '$1,234,567.89');
  assert.equal(amountLabel(37500, 'USD'), '$375');
  // Another currency goes through Intl, in its own number of minor digits.
  assert.ok(amountLabel(5000, 'jpy').includes('5,000'));
  assert.ok(amountLabel(5000, 'eur').includes('50'));
  assert.ok(amountLabel(5050, 'eur').includes('50.50'));
});

test('receiptDate: the day, and the year only when it is not this year', () => {
  assert.equal(receiptDate(at(11, 29), NOW), 'Nov 29');
  assert.equal(receiptDate(at(11, 29, 2025), NOW), 'Nov 29, 2025');
  assert.equal(receiptDate(null, NOW), '');
});

test('trial with the first charge known: the mockup sentence and a Free trial badge', () => {
  const l = planLines({ plan: TRIAL, role: 'owner', next: { amount: 37500, currency: 'usd', date: at(11, 29) } });
  assert.equal(l.state, 'trial');
  assert.equal(l.badge, 'Free trial');
  assert.equal(l.text, 'Free until November 29. The first charge is that day: $375 for 15 seats, then monthly.');
  assert.equal(l.keep, false);
});

test('trial, yearly, and a single seat', () => {
  const y = planLines({ plan: { ...TRIAL, interval: 'year' }, role: 'admin', next: { amount: 360000, currency: 'usd', date: at(11, 29) } });
  assert.equal(y.text, 'Free until November 29. The first charge is that day: $3,600 for 15 seats, then yearly.');
  const one = planLines({ plan: { ...TRIAL, seats: 1 }, role: 'owner', next: { amount: 2500, currency: 'usd' } });
  assert.equal(one.text, 'Free until November 29. The first charge is that day: $25 for 1 seat, then monthly.');
});

test('trial without a known amount keeps the renewal wording the tab has today', () => {
  for (const next of [null, undefined, {}, { amount: 0, currency: 'usd' }, { amount: 100 }, { amount: null, currency: 'usd' }]) {
    const l = planLines({ plan: TRIAL, role: 'owner', next });
    assert.equal(l.state, 'trial');
    assert.equal(l.text, '15 seats, billed monthly, renewing November 29, 2026.');
  }
  const noDate = planLines({ plan: { ...TRIAL, renewsAt: null, interval: 'year' }, role: 'owner' });
  assert.equal(noDate.text, '15 seats, billed yearly.');
});

test('a trialing status without a trial end is not a trial', () => {
  const l = planLines({ plan: { ...TRIAL, trialEndsAt: null }, role: 'owner', next: NEXT });
  assert.equal(l.state, 'renewing');
  assert.equal(l.badge, null);
});

test('renewing with the next charge known: seats, interval, amount and date', () => {
  const l = planLines({ plan: ACTIVE, role: 'admin', next: NEXT });
  assert.equal(l.state, 'renewing');
  assert.equal(l.badge, null);
  assert.equal(l.keep, false);
  assert.equal(l.text, '17 seats, billed monthly. The next charge is $425 on December 29.');
  assert.equal(
    planLines({ plan: { ...ACTIVE, interval: 'year' }, role: 'owner', next: { amount: 408000, currency: 'usd', date: at(12, 29) } }).text,
    '17 seats, billed yearly. The next charge is $4,080 on December 29.',
  );
});

test('renewing: the next date falls back to the plan renewal, and without an amount to today\'s wording', () => {
  assert.equal(
    planLines({ plan: ACTIVE, role: 'owner', next: { amount: 42500, currency: 'usd', date: null } }).text,
    '17 seats, billed monthly. The next charge is $425 on December 29.',
  );
  const none = planLines({ plan: ACTIVE, role: 'owner', next: null });
  assert.equal(none.state, 'plain');
  assert.equal(none.text, '17 seats, billed monthly, renewing December 29, 2026.');
  assert.equal(planLines({ plan: { ...ACTIVE, interval: 'year' }, role: 'owner' }).text, '17 seats, billed yearly, renewing December 29, 2026.');
  // An amount with no date anywhere says nothing it can't back up.
  assert.equal(
    planLines({ plan: { ...ACTIVE, renewsAt: null }, role: 'owner', next: { amount: 42500, currency: 'usd', date: null } }).text,
    '17 seats, billed monthly.',
  );
});

test('ending at the period end: the owner can keep the team, an admin is told who ended it', () => {
  const plan = { ...ACTIVE, cancelAtPeriodEnd: true };
  const owner = planLines({ plan, role: 'owner', next: NEXT });
  assert.equal(owner.state, 'ending');
  assert.equal(owner.badge, 'Ends Dec 29');
  assert.equal(
    owner.text,
    'The team ends on December 29, and nothing more is charged. Its workspaces then become yours, and everyone in them keeps what they had.',
  );
  assert.equal(owner.keep, true);

  const admin = planLines({ plan, role: 'admin', ownerName: 'Alex' });
  assert.equal(admin.state, 'ending');
  assert.equal(admin.text, 'Alex ended the plan. The team ends on December 29, and its workspaces become Alex’s.');
  assert.equal(admin.keep, false);

  const unnamed = planLines({ plan, role: 'admin', ownerName: null });
  assert.equal(unnamed.text, 'The owner ended the plan. The team ends on December 29, and its workspaces become the owner’s.');
  assert.equal(unnamed.keep, false);
});

test('ending wins over a trial, and needs the date to say anything', () => {
  const l = planLines({ plan: { ...TRIAL, cancelAtPeriodEnd: true }, role: 'owner', next: { amount: 37500, currency: 'usd' } });
  assert.equal(l.state, 'ending');
  assert.equal(l.keep, true);
  const noDate = planLines({ plan: { ...ACTIVE, cancelAtPeriodEnd: true, renewsAt: null }, role: 'owner' });
  assert.equal(noDate.state, 'plain');
  assert.equal(noDate.keep, false);
});

test('auto-add lines: only in auto mode, with the count the server sent', () => {
  assert.equal(autoAddLines(null), null);
  assert.equal(autoAddLines({ mode: 'ask', monthlyLimit: 5, addedThisMonth: 2 }), null);
  assert.equal(autoAddLines({ mode: 'auto', monthlyLimit: 5, addedThisMonth: null }), null);
  assert.deepEqual(autoAddLines({ mode: 'auto', monthlyLimit: 5, addedThisMonth: 2 }), {
    added: '2 added this month', left: '3 more before it asks first.',
  });
  assert.deepEqual(autoAddLines({ mode: 'auto', monthlyLimit: null, addedThisMonth: 0 }), {
    added: '0 added this month', left: null,
  });
  // At or past the limit it already asks first: zero left, never negative.
  assert.equal(autoAddLines({ mode: 'auto', monthlyLimit: 2, addedThisMonth: 4 }).left, '0 more before it asks first.');
});

test('brandName: Stripe brand ids as names, anything else capitalised', () => {
  assert.equal(brandName('visa'), 'Visa');
  assert.equal(brandName('mastercard'), 'Mastercard');
  assert.equal(brandName('amex'), 'American Express');
  assert.equal(brandName('discover'), 'Discover');
  assert.equal(brandName('jcb'), 'JCB');
  assert.equal(brandName('link'), 'Link');
  assert.equal(brandName('sepa_debit'), 'Sepa debit');
  assert.equal(brandName('VISA'), 'Visa');
  assert.equal(brandName('unknown'), null);
  assert.equal(brandName(null), null);
});

test('cardLines: a card, a method that is not a card, and nothing', () => {
  const card = { brand: 'visa', last4: '4242', expMonth: 8, expYear: 2028 };
  assert.deepEqual(cardLines(card, { canChange: true }), { title: 'Visa ending 4242', sub: 'Expires 08/28' });
  assert.deepEqual(cardLines(card, { canChange: false, ownerName: 'Alex' }), {
    title: 'Visa ending 4242', sub: 'Expires 08/28 · only Alex changes the card',
  });
  assert.equal(cardLines(card, { canChange: false }).sub, 'Expires 08/28 · only the owner changes the card');
  assert.equal(cardLines({ ...card, expYear: 2105, expMonth: 12 }, { canChange: true }).sub, 'Expires 12/05');
  // A method that is not a card: just its type.
  assert.deepEqual(cardLines({ brand: 'link', last4: null, expMonth: null, expYear: null }, { canChange: true }), { title: 'Link', sub: null });
  assert.equal(cardLines({ brand: 'unknown', last4: '0001', expMonth: 1, expYear: 2030 }, { canChange: true }).title, 'Card ending 0001');
  assert.equal(cardLines(card, { canChange: true }).title, 'Visa ending 4242');
  assert.equal(cardLines({ ...card, expMonth: null }, { canChange: false, ownerName: 'Alex' }).sub, null);
  assert.equal(cardLines(null), null);
  assert.equal(cardLines({ brand: null, last4: null }), null);
});

test('receiptRows: date, amount with cents, status and a Stripe link only when https', () => {
  const rows = receiptRows([
    { id: 'in_1', number: 'A-2', date: at(12, 12), amount: 4167, currency: 'usd', status: 'paid', url: 'https://invoice.stripe.com/i/1' },
    { id: 'in_2', number: 'A-1', date: at(11, 29, 2025), amount: 37500, currency: 'usd', status: 'open', url: null },
    { id: 'in_3', date: at(10, 1), amount: 100, currency: 'usd', status: 'uncollectible', url: 'javascript:alert(1)' },
    { date: at(9, 1), amount: null, currency: 'usd', status: 'void', url: 'http://x.test' },
  ], NOW);
  assert.deepEqual(rows.map((r) => [r.key, r.date, r.amount, r.status, r.url]), [
    ['in_1', 'Dec 12', '$41.67', 'Paid', 'https://invoice.stripe.com/i/1'],
    ['in_2', 'Nov 29, 2025', '$375.00', 'Open', null],
    ['in_3', 'Oct 1', '$1.00', 'Not paid', null],
    ['3', 'Sep 1', '', null, null],
  ]);
  assert.deepEqual(receiptRows(undefined, NOW), []);
});

test('noReceiptsLine: in a trial, when the first one comes', () => {
  assert.equal(noReceiptsLine(TRIAL), 'None yet. The first comes on November 29.');
  assert.equal(noReceiptsLine(ACTIVE), 'None yet.');
  assert.equal(noReceiptsLine(null), 'None yet.');
});
