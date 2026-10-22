import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parkWhileHidden, parkWhileIdle, idleParkDue, PARK_AFTER_MS, IDLE_PARK_MS, IDLE_CHECK_MS,
} from './partyPark.js';

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

test('a tab that loads hidden parks too: a background tab, a restored session, a reload while hidden', () => {
  const page = fakePage('hidden');
  const timers = fakeTimers();
  const calls = [];
  const p = parkWhileHidden({ park: () => calls.push('park'), unpark: () => calls.push('unpark'), doc: page, ...timers });
  assert.equal(timers.count, 1);
  timers.fire();
  assert.deepEqual(calls, ['park']);
  page.set('visible');
  assert.deepEqual(calls, ['park', 'unpark']);
  assert.equal(p.isParked(), false);
});

test('a busy page stays connected, and parks once the work is done', () => {
  const page = fakePage('hidden');
  const timers = fakeTimers();
  const calls = [];
  let busy = true;
  parkWhileHidden({ park: () => calls.push('park'), unpark: () => calls.push('unpark'), isBusy: () => busy, doc: page, ...timers });
  timers.fire();
  assert.deepEqual(calls, [], 'an import or upload in flight holds the socket');
  assert.equal(timers.count, 1, 'and it looks again later');
  busy = false;
  timers.fire();
  assert.deepEqual(calls, ['park']);
});

