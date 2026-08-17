// appSession.test.mjs — rotation rules for the app session.
//
//   node --test src/lib/appSession.test.mjs
//
// `decideSession` is pure, so idle expiry, the UTC day boundary and auth
// rotation are all driven here with an injected clock and a counting minter —
// no timers, no localStorage, no browser. The stateful wrapper is exercised
// too: it guards `typeof localStorage === 'undefined'` and so runs in-memory
// under plain node, which is exactly the path a private-mode browser takes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideSession, utcDay, IDLE_ROTATE_MS,
  touchAppSession, getAppSession, noteAuthChange,
  setSessionRotateHandler, __resetAppSessionForTest,
} from './appSession.js';

// Deterministic ids so assertions can name them.
function minter() {
  let n = 0;
  return () => `id-${++n}`;
}

const DAY = 86_400_000;
// A fixed instant mid-day so tests don't accidentally straddle a UTC boundary.
const T0 = 1_760_000_000_000;
const noonish = T0 - (T0 % DAY) + 12 * 3_600_000;

function fresh(now, mint) {
  return decideSession(null, now, { mint });
}

test('a missing or malformed record starts session 1', () => {
  const mint = minter();
  for (const bad of [null, undefined, {}, { id: '', lastSeenAt: 1, seq: 1 }, { id: 'x' }]) {
    const s = decideSession(bad, noonish, { mint: () => 'fixed' });
    assert.equal(s.rotated, true);
    assert.equal(s.reason, 'new');
    assert.equal(s.seq, 1, 'first session is seq 1');
  }
  const s = fresh(noonish, mint);
  assert.equal(s.id, 'id-1');
  assert.equal(s.startedAt, noonish);
  assert.equal(s.day, utcDay(noonish));
});

test('activity inside the idle window continues the same session', () => {
  const mint = minter();
  const a = fresh(noonish, mint);
  const b = decideSession(a, noonish + IDLE_ROTATE_MS - 1, { mint });
  assert.equal(b.rotated, false);
  assert.equal(b.id, a.id, 'same session id');
  assert.equal(b.seq, a.seq);
  assert.equal(b.startedAt, a.startedAt, 'start time is preserved');
  assert.equal(b.lastSeenAt, noonish + IDLE_ROTATE_MS - 1, 'clock advanced');
});

test('crossing the idle window rotates and increments seq', () => {
  const mint = minter();
  const a = fresh(noonish, mint);
  const b = decideSession(a, noonish + IDLE_ROTATE_MS + 1, { mint });
  assert.equal(b.rotated, true);
  assert.equal(b.reason, 'idle');
  assert.equal(b.id, 'id-2');
  assert.notEqual(b.id, a.id);
  assert.equal(b.seq, 2, 'seq counts sessions for this browser');
  assert.equal(b.startedAt, noonish + IDLE_ROTATE_MS + 1, 'new session starts now');
});

test('the boundary itself is not a rotation — strictly greater than', () => {
  const mint = minter();
  const a = fresh(noonish, mint);
  const b = decideSession(a, noonish + IDLE_ROTATE_MS, { mint });
  assert.equal(b.rotated, false, 'exactly IDLE_ROTATE_MS still counts as active');
});

test('a UTC day change rotates even with continuous activity', () => {
  const mint = minter();
  // 23:50 UTC, then 20 minutes later — inside the idle window, next day.
  const late = noonish - 12 * 3_600_000 + 23 * 3_600_000 + 50 * 60_000;
  const a = fresh(late, mint);
  const b = decideSession(a, late + 20 * 60_000, { mint });
  assert.equal(b.rotated, true);
  assert.equal(b.reason, 'day');
  assert.equal(b.seq, 2);
  assert.equal(utcDay(b.day * DAY), b.day);
  assert.notEqual(b.day, a.day, 'the day advanced');
});

test('sign-in / sign-out rotates immediately', () => {
  const mint = minter();
  const a = fresh(noonish, mint);
  const b = decideSession(a, noonish + 1000, { mint, authChanged: true });
  assert.equal(b.rotated, true);
  assert.equal(b.reason, 'auth');
  assert.equal(b.seq, 2);
});

test('auth rotation outranks idle and day when several apply at once', () => {
  const mint = minter();
  const a = fresh(noonish, mint);
  const b = decideSession(a, noonish + 3 * DAY, { mint, authChanged: true });
  assert.equal(b.reason, 'auth', 'the identity change is the reported cause');
  assert.equal(b.seq, 2, 'still exactly one rotation, not three');
});

test('a backwards clock jump clamps instead of rotating', () => {
  const mint = minter();
  const a = decideSession(null, noonish, { mint });
  const b = decideSession(a, noonish - 60_000, { mint });
  assert.equal(b.rotated, false, 'an NTP correction must not start a phantom session');
  assert.equal(b.id, a.id);
  assert.equal(b.lastSeenAt, a.lastSeenAt, 'lastSeenAt never moves backwards');
});

test('seq keeps climbing across many rotations', () => {
  const mint = minter();
  let s = fresh(noonish, mint);
  for (let i = 2; i <= 12; i++) {
    s = decideSession(s, s.lastSeenAt + IDLE_ROTATE_MS + 1, { mint });
    assert.equal(s.seq, i);
  }
  assert.equal(s.seq, 12, 'a row can say "their 12th session" without a self-join');
});

test('idleMs is injectable so callers can test other windows', () => {
  const mint = minter();
  const a = fresh(noonish, mint);
  const b = decideSession(a, noonish + 5000, { mint, idleMs: 1000 });
  assert.equal(b.rotated, true);
  assert.equal(b.reason, 'idle');
});

// ── the stateful wrapper ───────────────────────────────────────────────

test('touchAppSession is stable across calls and rotates on auth', () => {
  __resetAppSessionForTest();
  const first = touchAppSession({ now: noonish });
  const same = touchAppSession({ now: noonish + 1000 });
  assert.equal(same.id, first.id, 'repeated touches keep one session');
  assert.equal(getAppSession().id, first.id, 'getAppSession does not mint a new one');

  const after = noteAuthChange();
  assert.notEqual(after.id, first.id, 'signing in ends the session');
  assert.equal(after.seq, first.seq + 1);
});

test('the rotate handler fires once per rotation, never on a plain touch', () => {
  __resetAppSessionForTest();
  const seen = [];
  setSessionRotateHandler((s) => seen.push(s.reason));

  touchAppSession({ now: noonish });                       // 'new'
  touchAppSession({ now: noonish + 1000 });                // no rotation
  touchAppSession({ now: noonish + IDLE_ROTATE_MS + 2000 }); // 'idle'

  assert.deepEqual(seen, ['new', 'idle']);
  setSessionRotateHandler(null);
});
