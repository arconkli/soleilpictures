import test from 'node:test';
import assert from 'node:assert/strict';
import { stepUp, stepDown, FONT_SIZE_STEPS } from './fontSizeSteps.js';

test('steps go to the neighbouring step', () => {
  assert.equal(stepUp(15), 18);
  assert.equal(stepDown(15), 13);
  assert.equal(stepUp(11), 13);
  assert.equal(stepDown(64), 48);
});

test('a size between steps goes to the neighbouring step', () => {
  assert.equal(stepUp(14), 15);
  assert.equal(stepDown(14), 13);
  assert.equal(stepUp(100), 128);
  assert.equal(stepDown(100), 96);
});

test('nothing changes at the ends', () => {
  assert.equal(stepUp(200), 200);
  assert.equal(stepDown(6), 6);
  assert.equal(stepUp(250), 250);
  assert.equal(stepDown(3), 3);
});

test('15 to 64 takes five clicks', () => {
  let n = 15, clicks = 0;
  while (n < 64) { n = stepUp(n); clicks++; }
  assert.equal(clicks, 5);
});

test('the ladder spans the size box clamp', () => {
  assert.equal(FONT_SIZE_STEPS[0], 6);
  assert.equal(FONT_SIZE_STEPS.at(-1), 200);
});
