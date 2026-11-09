import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LAYOUT_OUTLINES_DOC, layoutOutlinesAnswer, layoutOutlinesAsks, localDateKey, shouldAskLayoutOutlines,
} from './layoutOutlines.js';

const now = Date.parse('2026-11-20T12:00:00Z');
const old = '2026-11-01T00:00:00Z';
const base = { settings: {}, today: '2026-11-20', accountCreatedAt: old, now };

test('answer reads true, false, or null', () => {
  assert.equal(layoutOutlinesAnswer(null), null);
  assert.equal(layoutOutlinesAnswer({}), null);
  assert.equal(layoutOutlinesAnswer({ layout_outlines: {} }), null);
  assert.equal(layoutOutlinesAnswer({ layout_outlines: { ok: true, at: 'x' } }), true);
  assert.equal(layoutOutlinesAnswer({ layout_outlines: { ok: false } }), false);
});

test('asks on a fresh, old-enough account', () => {
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

test('not within 24 hours of signing up, nor when the age is unknown', () => {
  assert.equal(shouldAskLayoutOutlines({ ...base, accountCreatedAt: '2026-11-19T13:00:00Z' }), false);
  assert.equal(shouldAskLayoutOutlines({ ...base, accountCreatedAt: '2026-11-19T11:00:00Z' }), true);
  assert.equal(shouldAskLayoutOutlines({ ...base, accountCreatedAt: null }), false);
  assert.equal(shouldAskLayoutOutlines({ ...base, accountCreatedAt: 'nonsense' }), false);
});

test('asks counter tolerates junk', () => {
  assert.deepEqual(layoutOutlinesAsks({ layout_outlines_asks: { n: 'x', last: 5 } }), { n: 0, last: null });
  assert.deepEqual(layoutOutlinesAsks(undefined), { n: 0, last: null });
});

test('local date key and doc link', () => {
  assert.equal(localDateKey(new Date(2026, 10, 3)), '2026-11-03');
  assert.equal(LAYOUT_OUTLINES_DOC, '/docs/account/data-and-privacy#layout-outlines');
});
