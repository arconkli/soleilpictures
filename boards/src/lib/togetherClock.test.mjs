// The pure half of working live together (togetherClock.js): who is active,
// how many seconds together, and what each person's sockets hear.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOGETHER_ACTIVE_SECONDS, TOGETHER_ENDED, readTogether } from './liveTogether.js';
import {
  ACTIVE_WINDOW_MS, MAX_TICK_SECONDS, INPUT_FIELDS, inputSignature, inputMoved,
  noteActivity, activeNow, togetherSeconds, settleTick,
  TOGETHER_SAVE_EVERY_MS, TOGETHER_SNAPSHOT_MAX_AGE_MS, TOGETHER_SEEN_MAX, togetherSnapshot, restoreTogether,
} from './togetherClock.js';

const S = 1000;

test('constants', () => {
  assert.equal(ACTIVE_WINDOW_MS, TOGETHER_ACTIVE_SECONDS * 1000);
  assert.equal(MAX_TICK_SECONDS, 120);
  assert.ok(Object.isFrozen(INPUT_FIELDS));
  for (const k of ['here', 'canvasCursor', 'docCaret']) assert.ok(INPUT_FIELDS.includes(k), k);
  for (const k of ['user', 'videoEpoch']) assert.ok(!INPUT_FIELDS.includes(k), k);
});

test('inputSignature ignores user and videoEpoch, sees every input field', () => {
  assert.equal(inputSignature(null), '');
  assert.equal(inputSignature('x'), '');
  const base = { user: { name: 'A' }, videoEpoch: 1 };
  const sig = inputSignature(base);
  assert.equal(inputSignature({ ...base, user: { name: 'B' } }), sig);
  assert.equal(inputSignature({ ...base, videoEpoch: 2 }), sig);
  for (const k of INPUT_FIELDS) {
    assert.notEqual(inputSignature({ ...base, [k]: { v: 1 } }), sig, k);
  }
});

test('inputMoved', () => {
  assert.equal(inputMoved(undefined, { user: { name: 'A' } }).moved, false);
  assert.equal(inputMoved(undefined, { canvasCursor: { x: 1, y: 2 } }).moved, false, 'a first state is never input: a reconnect re-sends its old cursor');
  const s1 = { user: { name: 'A' }, canvasCursor: { x: 1, y: 2 } };
  const first = inputMoved(undefined, s1);
  assert.equal(first.sig, inputSignature(s1));
  assert.equal(inputMoved(first.sig, s1).moved, false);
  assert.equal(inputMoved(first.sig, { ...s1, canvasCursor: { x: 5, y: 2 } }).moved, true);
  assert.equal(inputMoved(first.sig, { ...s1, user: { name: 'B' } }).moved, false);
  assert.equal(inputMoved(first.sig, { ...s1, videoEpoch: 9 }).moved, false);
});

test('noteActivity', () => {
  const m = new Map();
  noteActivity(m, 'a', 1000);
  assert.deepEqual(m.get('a'), { lastAt: 1000, since: 1000 });
  noteActivity(m, 'a', 1000 + ACTIVE_WINDOW_MS);
  assert.deepEqual(m.get('a'), { lastAt: 1000 + ACTIVE_WINDOW_MS, since: 1000 });
  noteActivity(m, 'a', 500);
  assert.equal(m.get('a').lastAt, 1000 + ACTIVE_WINDOW_MS, 'never moves back');
  const later = 1000 + ACTIVE_WINDOW_MS + ACTIVE_WINDOW_MS + 1;
  noteActivity(m, 'a', later);
  assert.deepEqual(m.get('a'), { lastAt: later, since: later });
  noteActivity(m, '', 5);
  assert.equal(m.size, 1);
});

test('activeNow', () => {
  const m = new Map([
    ['gone', { lastAt: 100, since: 0 }],
    ['stale', { lastAt: 0, since: 0 }],
    ['b', { lastAt: ACTIVE_WINDOW_MS + 500, since: 200 }],
    ['a', { lastAt: ACTIVE_WINDOW_MS + 500, since: 200 }],
    ['c', { lastAt: ACTIVE_WINDOW_MS + 500, since: 100 }],
  ]);
  const now = ACTIVE_WINDOW_MS + 1000;
  const out = activeNow(m, new Set(['stale', 'a', 'b', 'c']), now);
  assert.deepEqual(out.map((p) => p.id), ['c', 'a', 'b']);
  assert.ok(!m.has('gone'));
  assert.ok(m.has('stale'), 'kept while connected');
});

