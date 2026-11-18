// tabReturnGap — a minimum gap between tab-return runs.
// Run: node --test src/lib/tabReturnGap.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTabReturnGate, TAB_RETURN_MIN_GAP_MS } from './tabReturnGap.js';

test('the default gap is 60 seconds', () => {
  assert.equal(TAB_RETURN_MIN_GAP_MS, 60_000);
});

test('the first return runs; one inside the gap is skipped; one after it runs', () => {
  let t = 1_000_000;
  const gate = makeTabReturnGate(60_000, () => t);
  assert.equal(gate(), true);
  t += 59_999;
  assert.equal(gate(), false);
  t += 1;
  assert.equal(gate(), true);
});

test('a skipped call does not push the gap out', () => {
  let t = 0;
  const gate = makeTabReturnGate(60_000, () => t);
  assert.equal(gate(), true);
  t = 30_000;
  assert.equal(gate(), false);
  t = 60_000;
  assert.equal(gate(), true);
});

test('a clock at zero still lets the first call run', () => {
  const gate = makeTabReturnGate(60_000, () => 0);
  assert.equal(gate(), true);
  assert.equal(gate(), false);
});

test('gates are independent', () => {
  const now = () => 5;
  const a = makeTabReturnGate(60_000, now);
  const b = makeTabReturnGate(60_000, now);
  assert.equal(a(), true);
  assert.equal(b(), true);
});
