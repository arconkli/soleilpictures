import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRearmOnboarding } from './onboardingTour.js';

test('a seeded, unfinished tour re-arms (mid-tour reload resumes)', () => {
  assert.equal(shouldRearmOnboarding({ seeded: true, done: false, endedThisLoad: false }), true);
  assert.equal(shouldRearmOnboarding({ seeded: true, done: undefined, endedThisLoad: false }), true);
});
test('a tour that ended in this load never re-arms', () => {
  assert.equal(shouldRearmOnboarding({ seeded: true, done: false, endedThisLoad: true }), false);
});
test('server done blocks re-arming', () => {
  assert.equal(shouldRearmOnboarding({ seeded: true, done: true, endedThisLoad: false }), false);
});
test('unseeded never re-arms', () => {
  assert.equal(shouldRearmOnboarding({ seeded: false, done: false, endedThisLoad: false }), false);
  assert.equal(shouldRearmOnboarding({ done: false }), false);
  assert.equal(shouldRearmOnboarding(), false);
});
