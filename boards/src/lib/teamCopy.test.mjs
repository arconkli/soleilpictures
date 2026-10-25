// teamCopy: a line for every refusal the page can meet, and the seat price
// line built only from the preview's numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEAM_HINT } from './teamHints.js';
import { refusalLine, successLine, seatPriceLine, domainCheckLine } from './teamCopy.js';

const DEFAULT = refusalLine({ code: 'nonsense' });

test('every TEAM_HINT has its own line', () => {
  for (const h of Object.values(TEAM_HINT)) {
    const line = refusalLine({ code: h });
    assert.notEqual(line, DEFAULT, `${h} falls to the default`);
    assert.ok(line.length > 8 && !line.includes('!'));
  }
});

test('the team-billing and domain-check codes have lines', () => {
  for (const c of ['not_available', 'price_mismatch', 'stale_preview', 'stripe_error', 'no_plan', 'no_seat_item',
    'retry', 'network', 'auth required', 'not_yet', 'unsupported', 'too_many', 'team_domain_missing']) {
    assert.notEqual(refusalLine({ code: c }), DEFAULT, c);
  }
});

test('the default, and a missing refusal', () => {
  assert.equal(DEFAULT, 'That didn’t work. Try again.');
  assert.equal(refusalLine(null), DEFAULT);
  assert.equal(refusalLine({ code: 'toString' }), DEFAULT);
});

test('team_seats_needed names the shortfall when it has one', () => {
  assert.equal(refusalLine({ code: 'team_seats_needed', needed: 1 }), 'That needs 1 more seat.');
  assert.equal(refusalLine({ code: 'team_seats_needed', needed: 3 }), 'That needs 3 more seats.');
  assert.equal(refusalLine({ code: 'team_seats_needed', needed: null }), 'That needs more seats than the team has.');
});

test('a paying preview names the unit and today, from the preview', () => {
  const line = seatPriceLine({ ok: true, seats: 6, from_seats: 5, unit_amount: 1500, interval: 'month', amount_today: 825, proration_date: 1 });
  assert.equal(line, '1 seat at $15 a month, $8.25 today.');
  const two = seatPriceLine({ ok: true, seats: 7, from_seats: 5, unit_amount: 14400, interval: 'year', amount_today: 20000, proration_date: 1 });
  assert.equal(two, '2 seats at $144 a year each, $200 today.');
});

test('a trialing preview charges nothing and names the trial end', () => {
  const end = Date.UTC(2026, 10, 12, 12) / 1000;
  const line = seatPriceLine({ ok: true, seats: 4, from_seats: 3, unit_amount: 1500, interval: 'month', trialing: true, amount_today: 0, trial_end: end });
  assert.equal(line, '1 seat at $15 a month. Nothing today: your trial ends November 12, 2026.');
  assert.ok(!/today\./.test(line.replace('Nothing today', '')));
});

test('success lines are short and plain', () => {
  for (const t of ['rename', 'close', 'leave', 'addSeats', 'newLink', 'nonsense']) {
    const s = successLine(t);
    assert.ok(s.length > 3 && !s.includes('!'), t);
  }
  assert.match(domainCheckLine({ verified: true }, 'a.com'), /verified/);
  assert.match(domainCheckLine({ verified: false }, 'a.com'), /isn’t verified/);
});
