// Unit tests for the stale-token reconnector policy (lib/partyTokenRefresh.js)
// — the module is pure and dependency-injected, so it runs straight in the
// Playwright Node process with a fake clock/timers: no page, no sockets.

import { expect, test } from '@playwright/test';
import { createStaleTokenReconnector } from '../src/lib/partyTokenRefresh.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function makeHarness(overrides = {}) {
  const h = {
    t: 0,
    timers: [],
    refreshed: 0,
    fresh: 'tok-2',
    lastUsed: 'tok-1',
    connected: false,
    gesture: false,
  };
  h.advance = async (ms) => {
    h.t += ms;
    for (const x of [...h.timers]) {
      if (!x.done && x.at <= h.t) { x.done = true; x.fn(); }
    }
    await tick(); await tick();   // let fire()'s awaits settle
  };
  h.rec = createStaleTokenReconnector({
    getFreshToken: async () => h.fresh,
    getLastUsedToken: () => h.lastUsed,
    isConnected: () => h.connected,
    isGestureActive: () => h.gesture,
    refresh: () => { h.refreshed += 1; },
    now: () => h.t,
    setTimer: (fn, ms) => { const x = { fn, at: h.t + ms, done: false }; h.timers.push(x); return x; },
    clearTimer: (x) => { x.done = true; },
    ...overrides,
  });
  return h;
}

test('connection close with a rotated token fires exactly one refresh cycle', async () => {
  const h = makeHarness();
  h.rec.onConnectionClose();
  h.rec.onConnectionClose();          // back-to-back events coalesce
  h.rec.onAuthEvent();
  await h.advance(750);
  expect(h.refreshed).toBe(1);
});

test('healthy socket: auth events are a no-op', async () => {
  const h = makeHarness();
  h.connected = true;
  h.rec.onAuthEvent();
  await h.advance(750);
  expect(h.refreshed).toBe(0);
});

test('same token: native backoff owns it — no refresh cycle', async () => {
  const h = makeHarness();
  h.fresh = 'tok-1';                  // identical to lastUsed
  h.rec.onConnectionClose();
  await h.advance(750);
  expect(h.refreshed).toBe(0);
});

test('cooldown bounds cycle frequency; a later close re-triggers', async () => {
  const h = makeHarness();
  h.rec.onConnectionClose();
  await h.advance(750);
  expect(h.refreshed).toBe(1);
  h.rec.onConnectionClose();          // inside the 5s cooldown
  await h.advance(750);
  expect(h.refreshed).toBe(1);
  await h.advance(5000);              // past cooldown
  h.rec.onConnectionClose();
  await h.advance(750);
  expect(h.refreshed).toBe(2);
});

test('gesture defers the cycle, bounded — fires once the gesture ends', async () => {
  const h = makeHarness();
  h.gesture = true;
  h.rec.onConnectionClose();
  await h.advance(750);
  expect(h.refreshed).toBe(0);        // deferred, rescheduled
  h.gesture = false;
  await h.advance(250);               // next gesture-retry tick
  expect(h.refreshed).toBe(1);
});

test('endless gesture cannot defer past the bound', async () => {
  const h = makeHarness();
  h.gesture = true;
  h.rec.onConnectionClose();
  await h.advance(750);
  for (let i = 0; i < 10 && h.refreshed === 0; i++) await h.advance(250);
  expect(h.refreshed).toBe(1);        // fired despite the gesture
});

test('board-reset signal sits the reconnector out', async () => {
  const h = makeHarness();
  h.rec.noteResetSignal();
  h.rec.onAuthEvent();
  await h.advance(750);               // still inside the 2s sit-out
  expect(h.refreshed).toBe(0);
  await h.advance(5000);
  h.rec.onConnectionClose();
  await h.advance(750);
  expect(h.refreshed).toBe(1);        // recovers afterwards
});

test('dispose cancels pending work', async () => {
  const h = makeHarness();
  h.rec.onConnectionClose();
  h.rec.dispose();
  await h.advance(750);
  expect(h.refreshed).toBe(0);
});

test('reconnecting while the token check was in flight aborts the cycle', async () => {
  const h = makeHarness({
    getFreshToken: async () => { h.connected = true; return h.fresh; },
  });
  h.rec.onConnectionClose();
  await h.advance(750);
  expect(h.refreshed).toBe(0);        // came back up on its own — leave it be
});
