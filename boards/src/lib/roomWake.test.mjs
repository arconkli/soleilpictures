// The pure pieces a hibernating board room decides with (roomWake.js).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, removeAwarenessStates, applyAwarenessUpdate } from 'y-protocols/awareness';
import {
  CHECK_EVERY_MS, ACTIVE_ALARM_MS, QUIET_ALARM_MS, ACTIVE_FOR_MS, SILENT_CLOSE_MS,
  HEARD_SAVE_EVERY_MS, ACTIVITY_SAVE_EVERY_MS, EMPTY_RETRY_FOR_MS, PRESENCE_KEY, PRESENCE_FIELD_MAX,
  PRESENCE_MAX, PRESENCE_IDS_MAX,
  checkDue, nextAlarmIn, lastHeardAt, isSilent, presenceToKeep, keptPresence,
  restorePresence, sameEntries,
} from './roomWake.js';

test('constants', () => {
  assert.equal(CHECK_EVERY_MS, 60_000);
  assert.equal(ACTIVE_ALARM_MS, 60_000);
  assert.equal(QUIET_ALARM_MS, 300_000);
  assert.equal(ACTIVE_FOR_MS, 120_000);
  assert.equal(SILENT_CLOSE_MS, 300_000);
  assert.equal(HEARD_SAVE_EVERY_MS, 60_000);
  assert.equal(ACTIVITY_SAVE_EVERY_MS, 30_000);
  assert.equal(EMPTY_RETRY_FOR_MS, 900_000);
  assert.equal(PRESENCE_KEY, 'soleilAw');
  assert.equal(PRESENCE_FIELD_MAX, 512);
  assert.equal(PRESENCE_MAX, 2048);
  assert.equal(PRESENCE_IDS_MAX, 4);
});

test('checkDue: due at the interval, never-checked is due', () => {
  assert.equal(checkDue(100_000, 40_001), false);
  assert.equal(checkDue(100_000, 40_000), true);
  assert.equal(checkDue(100_000, undefined), true);
  assert.equal(checkDue(100_000, 'junk'), true);
});

test('nextAlarmIn: soon while active, late when quiet, none when empty and clean', () => {
  const now = 1_000_000;
  assert.equal(nextAlarmIn({ now, sockets: 2, lastActivityAt: now - 1000, dirty: false }), ACTIVE_ALARM_MS);
  assert.equal(nextAlarmIn({ now, sockets: 2, lastActivityAt: now - ACTIVE_FOR_MS, dirty: false }), QUIET_ALARM_MS);
  assert.equal(nextAlarmIn({ now, sockets: 1, lastActivityAt: undefined, dirty: false }), QUIET_ALARM_MS);
  assert.equal(nextAlarmIn({ now, sockets: 0, lastActivityAt: now, dirty: true }), ACTIVE_ALARM_MS);
  assert.equal(nextAlarmIn({ now, sockets: 0, lastActivityAt: now, dirty: false }), null);
  assert.equal(nextAlarmIn({ now, sockets: 2, lastActivityAt: now - ACTIVE_FOR_MS, dirty: true }), ACTIVE_ALARM_MS, 'a failed save retries soon even in a quiet room');
  assert.equal(nextAlarmIn({ now, sockets: 0, lastActivityAt: now, dirty: false, busy: true }), ACTIVE_ALARM_MS, 'work still running keeps an empty room checked');
  assert.equal(nextAlarmIn({ now, sockets: 0, lastActivityAt: 0, dirty: false, busy: false }), null);
});

test('nextAlarmIn: an empty room stops retrying a failed save after 15 minutes', () => {
  const now = 10_000_000;
  assert.equal(nextAlarmIn({ now, sockets: 0, lastActivityAt: 0, dirty: true, dirtySince: now - 60_000 }), ACTIVE_ALARM_MS);
  assert.equal(nextAlarmIn({ now, sockets: 0, lastActivityAt: 0, dirty: true, dirtySince: now - EMPTY_RETRY_FOR_MS }), null);
  assert.equal(nextAlarmIn({ now, sockets: 2, lastActivityAt: 0, dirty: true, dirtySince: now - EMPTY_RETRY_FOR_MS - 1 }), ACTIVE_ALARM_MS, 'sockets keep retrying');
  assert.equal(nextAlarmIn({ now, sockets: 0, lastActivityAt: 0, dirty: true, dirtySince: null }), ACTIVE_ALARM_MS);
  // Failing since long before the room emptied: the window runs from the emptying.
  assert.equal(nextAlarmIn({ now, sockets: 0, lastActivityAt: now - 60_000, dirty: true, dirtySince: now - 20 * 60_000 }), ACTIVE_ALARM_MS);
  assert.equal(nextAlarmIn({ now, sockets: 0, lastActivityAt: now - EMPTY_RETRY_FOR_MS, dirty: true, dirtySince: now - 20 * 60_000 }), null);
});

