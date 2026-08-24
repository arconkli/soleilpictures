// The frustration detector, and — more importantly — what it must NOT fire on.
//
// A nudge that interrupts people who are perfectly happy is worse than no nudge
// at all, and the naive signal ("lots of hard scrolling") is indistinguishable
// from someone deliberately panning down a long board. The whole design rests
// on reversals, so the negative cases below are the real test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { trackWheelFrustration, freshWheelState, WHEEL_FRUSTRATION } from './wheelHint.js';

const D = WHEEL_FRUSTRATION.MIN_DELTA + 10;

// Feed a sequence of deltaY values at `step` ms apart; return how many fired.
function run(deltas, { step = 120, mods = {} } = {}) {
  let state = freshWheelState();
  let fires = 0;
  deltas.forEach((deltaY, i) => {
    const out = trackWheelFrustration(state, { t: i * step, deltaY, deltaX: 0, ...mods });
    state = out.state;
    if (out.fire) fires += 1;
  });
  return fires;
}

test('down-up-down-up fires once', () => {
  assert.equal(run([D, -D, D, -D]), 1);
});

test('deliberate panning in one direction never fires', () => {
  // The case that matters most: someone navigating a tall board. Twenty hard
  // scrolls, no reversals, no nudge.
  assert.equal(run(Array(20).fill(D)), 0);
  assert.equal(run(Array(20).fill(-D)), 0);
});

test('a single correction is not a fight', () => {
  // Overshooting and scrolling back once is normal navigation.
  assert.equal(run([D, D, D, -D, -D]), 0);
});

test('reversals spread beyond the window do not accumulate', () => {
  // Same four events, one per second — someone reading, not fighting.
  assert.equal(run([D, -D, D, -D], { step: WHEEL_FRUSTRATION.WINDOW_MS + 50 }), 0);
});

test('holding a modifier resets — they already found the zoom gesture', () => {
  for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
    assert.equal(run([D, -D, D, -D], { mods: { [mod]: true } }), 0, `${mod} should reset`);
  }
});

test('a modifier mid-run wipes the run rather than being skipped', () => {
  let state = freshWheelState();
  let fired = false;
  const seq = [
    { deltaY: D },
    { deltaY: -D },
    { deltaY: D, ctrlKey: true },   // they reached for zoom — the fight is over
    { deltaY: -D },
    { deltaY: D },
  ];
  seq.forEach((ev, i) => {
    const out = trackWheelFrustration(state, { t: i * 100, deltaX: 0, ...ev });
    state = out.state;
    fired = fired || out.fire;
  });
  assert.equal(fired, false);
});

test('trackpad drift and inertia tails are below the floor and reset', () => {
  const tiny = WHEEL_FRUSTRATION.MIN_DELTA - 1;
  assert.equal(run([tiny, -tiny, tiny, -tiny, tiny, -tiny]), 0);
});

test('a horizontal swipe is not a vertical fight', () => {
  let state = freshWheelState();
  let fired = false;
  for (let i = 0; i < 8; i++) {
    const out = trackWheelFrustration(state, { t: i * 100, deltaX: (i % 2 ? D : -D) * 3, deltaY: i % 2 ? D : -D });
    state = out.state;
    fired = fired || out.fire;
  }
  assert.equal(fired, false);
});

test('firing consumes the run — no repeat on the next event', () => {
  // Without consuming, an armed state re-fires on every subsequent reversal and
  // the "once ever" guard becomes the only thing standing between the user and
  // a toast per scroll.
  assert.equal(run([D, -D, D, -D, D, -D]), 1);
});

test('junk input never throws', () => {
  assert.doesNotThrow(() => trackWheelFrustration(null, null));
  assert.doesNotThrow(() => trackWheelFrustration(undefined, {}));
  assert.equal(trackWheelFrustration(null, null).fire, false);
});
