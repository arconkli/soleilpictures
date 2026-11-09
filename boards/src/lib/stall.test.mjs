import test from 'node:test';
import assert from 'node:assert/strict';
import { stallStage, stallStart } from './stall.js';

test('stallStage steps at 8 s and 15 s', () => {
  assert.equal(stallStage(0), 0);
  assert.equal(stallStage(7999), 0);
  assert.equal(stallStage(8000), 1);
  assert.equal(stallStage(14999), 1);
  assert.equal(stallStage(15000), 2);
  assert.equal(stallStage(60000), 2);
});

test('stallStage takes custom steps', () => {
  assert.equal(stallStage(500, [1000]), 0);
  assert.equal(stallStage(1000, [1000]), 1);
});

test('the page splash still present: the wait began at the page start', () => {
  assert.equal(stallStart({ bootSplashPresent: true, live: 1, now: 5000, endedAt: null, sharedStart: 300 }), 0);
});

test('another screen mounted: share its start', () => {
  assert.equal(stallStart({ bootSplashPresent: false, live: 1, now: 5000, endedAt: null, sharedStart: 300 }), 300);
});

test('last one unmounted under 1 s ago: share its start', () => {
  assert.equal(stallStart({ bootSplashPresent: false, live: 0, now: 5000, endedAt: 4500, sharedStart: 300 }), 300);
});

test('last one unmounted 1 s or more ago: a new wait', () => {
  assert.equal(stallStart({ bootSplashPresent: false, live: 0, now: 5000, endedAt: 4000, sharedStart: 300 }), 5000);
});

test('nothing shared: a new wait', () => {
  assert.equal(stallStart({ bootSplashPresent: false, live: 0, now: 5000, endedAt: null, sharedStart: null }), 5000);
});