test('nextAlarmIn: work still running in an empty room re-arms only within the retry window', () => {
  const now = 10_000_000;
  assert.equal(nextAlarmIn({ now, sockets: 0, lastActivityAt: now - EMPTY_RETRY_FOR_MS + 1, dirty: false, busy: true }), ACTIVE_ALARM_MS);
  assert.equal(nextAlarmIn({ now, sockets: 0, lastActivityAt: now - EMPTY_RETRY_FOR_MS, dirty: false, busy: true }), null);
  assert.equal(nextAlarmIn({ now, sockets: 0, lastActivityAt: undefined, dirty: false, busy: true }), null);
  assert.equal(nextAlarmIn({ now, sockets: 0, lastActivityAt: 0, dirty: false, busy: true }), null);
  assert.equal(nextAlarmIn({ now, sockets: 0, lastActivityAt: now - 1, dirty: false, busy: false }), null);
});

test('lastHeardAt takes the largest usable time, numbers or Dates', () => {
  assert.equal(lastHeardAt(), 0);
  assert.equal(lastHeardAt(null, undefined, NaN, '5000', -3, 0), 0);
  assert.equal(lastHeardAt(10, 30, 20), 30);
  assert.equal(lastHeardAt(10, new Date(50), 20), 50);
  assert.equal(lastHeardAt(new Date('nope'), 7), 7);
  assert.equal(lastHeardAt(Infinity, 9), 9);
});

test('isSilent: only after a known time, and only past the limit', () => {
  assert.equal(isSilent(1_000_000, 0), false);
  assert.equal(isSilent(1_000_000, 1_000_000 - SILENT_CLOSE_MS), false);
  assert.equal(isSilent(1_000_000, 1_000_000 - SILENT_CLOSE_MS - 1), true);
});

test('presenceToKeep: user always, small fields, drops null and unstringifiable', () => {
  assert.equal(presenceToKeep(null), null);
  assert.equal(presenceToKeep([1]), null);
  assert.equal(presenceToKeep('x'), null);
  assert.equal(presenceToKeep({}), null);
  assert.equal(presenceToKeep({ a: null, b: undefined }), null);
  const circ = {}; circ.self = circ;
  const got = presenceToKeep({ user: { name: 'A' }, canvasCursor: { x: 1, y: 2 }, gone: null, circ, fn: () => 1 });
  assert.deepEqual(got, { user: { name: 'A' }, canvasCursor: { x: 1, y: 2 } });
});

test('presenceToKeep: a field over the field cap is dropped, the user is kept regardless', () => {
  const big = 'x'.repeat(PRESENCE_FIELD_MAX);   // JSON adds two quotes: over the cap
  const ok = 'y'.repeat(PRESENCE_FIELD_MAX - 2);
  const got = presenceToKeep({ user: { name: 'A' }, big, ok });
  assert.deepEqual(got, { user: { name: 'A' }, ok });
});

test('presenceToKeep: over the total cap shrinks to the user, or to nothing', () => {
  const field = 'z'.repeat(PRESENCE_FIELD_MAX - 2);
  const many = {};
  for (let i = 0; i < 6; i++) many[`f${i}`] = field;
  assert.deepEqual(presenceToKeep({ user: { name: 'A' }, ...many }), { user: { name: 'A' } });
  assert.equal(presenceToKeep(many), null);
  // a user too big for even the total cap
  const hugeUser = { name: 'q'.repeat(PRESENCE_MAX) };
  assert.equal(presenceToKeep({ user: hugeUser, a: 1 }), null);
});

// An Awareness runs a timer of its own; destroy them so node can exit.
const made = [];
function mk() {
  const a = new Awareness(new Y.Doc());
  made.push(a);
  return a;
}
after(() => { for (const a of made) a.destroy(); });

