// captureState.test.mjs — the Capture Mode gate and what it is allowed to remember.
//
// Two properties this file exists to pin, because both fail silently:
//
//   1. DISARMED MEANS DEAD. Capture ships to production, so the only thing
//      standing between a non-admin and a chromeless, identity-swapped app is
//      that every setter no-ops until armCapture(true). If that ever regresses
//      to "the UI just doesn't render the button", a console call re-opens it.
//
//   2. THE PERSONA NEVER PERSISTS. A fake identity that outlives the tab and
//      leaks into a real collaboration session is the worst failure this
//      feature has. It must not reach sessionStorage even once.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// captureState reads sessionStorage at CALL time, not import time, so one
// import serves every case.
const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const cs = await import('./captureState.js');
const {
  armCapture, isArmed, setCapture, resetCapture, subscribe,
  isCaptureActive, isSilenced, isFrozen, isCleanChrome, isPersonaOn, isReframeOn,
  castSize, getCaptureState, __resetForTests, STORAGE_KEY, DEFAULTS,
} = cs;

const fresh = () => { __resetForTests(); store.clear(); };
const stored = () => {
  const raw = store.get(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
};

// ── 1. The gate ────────────────────────────────────────────────────────────

test('disarmed: every setter is a no-op', () => {
  fresh();
  assert.equal(isArmed(), false);
  setCapture({ on: true, clean: true, silence: true, persona: true, cast: 3 });
  assert.equal(isCaptureActive(), false);
  assert.equal(isSilenced(), false);
  assert.equal(isCleanChrome(), false);
  assert.equal(isPersonaOn(), false);
  assert.equal(castSize(), 0);
  assert.equal(getCaptureState(), DEFAULTS);
  // and nothing was written where a reload could pick it up
  assert.equal(stored(), null);
});

test('disarmed: resetCapture is also a no-op and writes nothing', () => {
  fresh();
  resetCapture();
  assert.equal(stored(), null);
});

test('arming enables writes; disarming resets and clears storage', () => {
  fresh();
  armCapture(true);
  setCapture({ on: true, clean: true });
  assert.equal(isCaptureActive(), true);
  assert.equal(isCleanChrome(), true);
  assert.ok(stored());

  armCapture(false);
  assert.equal(isArmed(), false);
  assert.equal(isCaptureActive(), false);
  assert.equal(getCaptureState(), DEFAULTS);
  assert.equal(stored(), null, 'losing admin must not leave a chromeless app armed on reload');
});

test('armCapture is idempotent — re-arming does not clobber live state', () => {
  fresh();
  armCapture(true);
  setCapture({ on: true, width: 900 });
  armCapture(true);
  assert.equal(getCaptureState().width, 900);
});

// ── 2. Derived readers fold in the master switch ───────────────────────────

test('sub-flags are inert while the master switch is off', () => {
  fresh();
  armCapture(true);
  setCapture({ on: false, silence: true, freeze: true, clean: true, persona: true, reframe: true, cast: 4 });
  assert.equal(isSilenced(), false);
  assert.equal(isFrozen(), false);
  assert.equal(isCleanChrome(), false);
  assert.equal(isPersonaOn(), false);
  assert.equal(isReframeOn(), false);
  assert.equal(castSize(), 0, 'one switch must kill the synthetic cast too');

  setCapture({ on: true });
  assert.equal(isSilenced(), true);
  assert.equal(isFrozen(), true);
  assert.equal(castSize(), 4);
});

// ── 3. The persona must never touch storage ────────────────────────────────

test('persona and cast are never written to sessionStorage', () => {
  fresh();
  armCapture(true);
  setCapture({ on: true, persona: true, cast: 5, clean: true });
  const blob = stored();
  assert.equal('persona' in blob, false);
  assert.equal('cast' in blob, false);
  assert.equal(blob.clean, true, 'staging flags DO persist — only identity is ephemeral');
});

test('re-arming rehydrates staging flags but never the persona', () => {
  fresh();
  armCapture(true);
  setCapture({ on: true, clean: true, freeze: true, persona: true, cast: 3, width: 640 });

  // Simulate a reload: module state gone, sessionStorage survives.
  const surviving = store.get(STORAGE_KEY);
  __resetForTests();
  store.set(STORAGE_KEY, surviving);

  armCapture(true);
  assert.equal(isCleanChrome(), true);
  assert.equal(isFrozen(), true);
  assert.equal(getCaptureState().width, 640);
  assert.equal(isPersonaOn(), false, 'a persona must not survive a reload');
  assert.equal(castSize(), 0);
});

// ── 4. Patch hygiene ───────────────────────────────────────────────────────

test('unknown keys are dropped, not stored', () => {
  fresh();
  armCapture(true);
  setCapture({ on: true, notAFlag: true });
  assert.equal('notAFlag' in getCaptureState(), false);
  assert.equal('notAFlag' in stored(), false);
});

test('wrong types fall back to the declared default', () => {
  fresh();
  armCapture(true);
  setCapture({ on: true, width: 'huge', clean: 1 });
  assert.equal(getCaptureState().width, DEFAULTS.width, 'a non-finite width would poison the reframe');
  assert.equal(getCaptureState().clean, true, 'truthy coerces for booleans');
});

test('a hand-edited storage blob cannot inject a bad type', () => {
  fresh();
  store.set(STORAGE_KEY, JSON.stringify({ on: true, width: 'nope', clean: 'yes', bogus: 1 }));
  armCapture(true);
  const s = getCaptureState();
  assert.equal(s.width, DEFAULTS.width);
  assert.equal(s.clean, DEFAULTS.clean, 'a string is not a boolean');
  assert.equal('bogus' in s, false);
  assert.equal(s.on, true, 'well-typed keys still restore');
});

// ── 5. Subscription + snapshot identity ────────────────────────────────────

test('subscribe fires once per real change and not at all for a no-op patch', () => {
  fresh();
  armCapture(true);
  let calls = 0;
  const off = subscribe(() => { calls++; });

  setCapture({ on: true });
  assert.equal(calls, 1);

  setCapture({ on: true });               // same value
  assert.equal(calls, 1, 'no change must not notify');

  setCapture({ clean: true, freeze: true });  // two keys, one commit
  assert.equal(calls, 2);

  off();
  setCapture({ on: false });
  assert.equal(calls, 2, 'unsubscribe must actually detach');
});

test('snapshot identity is stable between changes (valid useSyncExternalStore source)', () => {
  fresh();
  armCapture(true);
  setCapture({ on: true });
  const a = getCaptureState();
  assert.equal(getCaptureState(), a, 'reading twice must not produce a new object');
  setCapture({ clean: true });
  assert.notEqual(getCaptureState(), a, 'a real change must produce a new identity');
});

test('a throwing listener does not break the commit or starve the others', () => {
  fresh();
  armCapture(true);
  let reached = 0;
  subscribe(() => { throw new Error('boom'); });
  subscribe(() => { reached++; });
  setCapture({ on: true });
  assert.equal(reached, 1);
  assert.equal(isCaptureActive(), true);
});

test('resetCapture clears everything but leaves the module armed', () => {
  fresh();
  armCapture(true);
  setCapture({ on: true, clean: true, persona: true, cast: 2 });
  resetCapture();
  assert.equal(isArmed(), true);
  assert.equal(isCaptureActive(), false);
  assert.equal(isPersonaOn(), false);
  assert.equal(getCaptureState(), DEFAULTS);
});
