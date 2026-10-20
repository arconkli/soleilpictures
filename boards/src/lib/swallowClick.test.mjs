// lib/swallowClick.js: the click a finger raises on letting go of a hold that
// opened a menu is eaten — that one, and nothing after it.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { swallowNextClick } from './swallowClick.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
  mock.timers.enable({ apis: ['setTimeout'] });
});
afterEach(() => {
  mock.timers.reset();
  delete globalThis.window;
});

// Fires `type` at the window; true when something ate it.
const fire = (type) => {
  const ev = new Event(type, { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
};

test('after letting go: the mousedown, mouseup and click are eaten, then nothing more', () => {
  swallowNextClick();
  assert.equal(fire('mousedown'), true);
  assert.equal(fire('mouseup'), true);
  assert.equal(fire('click'), true);
  assert.equal(fire('click'), false);
  assert.equal(fire('mousedown'), false);
});

test('a click that never comes stops being waited for', () => {
  swallowNextClick();
  mock.timers.tick(601);
  assert.equal(fire('click'), false);
});

test('the next press clears it (Android ends a long press with no click)', () => {
  swallowNextClick();
  fire('pointerdown');
  assert.equal(fire('click'), false);
});

test('held: the click is waited for however long the finger stays down', () => {
  swallowNextClick({ held: true });
  mock.timers.tick(5000);
  fire('pointerup');
  assert.equal(fire('click'), true);
  assert.equal(fire('click'), false);
});

test('held: once the finger lifts, the wait is the usual one', () => {
  swallowNextClick({ held: true });
  mock.timers.tick(3000);
  fire('pointerup');
  mock.timers.tick(601);
  assert.equal(fire('click'), false);
});

test('held: a finger that never lifts lets go of the trap eventually', () => {
  swallowNextClick({ held: true });
  mock.timers.tick(15001);
  assert.equal(fire('click'), false);
});
