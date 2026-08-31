// Pure helpers behind the admin Discounts tab. Kept out of the component so the
// copy rule (prices come from billingCopy, never typed) is actually testable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  codeStatus,
  discountPreviewLine,
  generateDiscountCode,
  normalizeDiscountCode,
} from './discountCodes.js';
import { PRICING } from './billingCopy.js';

test('codes normalize to uppercase alphanumerics', () => {
  assert.equal(normalizeDiscountCode(' launch-50 '), 'LAUNCH50');
  assert.equal(normalizeDiscountCode('a_b.c'), 'ABC');
  assert.equal(normalizeDiscountCode(''), '');
  assert.equal(normalizeDiscountCode(null), '');
});

test('generated codes avoid glyphs that are misread aloud', () => {
  const code = generateDiscountCode(12, () => 0.999999);
  assert.equal(code.length, 12);
  assert.match(code, /^[A-Z0-9]+$/);
  // A code read over a phone must not contain I/O/0/1.
  for (let i = 0; i < 200; i++) {
    assert.doesNotMatch(generateDiscountCode(10, Math.random), /[IO01]/);
  }
});

test('the preview line derives every number from PRICING, never a literal', () => {
  const line = discountPreviewLine({ percentOff: 50 });
  const full = PRICING.monthly.perMonth;             // 25
  const first = (full * 0.5).toFixed(2);             // "12.50"
  assert.ok(line.includes(`$${first}`), line);
  assert.ok(line.includes(`$${full}/mo`), line);
  assert.ok(line.includes('Monthly plan only'), line);
});

test('the preview line refuses nonsense percentages', () => {
  assert.equal(discountPreviewLine({ percentOff: 0 }), null);
  assert.equal(discountPreviewLine({ percentOff: 101 }), null);
  assert.equal(discountPreviewLine({ percentOff: NaN }), null);
  assert.equal(discountPreviewLine({}), null);
});

test('a 100% code reads as free, not as "$0.00"', () => {
  assert.ok(discountPreviewLine({ percentOff: 100 }).includes('free'));
});

test('status: deactivated outranks everything', () => {
  assert.equal(codeStatus({ active: false, times_redeemed: 0, max_redemptions: 1 }), 'revoked');
});

test('status: a used-up code reads expired, not active', () => {
  assert.equal(codeStatus({ active: true, times_redeemed: 1, max_redemptions: 1 }), 'expired');
});

test('status: past its expiry is expired', () => {
  const past = new Date('2020-01-01T00:00:00Z').toISOString();
  assert.equal(codeStatus({ active: true, expires_at: past, times_redeemed: 0 }), 'expired');
});

test('status: uncapped and undated is forever', () => {
  assert.equal(codeStatus({ active: true, times_redeemed: 3, max_redemptions: null, expires_at: null }), 'forever');
});

test('status: capped but unspent is active', () => {
  assert.equal(codeStatus({ active: true, times_redeemed: 0, max_redemptions: 5, expires_at: null }), 'active');
});

test('status: a future expiry is still active, not expired', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  assert.equal(codeStatus({ active: true, expires_at: future, times_redeemed: 0, max_redemptions: null }), 'active');
});
