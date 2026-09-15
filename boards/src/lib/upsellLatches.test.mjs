// upsellLatches.test.mjs — node --test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  priceSeen, markPriceSeen, nearCapWarnedAt, markNearCapWarned,
  PRICE_SEEN_KEY, NEAR_CAP_KEY, __resetUpsellLatches,
} from './upsellLatches.js';

// The in-memory fallback is module state, so each case starts from a fresh
// device or it inherits the previous one's claims.
beforeEach(() => __resetUpsellLatches());

function mem() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    _m: m,
  };
}
const throwing = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

test('priceSeen: unseen until marked, and only the FIRST mark reports true', () => {
  const s = mem();
  assert.equal(priceSeen('u1', s), false);
  assert.equal(markPriceSeen('u1', 'chip', s), true);
  assert.equal(priceSeen('u1', s), true);
  assert.equal(markPriceSeen('u1', 'banner', s), false, 'a second surface does not re-report');
  const stamped = JSON.parse(s.getItem(PRICE_SEEN_KEY('u1')));
  assert.equal(stamped.surface, 'chip', 'the first surface wins the stamp');
  assert.ok(!Number.isNaN(Date.parse(stamped.at)));
});

test('priceSeen is per account', () => {
  const s = mem();
  markPriceSeen('u1', 'chip', s);
  assert.equal(priceSeen('u2', s), false);
});

test('nearCapWarned: 0 for never, then the limit, re-armed by a different limit', () => {
  const s = mem();
  assert.equal(nearCapWarnedAt('u1', s), 0);
  markNearCapWarned('u1', 50, s);
  assert.equal(nearCapWarnedAt('u1', s), 50);
  assert.equal(s.getItem(NEAR_CAP_KEY('u1')), '50');
  markNearCapWarned('u1', 75, s);
  assert.equal(nearCapWarnedAt('u1', s), 75, 'a raised cap replaces the latch');
});

test('junk never writes and never throws', () => {
  const s = mem();
  markNearCapWarned('u1', 0, s);
  markNearCapWarned('u1', NaN, s);
  markNearCapWarned('u1', -5, s);
  markNearCapWarned(null, 50, s);
  assert.equal(s._m.size, 0);
  assert.equal(markPriceSeen(null, 'chip', s), false);
  assert.equal(markPriceSeen('', 'chip', s), false);
  assert.equal(s._m.size, 0);
  assert.equal(priceSeen(undefined, s), false);
  assert.equal(nearCapWarnedAt(undefined, s), 0);
});

test('a throwing storage never throws, and the latch still holds for the page', () => {
  assert.equal(priceSeen('u1', throwing), false);
  assert.equal(nearCapWarnedAt('u1', throwing), 0);
  assert.doesNotThrow(() => markNearCapWarned('u1', 50, throwing));
  // The durable write is swallowed, but the in-memory claim survives: without
  // it every call reports a first impression, so the caller fires an analytics
  // row and a profile write on each render pass.
  assert.equal(markPriceSeen('u1', 'chip', throwing), true, 'first call claims it');
  assert.equal(markPriceSeen('u1', 'chip', throwing), false, 'and the claim holds');
  assert.equal(priceSeen('u1', throwing), true);
  assert.equal(nearCapWarnedAt('u1', throwing), 50, 'the ceiling is remembered in memory too');
});

test('a corrupt latch value reads as never', () => {
  const s = mem();
  s.setItem(NEAR_CAP_KEY('u1'), 'fifty');
  assert.equal(nearCapWarnedAt('u1', s), 0);
});
