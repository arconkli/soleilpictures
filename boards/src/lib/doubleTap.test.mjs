import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swallowGhostClick, tapIsDouble } from './doubleTap.js';

// A stand-in window: an EventTarget that the helper listens on, and mouse
// events carrying a position, as the browser's compat events do.
function fakeWindow() {
  globalThis.window = new EventTarget();
  return globalThis.window;
}
function mouse(type, x, y) {
  const ev = new Event(type, { cancelable: true });
  Object.defineProperty(ev, 'clientX', { value: x });
  Object.defineProperty(ev, 'clientY', { value: y });
  return ev;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('swallowGhostClick: the tap\'s mousedown, mouseup, click and dblclick near the point are swallowed', () => {
  const win = fakeWindow();
  const stop = swallowGhostClick({ x: 100, y: 200 });
  for (const type of ['mousedown', 'mouseup', 'click', 'dblclick']) {
    const ev = mouse(type, 104, 197);
    win.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, true, type);
  }
  stop();
});

test('swallowGhostClick: a click somewhere else is left alone', () => {
  const win = fakeWindow();
  const stop = swallowGhostClick({ x: 100, y: 200 });
  const far = mouse('click', 180, 200);
  win.dispatchEvent(far);
  assert.equal(far.defaultPrevented, false);
  stop();
});

test('swallowGhostClick: only the one tap — a second click there goes through', () => {
  const win = fakeWindow();
  const stop = swallowGhostClick({ x: 100, y: 200 });
  const first = mouse('click', 100, 200);
  const second = mouse('click', 100, 200);
  win.dispatchEvent(first);
  win.dispatchEvent(second);
  assert.equal(first.defaultPrevented, true);
  assert.equal(second.defaultPrevented, false);
  stop();
});

test('swallowGhostClick: once its time is up it swallows nothing', async () => {
  const win = fakeWindow();
  swallowGhostClick({ x: 100, y: 200 }, { ms: 20 });
  await sleep(40);
  const late = mouse('click', 100, 200);
  win.dispatchEvent(late);
  assert.equal(late.defaultPrevented, false);
});

test('swallowGhostClick: stopping early lets the next click through', () => {
  const win = fakeWindow();
  const stop = swallowGhostClick({ x: 100, y: 200 });
  stop();
  const ev = mouse('click', 100, 200);
  win.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, false);
});

test('tapIsDouble: two taps on the same key pair; a tap on another key starts over', () => {
  const ref = { current: {} };
  const tapAt = (t, key) => tapIsDouble(ref, { timeStamp: t, clientX: 50, clientY: 50 }, { key });
  assert.equal(tapAt(1000, 'a'), false);
  assert.equal(tapAt(1100, 'b'), false);   // a different card: not a pair
  assert.equal(tapAt(1200, 'b'), true);
  assert.equal(tapAt(1300, 'b'), false);   // the pair is spent
});
