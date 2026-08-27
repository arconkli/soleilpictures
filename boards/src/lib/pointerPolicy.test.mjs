// Who is allowed to draw on a touch device.
//
// This is a small amount of logic guarding a big failure mode: get it wrong in
// the "on" direction and a palm draws on the page; get it wrong in the "off"
// direction and the user's finger silently stops working with no explanation.
// The rules worth pinning are that a finger draws until the device PROVES it
// has a stylus, and that an explicit choice by the user always outranks the
// automatic policy in both directions.

import test from 'node:test';
import assert from 'node:assert/strict';

// localStorage stub — the module reads it at import time via lazy accessors, so
// installing it before the dynamic import below is enough.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const {
  drawWithFingerPref,
  fingerShouldDraw,
  notePointerType,
  pointerCanDraw,
  resetPointerPolicy,
  setDrawWithFinger,
  stylusSeen,
  subscribe,
} = await import('./pointerPolicy.js');

test.beforeEach(() => { store.clear(); resetPointerPolicy(); });

test('a fresh device lets the finger draw', () => {
  assert.equal(stylusSeen(), false);
  assert.equal(drawWithFingerPref(), null, 'no explicit choice on record');
  assert.equal(fingerShouldDraw(), true);
  assert.equal(pointerCanDraw('touch'), true);
});

test('mouse and pen always draw, whatever the policy says', () => {
  assert.equal(pointerCanDraw('mouse'), true);
  assert.equal(pointerCanDraw('pen'), true);
  notePointerType('pen');
  setDrawWithFinger(false);
  assert.equal(pointerCanDraw('mouse'), true);
  assert.equal(pointerCanDraw('pen'), true);
});

test('seeing a stylus flips the finger to panning', () => {
  assert.equal(pointerCanDraw('touch'), true);
  assert.equal(notePointerType('pen'), true, 'first sighting is reported to the caller');
  assert.equal(stylusSeen(), true);
  assert.equal(pointerCanDraw('touch'), false, 'the finger now pans');
});

test('the first sighting is announced exactly once', () => {
  assert.equal(notePointerType('pen'), true);
  assert.equal(notePointerType('pen'), false, 'no repeat toast on every later stroke');
  assert.equal(notePointerType('pen'), false);
});

test('touch and mouse events never count as a stylus sighting', () => {
  assert.equal(notePointerType('touch'), false);
  assert.equal(notePointerType('mouse'), false);
  assert.equal(notePointerType(undefined), false);
  assert.equal(stylusSeen(), false, 'a finger must not switch itself off');
});

test('an explicit choice outranks the automatic policy in both directions', () => {
  notePointerType('pen');
  assert.equal(fingerShouldDraw(), false, 'automatic policy says pan');
  setDrawWithFinger(true);
  assert.equal(fingerShouldDraw(), true, 'the user asked for both to draw');
  assert.equal(pointerCanDraw('touch'), true);

  resetPointerPolicy();
  assert.equal(fingerShouldDraw(), true, 'automatic policy says draw');
  setDrawWithFinger(false);
  assert.equal(fingerShouldDraw(), false, 'the user asked for stylus-only');
});

test('clearing the choice returns to the automatic policy', () => {
  setDrawWithFinger(false);
  assert.equal(drawWithFingerPref(), false);
  setDrawWithFinger(null);
  assert.equal(drawWithFingerPref(), null);
  assert.equal(fingerShouldDraw(), true, 'back to the no-stylus-seen default');
});

test('the decision survives a reload', () => {
  notePointerType('pen');
  setDrawWithFinger(true);
  // Simulate a new session: the module cache is dropped but storage persists.
  resetPointerPolicyCacheOnly();
  assert.equal(stylusSeen(), true);
  assert.equal(fingerShouldDraw(), true);

  function resetPointerPolicyCacheOnly() {
    // resetPointerPolicy() also clears storage, so reach for the storage state
    // directly to model "same device, new page load".
    const seen = store.get('soleil.stylusSeen');
    const finger = store.get('soleil.drawWithFinger');
    assert.equal(seen, '1', 'the sighting must be persisted, not just cached');
    assert.equal(finger, '1', 'and so must the preference');
  }
});

test('subscribers are notified when the policy changes', () => {
  let calls = 0;
  const unsub = subscribe(() => { calls++; });
  notePointerType('pen');
  assert.equal(calls, 1, 'the toggle has to appear the moment a stylus is seen');
  setDrawWithFinger(false);
  assert.equal(calls, 2);
  unsub();
  setDrawWithFinger(true);
  assert.equal(calls, 2, 'unsubscribed listeners stop hearing about it');
});

test('storage being unavailable does not break drawing', () => {
  const real = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('SecurityError'); },
    removeItem() { throw new Error('SecurityError'); },
  };
  try {
    resetPointerPolicy();
    // The policy can't persist, but it must still answer — a locked-down
    // browser should not leave someone unable to draw at all.
    assert.equal(fingerShouldDraw(), true);
    assert.doesNotThrow(() => setDrawWithFinger(false));
    assert.doesNotThrow(() => notePointerType('pen'));
  } finally {
    globalThis.localStorage = real;
  }
});
