import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LAYOUT_OUTLINES_DOC, LAYOUT_OUTLINES_TERMS, MIN_ACCOUNT_AGE_MS, MIN_CARDS, layoutOutlinesAnswer, layoutOutlinesAsks, localDateKey, shouldAskLayoutOutlines,
} from './layoutOutlines.js';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const MIN = 60 * 1000;
const H = 60 * MIN;
// A brand-new account with 3 cards: only the card rule can pass it.
const base = { settings: {}, today: '2026-11-20', cards: 3, accountCreatedAt: ago(MIN), now: NOW };

test('answer reads true, false, or null', () => {
  assert.equal(layoutOutlinesAnswer(null), null);
  assert.equal(layoutOutlinesAnswer({}), null);
  assert.equal(layoutOutlinesAnswer({ layout_outlines: {} }), null);
  assert.equal(layoutOutlinesAnswer({ layout_outlines: { ok: true, at: 'x' } }), true);
  assert.equal(layoutOutlinesAnswer({ layout_outlines: { ok: false } }), false);
});

test('asks once 3 cards are placed, even on the day the account was made', () => {
  assert.equal(shouldAskLayoutOutlines(base), true);
});

test('never once answered, either way', () => {
  assert.equal(shouldAskLayoutOutlines({ ...base, settings: { layout_outlines: { ok: true } } }), false);
  assert.equal(shouldAskLayoutOutlines({ ...base, settings: { layout_outlines: { ok: false } } }), false);
});

test('at most three asks, and not twice in a day', () => {
  const asks = (n, last) => ({ settings: { layout_outlines_asks: { n, last } } });
  assert.equal(shouldAskLayoutOutlines({ ...base, ...asks(2, '2026-11-19') }), true);
  assert.equal(shouldAskLayoutOutlines({ ...base, ...asks(3, '2026-11-19') }), false);
  assert.equal(shouldAskLayoutOutlines({ ...base, ...asks(1, '2026-11-20') }), false);
});

test('not before 3 cards on a new account, nor when the count cannot be read', () => {
  assert.equal(MIN_CARDS, 3);
  for (const cards of [undefined, null, NaN, 'x', 0, 2]) {
    assert.equal(shouldAskLayoutOutlines({ ...base, cards }), false);
  }
  assert.equal(shouldAskLayoutOutlines({ ...base, cards: 3 }), true);
  assert.equal(shouldAskLayoutOutlines({ ...base, cards: 40 }), true);
});

test('without 3 cards, the ask waits a day after sign-up', () => {
  assert.equal(MIN_ACCOUNT_AGE_MS, 24 * H);
  assert.equal(shouldAskLayoutOutlines({ ...base, cards: 3, accountCreatedAt: ago(MIN) }), true);
  assert.equal(shouldAskLayoutOutlines({ ...base, cards: 2, accountCreatedAt: ago(MIN) }), false);
  assert.equal(shouldAskLayoutOutlines({ ...base, cards: 0, accountCreatedAt: ago(25 * H) }), true);
  assert.equal(shouldAskLayoutOutlines({ ...base, cards: null, accountCreatedAt: ago(23 * H) }), false);
  assert.equal(shouldAskLayoutOutlines({ ...base, cards: null, accountCreatedAt: ago(25 * H) }), true);
});

test('an unreadable count and an unreadable age never asks', () => {
  assert.equal(shouldAskLayoutOutlines({ ...base, cards: undefined, accountCreatedAt: null }), false);
  assert.equal(shouldAskLayoutOutlines({ ...base, cards: NaN, accountCreatedAt: 'garbage' }), false);
});

test('answered, three asks, or asked today never asks, however many cards or old the account', () => {
  const old = { ...base, cards: 40, accountCreatedAt: ago(400 * 24 * H) };
  assert.equal(shouldAskLayoutOutlines(old), true);
  assert.equal(shouldAskLayoutOutlines({ ...old, settings: { layout_outlines: { ok: false } } }), false);
  assert.equal(shouldAskLayoutOutlines({ ...old, settings: { layout_outlines_asks: { n: 3, last: '2026-11-01' } } }), false);
  assert.equal(shouldAskLayoutOutlines({ ...old, settings: { layout_outlines_asks: { n: 1, last: '2026-11-20' } } }), false);
});

test('the terms version is 2', () => {
  assert.equal(LAYOUT_OUTLINES_TERMS, 2);
});

test('asks counter tolerates junk', () => {
  assert.deepEqual(layoutOutlinesAsks({ layout_outlines_asks: { n: 'x', last: 5 } }), { n: 0, last: null });
  assert.deepEqual(layoutOutlinesAsks(undefined), { n: 0, last: null });
});

test('local date key and doc link', () => {
  assert.equal(localDateKey(new Date(2026, 10, 3)), '2026-11-03');
  assert.equal(LAYOUT_OUTLINES_DOC, '/docs/account/data-and-privacy#layout-outlines');
});