test('togetherSeconds', () => {
  assert.equal(togetherSeconds([], 0, undefined).size, 0);
  assert.equal(togetherSeconds([{ id: 'a', since: 0 }], 1000, undefined).size, 0);
  const A = { id: 'a', since: 0 }, B = { id: 'b', since: 30 * S };
  let r = togetherSeconds([A, B], 90 * S, undefined);
  assert.equal(r.get('a'), 60); assert.equal(r.get('b'), 60);
  r = togetherSeconds([A, B], 90 * S, 60 * S);
  assert.equal(r.get('a'), 30); assert.equal(r.get('b'), 30);
  r = togetherSeconds([{ id: 'a', since: 0 }, { id: 'b', since: 0 }], 500 * S, undefined);
  assert.equal(r.get('a'), 120); assert.equal(r.get('b'), 120);
  r = togetherSeconds([A, B], 90 * S + 999, undefined);
  assert.equal(r.get('a'), 60);
  r = togetherSeconds([A, B], 90 * S, 200 * S);
  assert.equal(r.get('a'), 0);
  r = togetherSeconds([A, B, { id: 'c', since: 70 * S }], 90 * S, undefined);
  assert.ok(r.get('c') < r.get('a') && r.get('c') < r.get('b'));
  assert.equal(r.get('c'), 20);
});

test('settleTick', () => {
  const answer = {
    people: 2, boost: 1, cap: 25,
    results: [
      { id: 'a', eligible: true, earned: 1, month: 4, capped: false, progress: 0.5 },
      { id: 'b', eligible: true, earned: 0, month: 25, capped: true, progress: 0 },
      { id: 'z', eligible: false },
    ],
  };
  const first = settleTick(new Map(), answer, 1000);
  assert.deepEqual([...first.told.keys()].sort(), ['a', 'b']);
  assert.equal(first.told.get('a').at, 1000);
  assert.deepEqual(readTogether(first.say.get('a')),
    { on: true, peers: ['b'], boost: 1, earned: 1, month: 4, cap: 25, capped: false, progress: 0.5 });
  const b = readTogether(first.say.get('b'));
  assert.deepEqual(b.peers, ['a']);
  assert.equal(b.capped, true);
  assert.deepEqual(first.ended, []);
  assert.ok(!first.say.has('z'));

  const a2 = { ...answer, results: [{ ...answer.results[0], earned: 2 }, answer.results[1]] };
  const second = settleTick(first.told, a2, 5000);
  assert.equal(second.told.get('a').earned, 3);
  assert.equal(second.told.get('a').at, 1000);

  const over = settleTick(second.told, null, 61_000);
  assert.equal(over.told.size, 0);
  assert.deepEqual(over.ended, [{ id: 'a', s: 60 }, { id: 'b', s: 60 }]);
  assert.equal(over.say.get('a'), TOGETHER_ENDED);
  assert.equal(over.say.get('b'), TOGETHER_ENDED);

  const zero = settleTick(second.told, { ...answer, boost: 0 }, 61_000);
  assert.equal(zero.told.size, 0);
  assert.equal(zero.ended.length, 2);

  for (const bad of [-3, NaN]) {
    const t = settleTick(new Map(), { ...answer, results: [{ ...answer.results[0], earned: bad }, answer.results[1]] }, 1);
    assert.equal(t.told.get('a').earned, 0);
  }
});

test('togetherSeconds: someone the database turned away never starts a stretch', () => {
  const A = { id: 'a', since: 0 }, X = { id: 'x', since: 0 }, B = { id: 'b', since: 55 * S };
  assert.equal(togetherSeconds([A, X, B], 60 * S, 0).get('a'), 60, 'without skip, X starts it at 0');
  const skip = new Set(['x']);
  const r = togetherSeconds([A, X, B], 60 * S, 0, skip);
  assert.equal(r.get('a'), 5); assert.equal(r.get('b'), 5);
  assert.ok(r.has('x'), 'still sent, so the database can say again');
  assert.equal(togetherSeconds([A, X], 60 * S, 0, skip).size, 0, 'one real person is not together');
});