function awarenessWith(...clients) {
  const a = mk();
  a.setLocalState(null);
  for (const [id, clock, state] of clients) {
    a.states.set(id, state);
    a.meta.set(id, { clock, lastUpdated: 0 });
  }
  return a;
}

test('keptPresence reads state and clock for the first few valid ids', () => {
  const a = awarenessWith([1, 4, { user: { name: 'A' }, c: 1 }], [2, 9, { user: { name: 'B' } }], [3, 1, { n: null }]);
  assert.deepEqual(keptPresence([1, 2, 3, 99, -1, 1.5, 'x'], a), [
    [1, 4, { user: { name: 'A' }, c: 1 }],
    [2, 9, { user: { name: 'B' } }],
  ]);
  // only the first PRESENCE_IDS_MAX ids are looked at
  const five = awarenessWith(...[1, 2, 3, 4, 5].map((i) => [i, 1, { user: { n: i } }]));
  assert.equal(keptPresence([1, 2, 3, 4, 5], five).length, PRESENCE_IDS_MAX);
  // a state with no numeric clock is skipped
  const noClock = awarenessWith([1, 1, { user: {} }]);
  noClock.meta.get(1).clock = 'x';
  assert.deepEqual(keptPresence([1], noClock), []);
});

test('keptPresence never throws', () => {
  assert.deepEqual(keptPresence([1], null), []);
  assert.deepEqual(keptPresence('nope', awarenessWith()), []);
  assert.deepEqual(keptPresence([1], { states: null, meta: null }), []);
});

test('restorePresence puts valid entries back without emitting, and counts them', () => {
  const a = awarenessWith();
  let events = 0;
  a.on('change', () => { events++; });
  a.on('update', () => { events++; });
  const n = restorePresence(a, [[7, 3, { user: { name: 'A' } }], [8, 0, { user: {} }]], 5000);
  assert.equal(n, 2);
  assert.equal(events, 0);
  assert.deepEqual(a.states.get(7), { user: { name: 'A' } });
  assert.deepEqual(a.meta.get(7), { clock: 3, lastUpdated: 5000 });
});

test('restorePresence ignores malformed entries and never overwrites a present id', () => {
  const a = awarenessWith([1, 5, { user: { name: 'live' } }]);
  const n = restorePresence(a, [
    [1, 2, { user: { name: 'stale' } }],   // already present
    [2, -1, {}], [3, 1.5, {}], ['4', 1, {}], [5, 1, null], [6, 1, [1]], [7, 1], 'x', null, 42,
    [9, 1, { ok: true }],
  ], 1);
  assert.equal(n, 1);
  assert.deepEqual(a.states.get(1), { user: { name: 'live' } });
  assert.equal(a.meta.get(1).clock, 5);
  assert.deepEqual([...a.states.keys()].sort(), [1, 9]);
  assert.equal(restorePresence(a, 'nope', 1), 0);
  assert.equal(restorePresence(null, [[1, 1, {}]], 1), 0);
});

// y-protocols bumps the clock only for its own client when removing, so the
// removal of a restored (remote) id is encoded at the restored clock; a peer
// that holds that clock accepts it because it is a null state at an equal clock.
test('a restored id can be removed, and a browser holding it drops it', () => {
  const a = awarenessWith();
  restorePresence(a, [[42, 6, { user: { name: 'A' } }]], Date.now());
  const removed = [];
  a.on('update', ({ removed: r }) => removed.push(...r));
  removeAwarenessStates(a, [42], 'socket closed');
  assert.deepEqual(removed, [42]);
  assert.equal(a.meta.get(42).clock, 6);
  const bytes = encodeAwarenessUpdate(a, [42]);
  // a peer that still holds the old state at clock 6 accepts the removal
  const peer = mk();
  peer.setLocalState(null);
  peer.states.set(42, { user: { name: 'A' } });
  peer.meta.set(42, { clock: 6, lastUpdated: 0 });
  applyAwarenessUpdate(peer, bytes, 'test');
  assert.equal(peer.states.has(42), false);
});

test('sameEntries compares by JSON, treating null and undefined alike', () => {
  assert.equal(sameEntries(undefined, null), true);
  assert.equal(sameEntries([[1, 2, { a: 1 }]], [[1, 2, { a: 1 }]]), true);
  assert.equal(sameEntries([[1, 2, { a: 1 }]], [[1, 3, { a: 1 }]]), false);
  assert.equal(sameEntries([], null), false);
});
