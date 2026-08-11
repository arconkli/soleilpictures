// Carrying a phone number across the signup roundtrip.
//
// The module is deliberately dumb — stash, read, clear — and the tests are here
// for one reason: what comes out of localStorage is attacker-writable on this
// origin, and it is handed straight to an RPC. Validating on the way OUT as
// well as on the way in is the whole point, and a refactor that "simplifies"
// readScoutPhone into a bare getItem would pass every other check.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// node:test has no DOM. A two-method stand-in is enough — the module only ever
// touches getItem/setItem/removeItem, and pinning that is itself useful.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { parseScoutPhone, stashScoutPhone, readScoutPhone, clearScoutPhone } =
  await import('./scoutClaim.js');

beforeEach(() => store.clear());

test('E.164 round-trips', () => {
  stashScoutPhone('+15555550123');
  assert.equal(readScoutPhone(), '+15555550123');
  clearScoutPhone();
  assert.equal(readScoutPhone(), null);
});

test('only E.164 is accepted — the Worker normalized it for a reason', () => {
  // What the user TYPED is not what the database holds. The endpoint returns
  // the normalized form precisely because it is the only party that knows the
  // country the digits were read against, and a national-format number would
  // match no signup row at all.
  for (const bad of ['(555) 012-3456', '5555550123', '+1 555 555 0123', '+0123456', '']) {
    assert.equal(parseScoutPhone(bad), null, `${JSON.stringify(bad)} must be refused`);
  }
  assert.equal(parseScoutPhone('+447700900123'), '+447700900123', 'a UK mobile is fine');
});

test('a poisoned localStorage value is dropped on the way OUT', () => {
  // localStorage is writable by anything on this origin, and this value is
  // handed to an RPC. Validating only on the way in would trust whatever was
  // there before.
  store.set('soleil.boards.pending.scout.phone', "'; drop table scout_signups; --");
  assert.equal(readScoutPhone(), null);

  store.set('soleil.boards.pending.scout.phone', '+1555555012345678901234');
  assert.equal(readScoutPhone(), null, 'over-long digits are not E.164');
});

test('nothing stashed reads as nothing, and clearing twice is fine', () => {
  assert.equal(readScoutPhone(), null);
  stashScoutPhone(null);
  stashScoutPhone(undefined);
  stashScoutPhone('nonsense');
  assert.equal(readScoutPhone(), null, 'junk never gets written');
  clearScoutPhone();
  clearScoutPhone();
  assert.equal(readScoutPhone(), null);
});

test('a storage that throws cannot break sign-in', () => {
  // Safari private mode throws on setItem. Somebody signing in has no idea this
  // module exists and must not see it fail.
  const good = globalThis.localStorage;
  globalThis.localStorage = {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('SecurityError'); },
    removeItem() { throw new Error('SecurityError'); },
  };
  try {
    assert.doesNotThrow(() => stashScoutPhone('+15555550123'));
    assert.equal(readScoutPhone(), null);
    assert.doesNotThrow(() => clearScoutPhone());
  } finally {
    globalThis.localStorage = good;
  }
});