// ── across a nap ──

const full = () => ({
  people: new Map([['a', { lastAt: 50 * S, since: 10 * S }], ['b', { lastAt: 55 * S, since: 20 * S }]]),
  seen: new Map([[1, '[null]'], [2, '[1]']]),
  told: new Map([['a', { at: 30 * S, earned: 2 }]]),
  lastTickAt: 40 * S,
  offUntil: 99 * S,
  turnedAway: new Map([['x', 70 * S]]),
});

test('a snapshot restores to the same state', () => {
  const state = full();
  const snap = JSON.parse(JSON.stringify(togetherSnapshot(state, 60 * S)));
  assert.equal(snap.v, 1);
  assert.equal(snap.at, 60 * S);
  assert.deepEqual(restoreTogether(snap, 61 * S), state);
  const empty = togetherSnapshot({ ...full(), lastTickAt: undefined, offUntil: undefined }, 1);
  assert.equal(empty.lastTickAt, null);
  const back = restoreTogether(empty, 2);
  assert.equal(back.lastTickAt, undefined);
  assert.equal(back.offUntil, 0);
});

test('a snapshot keeps only the newest signatures', () => {
  const seen = new Map();
  for (let i = 0; i < TOGETHER_SEEN_MAX + 25; i++) seen.set(i, 's');
  const snap = togetherSnapshot({ ...full(), seen }, 1);
  assert.equal(snap.seen.length, TOGETHER_SEEN_MAX);
  assert.equal(snap.seen[0][0], 25);
  assert.equal(snap.seen.at(-1)[0], TOGETHER_SEEN_MAX + 24);
});

test('a snapshot too old, or not one of ours, is dropped', () => {
  const snap = togetherSnapshot(full(), 0);
  assert.notEqual(restoreTogether(snap, TOGETHER_SNAPSHOT_MAX_AGE_MS), null);
  assert.equal(restoreTogether(snap, TOGETHER_SNAPSHOT_MAX_AGE_MS + 1), null);
  for (const bad of [null, undefined, 'x', 3, {}, { ...snap, v: 2 }, { ...snap, at: 'now' }, { ...snap, at: NaN }]) {
    assert.equal(restoreTogether(bad, 1), null);
  }
  assert.equal(TOGETHER_SAVE_EVERY_MS, 15_000);
});

test('malformed rows are skipped one by one', () => {
  const snap = {
    v: 1, at: 1,
    people: [['a', 5, 1], ['b', 'x', 1], [7, 1, 1], ['c', 1], null, 'junk'],
    seen: [[1, 'ok'], ['1', 'no'], [2, 5]],
    told: [['a', 1, 2], ['b', 1], ['c', NaN, 1]],
    lastTickAt: 'x', offUntil: 'y',
    turnedAway: [['x', 9], ['y', 'z'], [3, 4]],
  };
  const r = restoreTogether(snap, 2);
  assert.deepEqual([...r.people.keys()], ['a']);
  assert.deepEqual([...r.seen], [[1, 'ok']]);
  assert.deepEqual([...r.told.keys()], ['a']);
  assert.deepEqual([...r.turnedAway], [['x', 9]]);
  assert.equal(r.lastTickAt, undefined);
  assert.equal(r.offUntil, 0);
  const none = restoreTogether({ v: 1, at: 1 }, 2);
  assert.equal(none.people.size + none.seen.size + none.told.size + none.turnedAway.size, 0);
});

test('togetherSeconds after a restore counts from the restored lastTickAt, not from scratch', () => {
  const people = new Map([['a', { lastAt: 100 * S, since: 0 }], ['b', { lastAt: 100 * S, since: 0 }]]);
  const connected = new Set(['a', 'b']);
  const snap = JSON.parse(JSON.stringify(togetherSnapshot({ ...full(), people, lastTickAt: 90 * S }, 100 * S)));
  const r = restoreTogether(snap, 105 * S);
  const active = activeNow(r.people, connected, 105 * S);
  assert.equal(togetherSeconds(active, 105 * S, r.lastTickAt).get('a'), 15);
  // a room that forgot would count the whole run
  assert.equal(togetherSeconds(activeNow(people, connected, 105 * S), 105 * S, undefined).get('a'), 105);
});
