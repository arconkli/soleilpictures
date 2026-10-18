import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parkWhileHidden, PARK_AFTER_MS } from './partyPark.js';

function fakePage(state = 'visible') {
  const listeners = new Set();
  return {
    visibilityState: state,
    addEventListener: (ev, fn) => { if (ev === 'visibilitychange') listeners.add(fn); },
    removeEventListener: (ev, fn) => listeners.delete(fn),
    set(state2) { this.visibilityState = state2; for (const fn of [...listeners]) fn(); },
    get listeners() { return listeners.size; },
  };
}
function fakeTimers() {
  const pending = new Set();
  return {
    setTimer: (fn, ms) => { const t = { fn, ms }; pending.add(t); return t; },
    clearTimer: (t) => pending.delete(t),
    fire() { for (const t of [...pending]) { pending.delete(t); t.fn(); } },
    get count() { return pending.size; },
  };
}

test('a tab hidden long enough parks, and unparks the moment it is shown', () => {
  const page = fakePage();
  const timers = fakeTimers();
  const calls = [];
  const p = parkWhileHidden({ park: () => calls.push('park'), unpark: () => calls.push('unpark'), doc: page, ...timers });
  page.set('hidden');
  assert.equal(timers.count, 1);
  timers.fire();
  assert.deepEqual(calls, ['park']);
  assert.equal(p.isParked(), true);
  page.set('visible');
  assert.deepEqual(calls, ['park', 'unpark']);
  assert.equal(p.isParked(), false);
});

test('coming back before the delay parks nothing', () => {
  const page = fakePage();
  const timers = fakeTimers();
  const calls = [];
  parkWhileHidden({ park: () => calls.push('park'), unpark: () => calls.push('unpark'), doc: page, ...timers });
  page.set('hidden');
  page.set('visible');
  assert.equal(timers.count, 0);
  timers.fire();
  assert.deepEqual(calls, []);
});

test('a tab that starts hidden stays connected until it has been shown', () => {
  const page = fakePage('hidden');
  const timers = fakeTimers();
  const calls = [];
  parkWhileHidden({ park: () => calls.push('park'), unpark: () => calls.push('unpark'), doc: page, ...timers });
  assert.equal(timers.count, 0);
  timers.fire();
  assert.deepEqual(calls, []);
});

test('dispose stops listening and cancels a pending park', () => {
  const page = fakePage();
  const timers = fakeTimers();
  const calls = [];
  const p = parkWhileHidden({ park: () => calls.push('park'), unpark: () => calls.push('unpark'), doc: page, ...timers });
  page.set('hidden');
  p.dispose();
  assert.equal(timers.count, 0);
  assert.equal(page.listeners, 0);
  assert.deepEqual(calls, []);
});

test('the default delay is five minutes', () => {
  assert.equal(PARK_AFTER_MS, 5 * 60_000);
});

test('both party clients park, and nothing reconnects a parked socket behind its back', () => {
  const y = readFileSync(new URL('./yPartyKit.js', import.meta.url), 'utf8');
  assert.match(y, /parkWhileHidden\(\{/);
  assert.match(y, /refresh: \(\) => \{\s*if \(destroyed \|\| parking\.isParked\(\)\) return;/);
  assert.match(y, /parking\.dispose\(\)/);
  const w = readFileSync(new URL('./workspacePartyKit.js', import.meta.url), 'utf8');
  assert.match(w, /parkWhileHidden\(\{/);
  assert.match(w, /event === 'SIGNED_IN' && !parking\.isParked\(\)/);
  assert.match(w, /parking\.dispose\(\)/);
});