test('a busy check that throws does not keep a tab connected forever', () => {
  const page = fakePage('hidden');
  const timers = fakeTimers();
  const calls = [];
  parkWhileHidden({ park: () => calls.push('park'), unpark() {}, isBusy: () => { throw new Error('x'); }, doc: page, ...timers });
  timers.fire();
  assert.deepEqual(calls, ['park']);
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
  assert.match(y, /refresh: \(\) => \{\s*if \(destroyed \|\| accessEnded \|\| parking\.isParked\(\)\) return;/);
  assert.match(y, /parking\.dispose\(\)/);
  const w = readFileSync(new URL('./workspacePartyKit.js', import.meta.url), 'utf8');
  assert.match(w, /parkWhileHidden\(\{/);
  assert.match(w, /event === 'SIGNED_IN' && !accessEnded && !parking\.isParked\(\)/);
  assert.match(w, /parking\.dispose\(\)/);
});

test('both clients hold their sockets while the page is busy, and only the board parks when idle', () => {
  const y = readFileSync(new URL('./yPartyKit.js', import.meta.url), 'utf8');
  assert.match(y, /parkWhileHidden\(\{.*isBusy: pageBusy \}\)/);
  assert.match(y, /parkWhileIdle\(\{.*isBusy: pageBusy \}\)/);
  // Others' edits and cursors count as use; this tab's own changes do not.
  assert.match(y, /if \(origin === provider\) whileIdle\.noteRemote\(\);/);
  assert.match(y, /if \(origin !== 'local'\) whileIdle\.noteRemote\(\);/);
  const w = readFileSync(new URL('./workspacePartyKit.js', import.meta.url), 'utf8');
  assert.match(w, /isBusy: pageBusy,/);
  assert.doesNotMatch(w, /parkWhileIdle/, 'presence costs nothing idle since the room hibernates');
});

// ── parkWhileIdle ────────────────────────────────────────────────────────────

function fakeWindow() {
  const listeners = new Map();
  return {
    addEventListener: (ev, fn) => listeners.set(ev, fn),
    removeEventListener: (ev) => listeners.delete(ev),
    fire(ev) { listeners.get(ev)?.(); },
    get count() { return listeners.size; },
  };
}
function fakeTicks() {
  let fn = null;
  return {
    setTick: (f) => { fn = f; return 1; },
    clearTick: () => { fn = null; },
    tick() { fn?.(); },
    get armed() { return !!fn; },
  };
}
function idleRig({ busy = () => false } = {}) {
  const clock = { t: 1_000_000 };
  const win = fakeWindow();
  const page = fakePage();
  const ticks = fakeTicks();
  const calls = [];
  const p = parkWhileIdle({
    park: () => calls.push('park'), unpark: () => calls.push('unpark'), isBusy: busy,
    win, doc: page, now: () => clock.t, ...ticks,
  });
  return { clock, win, page, ticks, calls, p };
}

test('a visible tab nobody touches lets go after fifteen minutes, and the next input takes it back', () => {
  const { clock, win, ticks, calls, p } = idleRig();
  clock.t += IDLE_PARK_MS - 1;
  ticks.tick();
  assert.deepEqual(calls, []);
  clock.t += 1;
  ticks.tick();
  assert.deepEqual(calls, ['park']);
  assert.equal(p.isParked(), true);
  ticks.tick();
  assert.deepEqual(calls, ['park'], 'parks once');
  win.fire('pointermove');
  assert.deepEqual(calls, ['park', 'unpark']);
  assert.equal(p.isParked(), false);
});

test('input keeps a tab connected', () => {
  const { clock, win, ticks, calls } = idleRig();
  clock.t += IDLE_PARK_MS - 1000;
  win.fire('keydown');
  clock.t += 1000;
  ticks.tick();
  assert.deepEqual(calls, []);
});

test('a tab watching someone else work stays connected', () => {
  const { clock, ticks, calls, p } = idleRig();
  clock.t += IDLE_PARK_MS - 1000;
  p.noteRemote();
  clock.t += 1000;
  ticks.tick();
  assert.deepEqual(calls, []);
  clock.t += IDLE_PARK_MS;
  ticks.tick();
  assert.deepEqual(calls, ['park'], 'once the board goes quiet too');
});

test('a busy tab and a hidden tab are not idle-parked', () => {
  const busy = idleRig({ busy: () => true });
  busy.clock.t += IDLE_PARK_MS * 2;
  busy.ticks.tick();
  assert.deepEqual(busy.calls, []);
  const hidden = idleRig();
  hidden.page.visibilityState = 'hidden';
  hidden.clock.t += IDLE_PARK_MS * 2;
  hidden.ticks.tick();
  assert.deepEqual(hidden.calls, [], 'a hidden tab is parkWhileHidden\'s');
});

test('showing or focusing an idle-parked tab takes the room back', () => {
  const a = idleRig();
  a.clock.t += IDLE_PARK_MS;
  a.ticks.tick();
  a.page.set('visible');
  assert.deepEqual(a.calls, ['park', 'unpark']);
  const b = idleRig();
  b.clock.t += IDLE_PARK_MS;
  b.ticks.tick();
  b.win.fire('focus');
  assert.deepEqual(b.calls, ['park', 'unpark']);
});

test('dispose stops the check and every listener', () => {
  const { win, page, ticks, p } = idleRig();
  p.dispose();
  assert.equal(ticks.armed, false);
  assert.equal(win.count, 0);
  assert.equal(page.listeners, 0);
});

test('idleParkDue counts from the later of the last input and the last remote activity', () => {
  assert.equal(idleParkDue({ now: 100, lastInputAt: 0, lastRemoteAt: 0, afterMs: 100 }), true);
  assert.equal(idleParkDue({ now: 100, lastInputAt: 50, lastRemoteAt: 0, afterMs: 100 }), false);
  assert.equal(idleParkDue({ now: 100, lastInputAt: 0, lastRemoteAt: 50, afterMs: 100 }), false);
  assert.equal(IDLE_PARK_MS, 15 * 60_000);
  assert.equal(IDLE_CHECK_MS, 60_000);
});

test('the board socket closes with a status code before disconnect() and destroy() close it without one', () => {
  const y = readFileSync(new URL('./yPartyKit.js', import.meta.url), 'utf8');
  assert.match(y, /provider\.ws\.close\(1000, why\)/);
  assert.match(y, /closeSocket\('parked'\);\s*try \{ provider\.disconnect\(\); \}/);
  assert.match(y, /closeSocket\('left'\);\s*try \{ provider\.destroy\(\); \}/);
});
