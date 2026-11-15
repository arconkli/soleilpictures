// placeHeld.test.mjs — "Your place is held": the store, the days, the words and the camera.
//
//   node --import ./scripts/linguiNode.mjs --test src/lib/placeHeld.test.mjs
//
// Every time is built from local constructors, so the file passes in any zone
// (run it with TZ=America/Los_Angeles and TZ=Asia/Tokyo as well).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESUME_GAP_MS } from './resumeSitting.js';
import {
  PLACE_HELD_KEY, PLACE_HELD_MAX_BOARDS, PLACE_HELD_MAX_DAYS, PLACE_HELD_HOLD_MS, SLATE_LONG_MS,
  WORK_STAMP_EVERY_MS, PLACE_SHARE,
  heldOnce, __resetPlaceHeldPage,
  stampMs, localDay, effectiveDay, dayDiff, partOf,
  emptyPlaceHeld, parsePlaceHeld, readPlaceHeld, writePlaceHeld, prunePlaceHeld, entryOf,
  withVisit, withWork, withDays,
  clusterDays, dayNumber,
  myTouchMs, myLastTouch, lastWorkedAt,
  lastWorkedLabel, lastWorkedBucket, slateFor,
  deviceStorage, noteVisit, noteWork, noteDays, __resetPlaceHeldWrites,
  isRealBreak, planHeldOpen, settleCamera, searchNews,
} from './placeHeld.js';

// Local time in November 2026 (month is 1-based here).
const L = (m, d, h = 12, mi = 0) => new Date(2026, m - 1, d, h, mi).getTime();
const iso = (m, d, h = 12) => new Date(2026, m - 1, d, h).toISOString();
const MIN = 60_000;
const clone = (o) => JSON.parse(JSON.stringify(o));
const deepFreeze = (o) => {
  if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
};
const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, m };
};
const throwing = () => ({
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('quota'); },
});
// n consecutive calendar day strings from 2024-01-01 (string arithmetic only).
const dayStrings = (n) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10));

test('the constants say what the feature promises', () => {
  assert.equal(PLACE_HELD_KEY, 'soleil.placeHeld:');
  assert.equal(PLACE_HELD_MAX_BOARDS, 200);
  assert.equal(PLACE_HELD_MAX_DAYS, 400);
  assert.equal(PLACE_HELD_HOLD_MS, 650);
  assert.equal(SLATE_LONG_MS, 4500);
  assert.equal(WORK_STAMP_EVERY_MS, 60000);
  assert.equal(PLACE_SHARE, 0.45);
});

// --- page state ---

test('heldOnce is true the first time per cluster in a page, and only then', () => {
  __resetPlaceHeldPage();
  assert.equal(heldOnce('a'), true);
  assert.equal(heldOnce('a'), false, 'a remounted workspace does not hold twice');
  assert.equal(heldOnce('b'), true, 'another cluster has its own first time');
  assert.equal(heldOnce(''), false);
  assert.equal(heldOnce(null), false);
  assert.equal(heldOnce(undefined), false);
  __resetPlaceHeldPage();
  assert.equal(heldOnce('a'), true, 'reset forgets');
});

// --- time ---

test('stampMs reads ISO strings and finite numbers and nothing else', () => {
  assert.equal(stampMs('2026-11-15T10:00:00Z'), Date.parse('2026-11-15T10:00:00Z'));
  assert.equal(stampMs(1234), 1234);
  assert.ok(Number.isNaN(stampMs('not a date')));
  assert.ok(Number.isNaN(stampMs(Infinity)));
  assert.ok(Number.isNaN(stampMs(null)));
  assert.ok(Number.isNaN(stampMs(undefined)));
  assert.ok(Number.isNaN(stampMs({})));
});

test('localDay is the local date, zero-padded', () => {
  assert.equal(localDay(L(11, 5, 9)), '2026-11-05');
  assert.equal(localDay(L(1, 2, 23, 59)), '2026-01-02');
  assert.equal(localDay(L(12, 31, 0, 0)), '2026-12-31');
  assert.equal(localDay(NaN), null);
  assert.equal(localDay(undefined), null);
  assert.equal(localDay(Infinity), null);
});

test('effectiveDay: before 5am still belongs to the day before', () => {
  assert.equal(effectiveDay(L(11, 15, 3)), '2026-11-14');
  assert.equal(effectiveDay(L(11, 15, 4, 59)), '2026-11-14');
  assert.equal(effectiveDay(L(11, 15, 5)), '2026-11-15');
  assert.equal(effectiveDay(L(11, 15, 0, 0)), '2026-11-14');
  assert.equal(effectiveDay(L(11, 1, 3)), '2026-10-31', 'across a month end');
  assert.equal(effectiveDay(L(1, 1, 2)), '2025-12-31', 'across a year end');
  assert.equal(effectiveDay(NaN), null);
});

test('dayDiff counts whole calendar days, across a month end', () => {
  assert.equal(dayDiff('2026-10-31', '2026-11-02'), 2);
  assert.equal(dayDiff('2026-11-02', '2026-10-31'), -2);
  assert.equal(dayDiff('2026-11-15', '2026-11-15'), 0);
  assert.equal(dayDiff('2026-02-27', '2026-03-01'), 2);
  assert.equal(dayDiff('2025-12-31', '2026-01-01'), 1);
  assert.ok(Number.isNaN(dayDiff('nope', '2026-11-15')));
  assert.ok(Number.isNaN(dayDiff('2026-11-15', null)));
  assert.ok(Number.isNaN(dayDiff(undefined, undefined)));
});

test('partOf cuts the day at 5, 12, 17 and 22', () => {
  assert.equal(partOf(L(11, 15, 4, 59)), 'late');
  assert.equal(partOf(L(11, 15, 5, 0)), 'morning');
  assert.equal(partOf(L(11, 15, 11, 59)), 'morning');
  assert.equal(partOf(L(11, 15, 12, 0)), 'afternoon');
  assert.equal(partOf(L(11, 15, 16, 59)), 'afternoon');
  assert.equal(partOf(L(11, 15, 17, 0)), 'evening');
  assert.equal(partOf(L(11, 15, 21, 59)), 'evening');
  assert.equal(partOf(L(11, 15, 22, 0)), 'late');
  assert.equal(partOf(L(11, 15, 0, 30)), 'late');
  assert.equal(partOf(NaN), null);
});

// --- the store ---

test('emptyPlaceHeld is a fresh object each time', () => {
  assert.deepEqual(emptyPlaceHeld(), { v: 1, b: {} });
  assert.notEqual(emptyPlaceHeld(), emptyPlaceHeld());
});

test('parsePlaceHeld: anything that is not the store comes back empty', () => {
  for (const raw of [null, undefined, '', 'garbage', '{', '[]', '7', 'null', '"x"',
    '{"v":2,"b":{}}', '{"b":{}}', '{"v":1}', '{"v":1,"b":null}', '{"v":1,"b":[]}', '{"v":1,"b":7}']) {
    assert.deepEqual(parsePlaceHeld(raw), emptyPlaceHeld(), String(raw));
  }
});

test('parsePlaceHeld cleans every entry and drops the ones that are not objects', () => {
  const raw = JSON.stringify({
    v: 1,
    b: {
      good: { l: 5, w: 9, d: ['2026-11-10'], o: 2 },
      messy: { l: -4, w: 'x', d: ['2026-11-12', 'nope', 7, '2026-11-10', '2026-11-12', '2026-1-1'], o: 1.5 },
      nan: { l: null, w: null, d: 'not an array', o: -1 },
      empty: {},
      str: 'nope',
      num: 3,
      nul: null,
      arr: [1, 2],
    },
  });
  assert.deepEqual(parsePlaceHeld(raw), {
    v: 1,
    b: {
      good: { l: 5, w: 9, d: ['2026-11-10'], o: 2 },
      messy: { l: 0, w: 0, d: ['2026-11-10', '2026-11-12'], o: 0 },
      nan: { l: 0, w: 0, d: [], o: 0 },
      empty: { l: 0, w: 0, d: [], o: 0 },
    },
  });
});

test('parsePlaceHeld sorts unsorted, duplicated days', () => {
  const raw = JSON.stringify({ v: 1, b: { x: { d: ['2026-11-14', '2026-11-10', '2026-11-14', '2026-11-12'] } } });
  assert.deepEqual(parsePlaceHeld(raw).b.x.d, ['2026-11-10', '2026-11-12', '2026-11-14']);
});

test('readPlaceHeld: no storage, no person, a throwing storage or nothing stored is empty', () => {
  assert.deepEqual(readPlaceHeld(null, 'u1'), emptyPlaceHeld());
  assert.deepEqual(readPlaceHeld(memStorage(), ''), emptyPlaceHeld());
  assert.deepEqual(readPlaceHeld(memStorage(), 'u1'), emptyPlaceHeld());
  assert.deepEqual(readPlaceHeld(throwing(), 'u1'), emptyPlaceHeld());
  const s = memStorage();
  s.setItem(PLACE_HELD_KEY + 'u1', 'garbage');
  assert.deepEqual(readPlaceHeld(s, 'u1'), emptyPlaceHeld());
});

test('writePlaceHeld says whether it wrote, and never throws', () => {
  const state = withVisit(emptyPlaceHeld(), 'b1', 100);
  assert.equal(writePlaceHeld(null, 'u1', state), false);
  assert.equal(writePlaceHeld(memStorage(), '', state), false);
  assert.equal(writePlaceHeld(throwing(), 'u1', state), false);
  assert.equal(writePlaceHeld(memStorage(), 'u1', state), true);
});

test('write then read round-trips, one key per person', () => {
  const s = memStorage();
  let state = emptyPlaceHeld();
  state = withVisit(state, 'b1', L(11, 14, 18));
  state = withWork(state, 'b1', L(11, 14, 19));
  state = withDays(state, 'b2', ['2026-11-01', '2026-11-03']);
  assert.equal(writePlaceHeld(s, 'u1', state), true);
  assert.deepEqual([...s.m.keys()], ['soleil.placeHeld:u1']);
  assert.deepEqual(readPlaceHeld(s, 'u1'), state);
  assert.deepEqual(readPlaceHeld(s, 'u2'), emptyPlaceHeld(), 'another person on the device sees nothing');
});

test('prune keeps the 200 clusters touched most recently, by the later of opened and worked', () => {
  const b = {};
  for (let i = 0; i < 205; i += 1) b[`b${i}`] = { l: (i + 1) * 1000, w: 0, d: [], o: 0 };
  b.b0 = { l: 1000, w: 999_999_000, d: [], o: 0 }; // old to open, but worked on lately
  const pruned = prunePlaceHeld({ v: 1, b });
  const ids = Object.keys(pruned.b);
  assert.equal(ids.length, PLACE_HELD_MAX_BOARDS);
  assert.ok(ids.includes('b0'), 'work counts as recent');
  for (const gone of ['b1', 'b2', 'b3', 'b4', 'b5']) assert.ok(!ids.includes(gone), `${gone} is the oldest`);
  for (const kept of ['b6', 'b100', 'b204']) assert.ok(ids.includes(kept), kept);
  assert.equal(Object.keys(prunePlaceHeld({ v: 1, b }, 3).b).length, 3);
  assert.equal(Object.keys(b).length, 205, 'pruning does not touch its input');
});

test('writePlaceHeld prunes on the way out', () => {
  const s = memStorage();
  const b = {};
  for (let i = 0; i < 205; i += 1) b[`b${i}`] = { l: (i + 1) * 1000, w: 0, d: [], o: 0 };
  assert.equal(writePlaceHeld(s, 'u1', { v: 1, b }), true);
  const back = readPlaceHeld(s, 'u1');
  assert.equal(Object.keys(back.b).length, 200);
  assert.ok(!('b0' in back.b));
  assert.ok('b204' in back.b);
});

test('entryOf copies what is there and defaults what is not', () => {
  assert.deepEqual(entryOf(emptyPlaceHeld(), 'x'), { l: 0, w: 0, d: [], o: 0 });
  assert.deepEqual(entryOf(null, 'x'), { l: 0, w: 0, d: [], o: 0 });
  assert.deepEqual(entryOf(emptyPlaceHeld(), 'constructor'), { l: 0, w: 0, d: [], o: 0 });
  const state = { v: 1, b: { x: { l: 1, w: 2, d: ['2026-11-01'], o: 3 } } };
  const e = entryOf(state, 'x');
  assert.deepEqual(e, { l: 1, w: 2, d: ['2026-11-01'], o: 3 });
  e.d.push('2026-11-02');
  assert.deepEqual(state.b.x.d, ['2026-11-01'], 'a copy, not the stored array');
});

test('withVisit sets when the cluster was opened and leaves its input alone', () => {
  const before = deepFreeze({ v: 1, b: { x: { l: 1, w: 2, d: ['2026-11-01'], o: 0 } } });
  const snap = clone(before);
  const after = withVisit(before, 'x', 500);
  assert.deepEqual(before, snap);
  assert.notEqual(after, before);
  assert.deepEqual(after.b.x, { l: 500, w: 2, d: ['2026-11-01'], o: 0 });
  assert.deepEqual(withVisit(emptyPlaceHeld(), 'y', 7).b.y, { l: 7, w: 0, d: [], o: 0 });
});

test('withVisit returns the same object when there is nothing to record', () => {
  const s = emptyPlaceHeld();
  assert.equal(withVisit(s, '', 5), s);
  assert.equal(withVisit(s, null, 5), s);
  assert.equal(withVisit(s, 'x', NaN), s);
  assert.equal(withVisit(s, 'x', undefined), s);
  assert.equal(withVisit(s, 'x', Infinity), s);
});

test('withWork keeps w as the latest, adds the day once and leaves its input alone', () => {
  const s0 = deepFreeze(emptyPlaceHeld());
  const s1 = withWork(s0, 'x', L(11, 14, 19));
  assert.deepEqual(s0, { v: 1, b: {} });
  assert.deepEqual(s1.b.x, { l: 0, w: L(11, 14, 19), d: ['2026-11-14'], o: 0 });
  deepFreeze(s1);
  const s2 = withWork(s1, 'x', L(11, 14, 21));
  assert.equal(s2.b.x.w, L(11, 14, 21));
  assert.deepEqual(s2.b.x.d, ['2026-11-14'], 'the same day is one day');
  deepFreeze(s2);
  const s3 = withWork(s2, 'x', L(11, 14, 9)); // an older stamp arriving late
  assert.equal(s3.b.x.w, L(11, 14, 21), 'w never goes back');
  assert.deepEqual(s3.b.x.d, ['2026-11-14']);
  const s4 = withWork(s3, 'x', L(11, 12, 10));
  assert.deepEqual(s4.b.x.d, ['2026-11-12', '2026-11-14'], 'kept sorted');
  assert.equal(s4.b.x.w, L(11, 14, 21));
  assert.deepEqual(s3.b.x.d, ['2026-11-14'], 'earlier states are untouched');
});

test('withWork returns the same object when there is nothing to record', () => {
  const s = emptyPlaceHeld();
  assert.equal(withWork(s, '', 5), s);
  assert.equal(withWork(s, 'x', NaN), s);
  assert.equal(withWork(s, undefined, 5), s);
});

test('withDays unions valid day strings, sorted and unique, and leaves its input alone', () => {
  const before = deepFreeze({ v: 1, b: { x: { l: 4, w: 5, d: ['2026-11-12'], o: 1 } } });
  const snap = clone(before);
  const after = withDays(before, 'x', ['2026-11-10', '2026-11-12', 'bad', null, 9, '2026-11-14']);
  assert.deepEqual(before, snap);
  assert.deepEqual(after.b.x, { l: 4, w: 5, d: ['2026-11-10', '2026-11-12', '2026-11-14'], o: 1 });
  assert.deepEqual(withDays(emptyPlaceHeld(), 'y', undefined).b.y, { l: 0, w: 0, d: [], o: 0 });
  const s = emptyPlaceHeld();
  assert.equal(withDays(s, '', ['2026-11-10']), s);
});

test('past 400 days the oldest go and o counts them', () => {
  const days = dayStrings(405);
  const s = withDays(emptyPlaceHeld(), 'x', days);
  assert.equal(s.b.x.d.length, PLACE_HELD_MAX_DAYS);
  assert.equal(s.b.x.o, 5);
  assert.equal(s.b.x.d[0], days[5]);
  assert.equal(s.b.x.d[399], days[404]);
  // exactly 400 is not over
  const exact = withDays(emptyPlaceHeld(), 'x', dayStrings(400));
  assert.equal(exact.b.x.d.length, 400);
  assert.equal(exact.b.x.o, 0);
  // work after the cap drops one more and counts it
  const more = withWork(s, 'x', L(11, 14, 12));
  assert.equal(more.b.x.d.length, PLACE_HELD_MAX_DAYS);
  assert.equal(more.b.x.o, 6);
  assert.equal(more.b.x.d[0], days[6]);
  assert.equal(more.b.x.d[399], '2026-11-14');
  assert.equal(s.b.x.o, 5, 'the earlier state is untouched');
});

// --- days of work on a cluster ---

const card = (id, over = {}) => ({
  id, x: 0, y: 0, w: 200, h: 150, kind: 'note',
  createdBy: 'me', createdAt: iso(11, 10), updatedBy: 'me', updatedAt: iso(11, 10), ...over,
});
const NOW = L(11, 15, 10);

test('clusterDays unions the stored days with every placed card\'s made and edited days, anyone\'s', () => {
  const entry = { l: 0, w: 0, d: ['2026-11-10'], o: 0 };
  const cards = [
    card('a', { createdAt: iso(11, 11), updatedAt: iso(11, 12), createdBy: 'them', updatedBy: 'them' }),
    card('b', { createdAt: iso(11, 11), updatedAt: iso(11, 11) }),
  ];
  assert.deepEqual(
    clusterDays({ entry, cards, boardCreatedAt: iso(11, 1), nowMs: NOW }),
    ['2026-11-10', '2026-11-11', '2026-11-12'],
  );
  assert.deepEqual(
    clusterDays({ entry: undefined, cards, boardCreatedAt: iso(11, 1), nowMs: NOW }),
    ['2026-11-11', '2026-11-12'],
    'no stored entry is fine',
  );
});

test('clusterDays ignores unplaced cards and unreadable stamps', () => {
  const cards = [
    card('a', { createdAt: iso(11, 13), updatedAt: iso(11, 13), unplaced: true }),
    card('b', { createdAt: 'garbage', updatedAt: undefined }),
    card('c', { createdAt: iso(11, 12), updatedAt: null }),
    null,
  ];
  assert.deepEqual(clusterDays({ entry: null, cards, nowMs: NOW }), ['2026-11-12']);
  assert.deepEqual(clusterDays({ entry: null, cards: null, nowMs: NOW }), []);
  assert.deepEqual(clusterDays(), []);
});

test('clusterDays drops days before the cluster was made and days after now', () => {
  const entry = { l: 0, w: 0, d: ['2026-11-09', '2026-11-10'], o: 0 };
  const cards = [card('a', { createdAt: iso(11, 11), updatedAt: iso(11, 20) })];
  assert.deepEqual(
    clusterDays({ entry, cards, boardCreatedAt: iso(11, 10), nowMs: NOW }),
    ['2026-11-10', '2026-11-11'],
    'the 9th is before the cluster existed, the 20th is a clock ahead',
  );
  assert.deepEqual(
    clusterDays({ entry, cards, boardCreatedAt: 'garbage', nowMs: NOW }),
    ['2026-11-09', '2026-11-10', '2026-11-11'],
    'an unreadable creation stamp sets no floor',
  );
  assert.deepEqual(
    clusterDays({ entry, cards, boardCreatedAt: iso(11, 10), nowMs: L(11, 11, 23) }),
    ['2026-11-10', '2026-11-11'],
    'today itself stays',
  );
});

test('clusterDays: once days have been dropped into o, older card days are already counted', () => {
  const entry = { l: 0, w: 0, d: ['2026-11-12', '2026-11-13'], o: 5 };
  const cards = [card('a', { createdAt: iso(11, 9), updatedAt: iso(11, 14) })];
  assert.deepEqual(clusterDays({ entry, cards, nowMs: NOW }), ['2026-11-12', '2026-11-13', '2026-11-14']);
  // with nothing dropped, the older day does count
  assert.deepEqual(
    clusterDays({ entry: { ...entry, o: 0 }, cards, nowMs: NOW }),
    ['2026-11-09', '2026-11-12', '2026-11-13', '2026-11-14'],
  );
});

test('dayNumber counts today once and adds the days that were dropped', () => {
  const days = ['2026-11-13', '2026-11-14'];
  assert.equal(dayNumber({ days, entry: null, nowMs: NOW }), 3, 'today is not in days: one more');
  assert.equal(dayNumber({ days: [...days, '2026-11-15'], entry: null, nowMs: NOW }), 3, 'today already in days: not twice');
  assert.equal(dayNumber({ days, entry: { o: 5 }, nowMs: NOW }), 8);
  assert.equal(dayNumber({ days: [], entry: undefined, nowMs: NOW }), 1, 'a first visit is day 1');
  assert.equal(dayNumber({ days: undefined, entry: undefined, nowMs: NOW }), 1);
  assert.equal(dayNumber({ days, entry: null, nowMs: NaN }), 2, 'no clock, no today');
});

test('the day count never goes down when a card is deleted, once the days are stored', () => {
  const cards = [
    card('a', { createdAt: iso(11, 10), updatedAt: iso(11, 10) }),
    card('b', { createdAt: iso(11, 11), updatedAt: iso(11, 12) }),
    card('c', { createdAt: iso(11, 13), updatedAt: iso(11, 13) }),
  ];
  const boardCreatedAt = iso(11, 10);
  let state = emptyPlaceHeld();
  const days1 = clusterDays({ entry: entryOf(state, 'x'), cards, boardCreatedAt, nowMs: NOW });
  assert.deepEqual(days1, ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  state = withDays(state, 'x', days1);
  const n1 = dayNumber({ days: days1, entry: entryOf(state, 'x'), nowMs: NOW });
  assert.equal(n1, 5);
  // delete the cards that carried the 12th and 13th
  const fewer = [cards[0]];
  const days2 = clusterDays({ entry: entryOf(state, 'x'), cards: fewer, boardCreatedAt, nowMs: NOW });
  assert.deepEqual(days2, days1);
  assert.equal(dayNumber({ days: days2, entry: entryOf(state, 'x'), nowMs: NOW }), n1);
  // with nothing stored, the same delete would have lowered it: that is what storing is for
  const lowered = clusterDays({ entry: emptyPlaceHeld().b.x, cards: fewer, boardCreatedAt, nowMs: NOW });
  assert.ok(lowered.length < days1.length);
});

// --- my own last touch ---

test('myTouchMs: the later of my edit and my creation, only where it is me', () => {
  const c = card('a', { createdBy: 'me', createdAt: iso(11, 10), updatedBy: 'me', updatedAt: iso(11, 12) });
  assert.equal(myTouchMs(c, 'me'), Date.parse(iso(11, 12)));
  assert.equal(myTouchMs({ ...c, updatedBy: 'them' }, 'me'), Date.parse(iso(11, 10)), 'only my creation');
  assert.equal(myTouchMs({ ...c, createdBy: 'them' }, 'me'), Date.parse(iso(11, 12)), 'only my edit');
  assert.equal(myTouchMs({ ...c, createdBy: 'them', updatedBy: 'them' }, 'me'), -Infinity);
  assert.equal(myTouchMs({ ...c, updatedAt: 'garbage' }, 'me'), Date.parse(iso(11, 10)), 'a bad stamp is ignored');
  assert.equal(myTouchMs({ ...c, updatedAt: undefined, createdAt: undefined }, 'me'), -Infinity);
  assert.equal(myTouchMs(null, 'me'), -Infinity);
  assert.equal(myTouchMs(c, ''), -Infinity);
});

test('myLastTouch: someone else\'s later update does not count, my creation of that card does', () => {
  const cards = [
    card('mine', { createdBy: 'me', createdAt: iso(11, 13), updatedBy: 'them', updatedAt: iso(11, 14) }),
    card('edited', { createdBy: 'them', createdAt: iso(11, 9), updatedBy: 'me', updatedAt: iso(11, 12) }),
    card('theirs', { createdBy: 'them', createdAt: iso(11, 14), updatedBy: 'them', updatedAt: iso(11, 14) }),
  ];
  const t = myLastTouch(cards, 'me');
  assert.equal(t.card.id, 'mine');
  assert.equal(t.at, Date.parse(iso(11, 13)));
});

test('myLastTouch ignores unplaced cards, onboarding seeds and cards without an id, and the first wins a tie', () => {
  const cards = [
    card('gone', { createdAt: iso(11, 14), updatedAt: iso(11, 14), unplaced: true }),
    card('', { createdAt: iso(11, 14), updatedAt: iso(11, 14) }),
    card('onb-welcome', { createdAt: iso(11, 15), updatedAt: iso(11, 15) }),
    card('seeded', { createdAt: iso(11, 15), updatedAt: iso(11, 15), seed: true }),
    card('first', { createdAt: iso(11, 12), updatedAt: iso(11, 12) }),
    card('second', { createdAt: iso(11, 12), updatedAt: iso(11, 12) }),
    null,
  ];
  assert.equal(myLastTouch(cards, 'me').card.id, 'first');
});

test('myLastTouch is null with no person, no list or nothing of mine', () => {
  const cards = [card('a')];
  assert.equal(myLastTouch(cards, ''), null);
  assert.equal(myLastTouch(cards, undefined), null);
  assert.equal(myLastTouch(null, 'me'), null);
  assert.equal(myLastTouch({}, 'me'), null);
  assert.equal(myLastTouch([], 'me'), null);
  assert.equal(myLastTouch([card('a', { createdBy: 'them', updatedBy: 'them' })], 'me'), null);
  assert.equal(myLastTouch([card('a', { createdAt: 'x', updatedAt: 'y' })], 'me'), null, 'no readable stamp');
});

test('lastWorkedAt is the later of my last touch and the stored work stamp', () => {
  const cards = [card('a', { createdAt: iso(11, 12), updatedAt: iso(11, 12) })];
  const touch = Date.parse(iso(11, 12));
  assert.equal(lastWorkedAt({ cards, uid: 'me', storedW: undefined }), touch);
  assert.equal(lastWorkedAt({ cards, uid: 'me', storedW: touch + 5 * MIN }), touch + 5 * MIN, 'stored is later');
  assert.equal(lastWorkedAt({ cards, uid: 'me', storedW: touch - 5 * MIN }), touch, 'touch is later');
  assert.equal(lastWorkedAt({ cards: [], uid: 'me', storedW: 5000 }), 5000, 'the card was deleted; the store remembers');
  assert.equal(lastWorkedAt({ cards, uid: 'me', storedW: 0 }), touch, 'zero is nothing stored');
  assert.equal(lastWorkedAt({ cards: [], uid: 'me', storedW: 0 }), null);
  assert.equal(lastWorkedAt({ cards: [], uid: 'me', storedW: NaN }), null);
  assert.equal(lastWorkedAt({ cards, uid: '', storedW: undefined }), null);
  assert.equal(lastWorkedAt(), null);
});

// --- the slate's words ---

test('lastWorkedLabel says nothing for today, an early-hours carry-over, the future or a week ago', () => {
  assert.equal(lastWorkedLabel({ atMs: L(11, 15, 8), nowMs: L(11, 15, 10) }), null, 'same day');
  assert.equal(lastWorkedLabel({ atMs: L(11, 14, 23), nowMs: L(11, 15, 2) }), null, 'same effective day');
  assert.equal(lastWorkedLabel({ atMs: L(11, 16, 9), nowMs: NOW }), null, 'a clock ahead');
  assert.equal(lastWorkedLabel({ atMs: L(11, 8, 15), nowMs: NOW }), null, 'seven days');
  assert.equal(lastWorkedLabel({ atMs: L(10, 1, 15), nowMs: NOW }), null, 'long ago');
  assert.equal(lastWorkedLabel({ atMs: NaN, nowMs: NOW }), null);
  assert.equal(lastWorkedLabel({ atMs: NOW, nowMs: undefined }), null);
  assert.equal(lastWorkedLabel(), null);
});

test('lastWorkedLabel: yesterday, by the effective day', () => {
  const noon = (m, d) => L(m, d, 12);
  const late = lastWorkedLabel({ atMs: L(11, 15, 1), nowMs: NOW });
  assert.deepEqual(late, { when: 'yesterday', part: 'late', dayMs: noon(11, 14) }, '1am today is last night');
  const evening = lastWorkedLabel({ atMs: L(11, 14, 19, 30), nowMs: NOW });
  assert.deepEqual(evening, { when: 'yesterday', part: 'evening', dayMs: noon(11, 14) });
  const morning = lastWorkedLabel({ atMs: L(11, 14, 6), nowMs: L(11, 15, 3) });
  assert.equal(morning, null, 'it is still yesterday at 3am');
  const early = lastWorkedLabel({ atMs: L(11, 14, 6), nowMs: L(11, 15, 5) });
  assert.deepEqual(early, { when: 'yesterday', part: 'morning', dayMs: noon(11, 14) });
});

test('lastWorkedLabel: a weekday within the last week carries local noon of that day', () => {
  const l = lastWorkedLabel({ atMs: L(11, 12, 15), nowMs: NOW });
  assert.equal(l.when, 'weekday');
  assert.equal(l.part, 'afternoon');
  assert.equal(l.dayMs, L(11, 12, 12));
  const d = new Date(l.dayMs);
  assert.equal(d.getDate(), 12);
  assert.equal(d.getHours(), 12);
  const six = lastWorkedLabel({ atMs: L(11, 9, 9), nowMs: NOW });
  assert.equal(six.when, 'weekday');
  assert.equal(six.part, 'morning');
  const small = lastWorkedLabel({ atMs: L(11, 10, 3), nowMs: NOW });
  assert.equal(small.when, 'weekday');
  assert.equal(small.part, 'late');
  assert.equal(small.dayMs, L(11, 9, 12), '3am on the 10th is the 9th\'s work');
  assert.equal(lastWorkedLabel({ atMs: L(11, 9, 3), nowMs: NOW }), null, '3am on the 9th is the 8th\'s: a full week is out');
  assert.equal(lastWorkedLabel({ atMs: L(11, 8, 12), nowMs: NOW }), null, 'a full week is out');
});

test('lastWorkedLabel works across a month end', () => {
  const l = lastWorkedLabel({ atMs: L(10, 30, 21), nowMs: L(11, 2, 10) });
  assert.equal(l.when, 'weekday');
  assert.equal(l.part, 'evening');
  assert.equal(l.dayMs, L(10, 30, 12));
});

test('lastWorkedBucket sorts a label into yesterday or the week', () => {
  assert.equal(lastWorkedBucket({ when: 'yesterday', part: 'late', dayMs: 1 }), 'yesterday');
  assert.equal(lastWorkedBucket({ when: 'weekday', part: 'morning', dayMs: 1 }), 'week');
  assert.equal(lastWorkedBucket(null), null);
  assert.equal(lastWorkedBucket(undefined), null);
  assert.equal(lastWorkedBucket({ when: 'other' }), null);
});

// --- what the slate reads ---

test('slateFor gives the day number and yesterday\'s words for work last night', () => {
  const entry = { l: 0, w: 0, d: ['2026-11-10'], o: 0 };
  const cards = [card('a', { createdAt: iso(11, 14, 19), updatedAt: iso(11, 14, 19) })];
  const r = slateFor({ entry, cards, uid: 'me', boardCreatedAt: iso(11, 10), nowMs: NOW });
  assert.deepEqual(r.days, ['2026-11-10', '2026-11-14']);
  assert.equal(r.n, 3, 'the 10th, the 14th and today');
  assert.deepEqual(r.label, { when: 'yesterday', part: 'evening', dayMs: L(11, 14, 12) });
  assert.equal(lastWorkedBucket(r.label), 'yesterday');
});

test('slateFor has no last-worked words for work today, work a week ago, or none of mine', () => {
  const entry = { l: 0, w: 0, d: ['2026-11-10'], o: 0 };
  const at = (m, d, h) => card('a', { createdAt: iso(m, d, h), updatedAt: iso(m, d, h) });
  const today = slateFor({ entry, cards: [at(11, 15, 8)], uid: 'me', boardCreatedAt: iso(11, 10), nowMs: NOW });
  assert.equal(today.label, null, 'work this morning is nothing to say');
  assert.equal(today.n, 2, 'and today counts once');
  const week = slateFor({ entry: null, cards: [at(11, 8, 12)], uid: 'me', boardCreatedAt: iso(11, 1), nowMs: NOW });
  assert.equal(week.label, null, 'a full week ago says nothing');
  const theirs = card('a', { createdBy: 'them', updatedBy: 'them', createdAt: iso(11, 14, 19), updatedAt: iso(11, 14, 19) });
  const other = slateFor({ entry, cards: [theirs], uid: 'me', boardCreatedAt: iso(11, 10), nowMs: NOW });
  assert.equal(other.label, null, 'someone else\'s work is not my last worked');
  assert.equal(other.n, 3, 'but it is a day worked on the cluster');
  const fresh = slateFor({ entry: null, cards: [], uid: 'me', nowMs: NOW });
  assert.deepEqual(fresh, { days: [], n: 1, label: null }, 'a first visit is day 1');
  assert.equal(slateFor().label, null);
});

test('slateFor names a weekday within the week, and the store fills in for a card since deleted', () => {
  const wk = slateFor({ entry: null, cards: [card('a', { createdAt: iso(11, 12, 15), updatedAt: iso(11, 12, 15) })], uid: 'me', boardCreatedAt: iso(11, 1), nowMs: NOW });
  assert.equal(wk.label.when, 'weekday');
  assert.equal(wk.label.part, 'afternoon');
  assert.equal(wk.label.dayMs, L(11, 12, 12));
  assert.equal(lastWorkedBucket(wk.label), 'week');
  const gone = slateFor({ entry: { l: 0, w: L(11, 14, 20), d: [], o: 0 }, cards: [], uid: 'me', nowMs: NOW });
  assert.deepEqual(gone.label, { when: 'yesterday', part: 'evening', dayMs: L(11, 14, 12) });
});

test('slateFor leaves its input alone', () => {
  const entry = deepFreeze({ l: 1, w: 2, d: ['2026-11-10'], o: 0 });
  const cards = deepFreeze([card('a', { createdAt: iso(11, 14, 19), updatedAt: iso(11, 14, 19) })]);
  assert.doesNotThrow(() => slateFor({ entry, cards, uid: 'me', boardCreatedAt: iso(11, 10), nowMs: NOW }));
});

// --- the device side: what App writes as you go ---

// A memory storage that counts what it was asked, for the writers that must stay
// quiet. `stored` reads the entry straight from the map, so reading it counts nothing.
const countingStorage = () => {
  const s = memStorage();
  const calls = { get: 0, set: 0 };
  return {
    getItem: (k) => { calls.get += 1; return s.getItem(k); },
    setItem: (k, v) => { calls.set += 1; s.setItem(k, v); },
    calls,
    m: s.m,
  };
};
const stored = (s, uid, boardId) => entryOf(parsePlaceHeld(s.m.get(PLACE_HELD_KEY + uid)), boardId);
const LS = (m, d, h, mi, sec) => new Date(2026, m - 1, d, h, mi, sec).getTime();

test('deviceStorage is localStorage when there is one, and null when there is none or it throws', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    const fake = memStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true, writable: true });
    assert.equal(deviceStorage(), fake);
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true, writable: true });
    assert.equal(deviceStorage(), null);
    Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('denied'); }, configurable: true });
    assert.equal(deviceStorage(), null, 'a blocked storage throws on access');
  } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  }
});

test('noteVisit sets when the cluster was opened, keeps the rest, and says whether it wrote', () => {
  __resetPlaceHeldWrites();
  const s = memStorage();
  assert.equal(noteWork(s, 'me', 'x', L(11, 14, 12)), true);
  assert.equal(noteVisit(s, 'me', 'x', L(11, 15, 10)), true);
  assert.deepEqual(entryOf(readPlaceHeld(s, 'me'), 'x'), { l: L(11, 15, 10), w: L(11, 14, 12), d: ['2026-11-14'], o: 0 });
  assert.equal(noteVisit(s, 'me', 'x', L(11, 15, 11)), true);
  assert.equal(entryOf(readPlaceHeld(s, 'me'), 'x').l, L(11, 15, 11), 'the latest visit');
  assert.equal(entryOf(readPlaceHeld(s, 'you'), 'x').l, 0, 'another person on this device has their own');
  assert.equal(noteVisit(null, 'me', 'x', NOW), false);
  assert.equal(noteVisit(s, '', 'x', NOW), false);
  assert.equal(noteVisit(s, 'me', '', NOW), false);
  assert.equal(noteVisit(s, 'me', 'x', NaN), false);
  assert.equal(noteVisit(throwing(), 'me', 'x', NOW), false, 'a storage that throws is not an error');
});

test('noteWork writes the first stamp, skips the rest of that minute without reading, and goes again after it', () => {
  __resetPlaceHeldWrites();
  const s = countingStorage();
  const t0 = L(11, 15, 10);
  assert.equal(noteWork(s, 'me', 'x', t0), true);
  assert.deepEqual(s.calls, { get: 1, set: 1 });
  assert.equal(noteWork(s, 'me', 'x', t0 + 1000), false, 'a second on: nothing');
  assert.equal(noteWork(s, 'me', 'x', t0 + WORK_STAMP_EVERY_MS - 1), false, 'a hair under a minute: nothing');
  assert.deepEqual(s.calls, { get: 1, set: 1 }, 'a skipped stamp does not even read');
  assert.equal(noteWork(s, 'me', 'x', t0 + WORK_STAMP_EVERY_MS), true, 'a minute on: again');
  assert.deepEqual(s.calls, { get: 2, set: 2 });
  const e = stored(s, 'me', 'x');
  assert.equal(e.w, t0 + WORK_STAMP_EVERY_MS, 'the later stamp is the one kept');
  assert.deepEqual(e.d, ['2026-11-15']);
  // the minute runs from the last stamp that went through, not from the first
  assert.equal(noteWork(s, 'me', 'x', t0 + WORK_STAMP_EVERY_MS + 1000), false);
  assert.equal(noteWork(s, 'me', 'x', t0 + 2 * WORK_STAMP_EVERY_MS), true);
});

test('noteWork goes through at once on a new local day, even seconds after the last stamp', () => {
  __resetPlaceHeldWrites();
  const s = countingStorage();
  assert.equal(noteWork(s, 'me', 'x', LS(11, 14, 23, 59, 40)), true);
  assert.equal(noteWork(s, 'me', 'x', LS(11, 14, 23, 59, 50)), false, 'the same night');
  assert.equal(noteWork(s, 'me', 'x', LS(11, 15, 0, 0, 10)), true, '30 seconds on, but a new day');
  assert.equal(s.calls.set, 2);
  assert.deepEqual(stored(s, 'me', 'x').d, ['2026-11-14', '2026-11-15']);
  assert.equal(noteWork(s, 'me', 'x', LS(11, 15, 0, 0, 20)), false, 'and then the minute starts over');
});

test('noteWork keeps its minute per person and per cluster', () => {
  __resetPlaceHeldWrites();
  const s = countingStorage();
  const t0 = L(11, 15, 10);
  assert.equal(noteWork(s, 'me', 'x', t0), true);
  assert.equal(noteWork(s, 'me', 'y', t0 + 1), true, 'another cluster has its own minute');
  assert.equal(noteWork(s, 'you', 'x', t0 + 2), true, 'so does another person');
  assert.equal(noteWork(s, 'me', 'x', t0 + 3), false);
  assert.equal(s.calls.set, 3);
  assert.equal(stored(s, 'me', 'x').w, t0);
  assert.equal(stored(s, 'me', 'y').w, t0 + 1);
  assert.equal(stored(s, 'you', 'x').w, t0 + 2);
  __resetPlaceHeldWrites();
  assert.equal(noteWork(s, 'me', 'x', t0 + 4), true, 'reset forgets the minute');
});

test('noteWork: bad input writes nothing and starts no minute, and a failing storage is tried once a minute', () => {
  __resetPlaceHeldWrites();
  const s = countingStorage();
  const t0 = L(11, 15, 10);
  assert.equal(noteWork(null, 'me', 'x', t0), false);
  assert.equal(noteWork(s, '', 'x', t0), false);
  assert.equal(noteWork(s, 'me', '', t0), false);
  assert.equal(noteWork(s, 'me', 'x', NaN), false);
  assert.deepEqual(s.calls, { get: 0, set: 0 });
  assert.equal(noteWork(s, 'me', 'x', t0), true, 'none of that used up the minute');
  __resetPlaceHeldWrites();
  let sets = 0;
  const failing = { getItem: () => null, setItem() { sets += 1; throw new Error('quota'); } };
  assert.equal(noteWork(failing, 'me', 'x', t0), false);
  assert.equal(noteWork(failing, 'me', 'x', t0 + 1000), false);
  assert.equal(sets, 1, 'not retried on every save');
  assert.equal(noteWork(failing, 'me', 'x', t0 + WORK_STAMP_EVERY_MS), false);
  assert.equal(sets, 2, 'tried again a minute on');
  __resetPlaceHeldWrites();
});

test('noteDays stores the days it is given and writes nothing when nothing changed', () => {
  const s = countingStorage();
  const days = ['2026-11-10', '2026-11-12'];
  assert.equal(noteDays(s, 'me', 'x', days), true);
  assert.equal(s.calls.set, 1);
  assert.deepEqual(stored(s, 'me', 'x').d, days);
  assert.equal(noteDays(s, 'me', 'x', days), false, 'the same days: no write');
  assert.equal(noteDays(s, 'me', 'x', ['2026-11-10']), false, 'days it already has: no write');
  assert.equal(noteDays(s, 'me', 'x', []), false);
  assert.equal(noteDays(s, 'me', 'y', []), false, 'nothing to keep for a cluster it never saw: no empty entry');
  assert.equal(stored(s, 'me', 'y').d.length, 0);
  assert.equal(s.m.has(PLACE_HELD_KEY + 'me'), true);
  assert.equal(JSON.parse(s.m.get(PLACE_HELD_KEY + 'me')).b.y, undefined);
  assert.equal(s.calls.set, 1, 'one write in all');
  assert.equal(noteDays(s, 'me', 'x', ['2026-11-13']), true, 'a new day writes');
  assert.deepEqual(stored(s, 'me', 'x').d, ['2026-11-10', '2026-11-12', '2026-11-13']);
  assert.equal(s.calls.set, 2);
});

test('noteDays keeps the rest of the entry, ignores bad input and never throws', () => {
  __resetPlaceHeldWrites();
  const s = memStorage();
  noteVisit(s, 'me', 'x', L(11, 15, 9));
  noteWork(s, 'me', 'x', L(11, 14, 12));
  assert.equal(noteDays(s, 'me', 'x', ['2026-11-01']), true);
  assert.deepEqual(entryOf(readPlaceHeld(s, 'me'), 'x'), {
    l: L(11, 15, 9), w: L(11, 14, 12), d: ['2026-11-01', '2026-11-14'], o: 0,
  });
  assert.equal(noteDays(null, 'me', 'x', ['2026-11-02']), false);
  assert.equal(noteDays(s, '', 'x', ['2026-11-02']), false);
  assert.equal(noteDays(s, 'me', '', ['2026-11-02']), false);
  assert.equal(noteDays(throwing(), 'me', 'x', ['2026-11-02']), false);
  assert.equal(noteDays(s, 'me', 'x', 'nonsense'), false, 'days that are not a list add nothing');
  assert.equal(noteDays(s, 'me', 'x', ['not a day']), false, 'neither do strings that are not days');
  __resetPlaceHeldWrites();
});

test('past the day cap, reading the days through slateFor and storing them settles: the count holds and nothing rewrites', () => {
  const s = countingStorage();
  s.m.set(PLACE_HELD_KEY + 'me', JSON.stringify({ v: 1, b: { x: { l: 0, w: 0, d: dayStrings(PLACE_HELD_MAX_DAYS), o: 5 } } }));
  const cards = [
    card('older', { createdAt: new Date(2023, 5, 1, 12).toISOString(), updatedAt: new Date(2023, 5, 1, 12).toISOString() }),
    card('newest', { createdAt: iso(11, 14), updatedAt: iso(11, 14) }),
  ];
  const boardCreatedAt = new Date(2023, 4, 1, 12).toISOString();
  const open = () => {
    const r = slateFor({ entry: entryOf(readPlaceHeld(s, 'me'), 'x'), cards, uid: 'me', boardCreatedAt, nowMs: NOW });
    noteDays(s, 'me', 'x', r.days);
    return r.n;
  };
  const first = open();
  assert.equal(first, 5 + PLACE_HELD_MAX_DAYS + 2, 'the 5 dropped, the 400 stored, the newest card\'s day and today');
  const writes = s.calls.set;
  assert.equal(writes, 1, 'the new day went in, and the oldest day went out into o');
  assert.equal(stored(s, 'me', 'x').o, 6);
  assert.equal(stored(s, 'me', 'x').d.length, PLACE_HELD_MAX_DAYS);
  assert.equal(open(), first, 'the next open reads the same number');
  assert.equal(open(), first);
  assert.equal(s.calls.set, writes, 'and writes nothing: the older card does not push o up again');
});

test('work noted as it happens is what the slate reads once the cards are gone', () => {
  __resetPlaceHeldWrites();
  const s = memStorage();
  noteWork(s, 'me', 'x', L(11, 12, 15));
  noteWork(s, 'me', 'x', L(11, 14, 19));
  const r = slateFor({ entry: entryOf(readPlaceHeld(s, 'me'), 'x'), cards: [], uid: 'me', boardCreatedAt: iso(11, 1), nowMs: NOW });
  assert.equal(r.n, 3, 'the 12th, the 14th and today');
  assert.deepEqual(r.label, { when: 'yesterday', part: 'evening', dayMs: L(11, 14, 12) });
  __resetPlaceHeldWrites();
});

// --- the break gate ---

test('isRealBreak: never seen here and nothing of mine counts as a break', () => {
  assert.equal(isRealBreak({ nowMs: NOW }), true);
  assert.equal(isRealBreak({ nowMs: NOW, lastVisitMs: 0, myTouchMs: -Infinity }), true);
  assert.equal(isRealBreak({ nowMs: NOW, lastVisitMs: NaN, myTouchMs: NaN }), true);
});

test('isRealBreak: half an hour is the line', () => {
  assert.equal(isRealBreak({ nowMs: NOW, lastVisitMs: NOW - 29 * MIN }), false);
  assert.equal(isRealBreak({ nowMs: NOW, lastVisitMs: NOW - RESUME_GAP_MS }), true);
  assert.equal(isRealBreak({ nowMs: NOW, lastVisitMs: NOW - 30 * MIN }), true);
  assert.equal(isRealBreak({ nowMs: NOW, lastVisitMs: NOW - RESUME_GAP_MS + 1 }), false);
});

test('isRealBreak: the most recent of the visit and my touch decides', () => {
  assert.equal(isRealBreak({ nowMs: NOW, lastVisitMs: NOW - 3 * 3600_000, myTouchMs: NOW - 5 * MIN }), false, 'a touch 5 min ago beats an old visit');
  assert.equal(isRealBreak({ nowMs: NOW, lastVisitMs: NOW - 5 * MIN, myTouchMs: NOW - 3 * 3600_000 }), false);
  assert.equal(isRealBreak({ nowMs: NOW, lastVisitMs: NOW - 3 * 3600_000, myTouchMs: NOW - 5 * 3600_000 }), true);
  assert.equal(isRealBreak({ nowMs: NOW, myTouchMs: NOW - 2 * 3600_000 }), true, 'a touch alone');
});

test('isRealBreak: a touch in the future is not a break, and no clock is not one either', () => {
  assert.equal(isRealBreak({ nowMs: NOW, myTouchMs: NOW + 10 * MIN }), false);
  assert.equal(isRealBreak({ nowMs: NOW, lastVisitMs: NOW + 10 * MIN }), false);
  assert.equal(isRealBreak({ nowMs: NaN, lastVisitMs: 1 }), false);
  assert.equal(isRealBreak({}), false);
  assert.equal(isRealBreak(), false);
});

// --- where the held open lands ---

const plan = {
  uid: 'me',
  cards: [
    card('c1', { x: 100, y: 200, w: 300, h: 200, createdAt: iso(11, 10), updatedAt: iso(11, 12), updatedBy: 'me' }),
    card('c2', { x: 900, y: 900, createdAt: iso(11, 9), updatedAt: iso(11, 9) }),
  ],
  nowMs: NOW,
  lastVisitMs: L(11, 12, 18),
  isPublic: false,
  deepLink: false,
};

test('planHeldOpen: after a real break it points at the card I touched last', () => {
  const p = planHeldOpen(plan);
  assert.equal(p.card.id, 'c1');
  assert.equal(p.at, Date.parse(iso(11, 12)));
  assert.equal(planHeldOpen({ ...plan, lastVisitMs: undefined }).card.id, 'c1', 'never opened here');
});

test('planHeldOpen: a public view, a deep link, no person or nothing of mine holds nothing', () => {
  assert.equal(planHeldOpen({ ...plan, isPublic: true }), null);
  assert.equal(planHeldOpen({ ...plan, deepLink: true }), null);
  assert.equal(planHeldOpen({ ...plan, uid: '' }), null);
  assert.equal(planHeldOpen({ ...plan, uid: undefined }), null);
  assert.equal(planHeldOpen({ ...plan, uid: 'stranger' }), null);
  assert.equal(planHeldOpen({ ...plan, cards: [] }), null);
  assert.equal(planHeldOpen({ ...plan, cards: null }), null);
  assert.equal(planHeldOpen(), null);
});

test('planHeldOpen: a short break holds nothing', () => {
  assert.equal(planHeldOpen({ ...plan, lastVisitMs: NOW - 10 * MIN }), null);
  const fresh = [card('c1', { x: 1, y: 1, updatedAt: new Date(NOW - 5 * MIN).toISOString() })];
  assert.equal(planHeldOpen({ ...plan, cards: fresh }), null, 'I touched it five minutes ago');
});

test('planHeldOpen: a card with no size cannot be settled on', () => {
  const sized = (over) => [{ ...plan.cards[0], ...over }];
  assert.equal(planHeldOpen({ ...plan, cards: sized({ w: 0 }) }), null);
  assert.equal(planHeldOpen({ ...plan, cards: sized({ h: -3 }) }), null);
  assert.equal(planHeldOpen({ ...plan, cards: sized({ w: NaN }) }), null);
  assert.equal(planHeldOpen({ ...plan, cards: sized({ h: undefined }) }), null);
  assert.equal(planHeldOpen({ ...plan, cards: sized({ w: '300' }) }), null);
});

// --- the camera ---

const view = { fitZoom: 0.2, viewW: 1200, viewH: 800 };
const centreOf = (card, cam) => ({
  x: (card.x + card.w / 2) * cam.zoom + cam.pan.x,
  y: (card.y + card.h / 2) * cam.zoom + cam.pan.y,
});

test('settleCamera: a small card zooms to the share of the view, never past maxZoom', () => {
  const c = { x: 1000, y: 500, w: 400, h: 300 };
  const cam = settleCamera({ card: c, ...view, maxZoom: 3 });
  assert.ok(Math.abs(cam.zoom - (PLACE_SHARE * 800) / 300) < 1e-9, 'height is the tighter side: 0.45 * 800 / 300');
  const capped = settleCamera({ card: c, ...view });
  assert.equal(capped.zoom, 1, 'maxZoom defaults to 1');
  const tiny = settleCamera({ card: { x: 0, y: 0, w: 20, h: 10 }, ...view, maxZoom: 2 });
  assert.equal(tiny.zoom, 2);
  const wide = settleCamera({ card: { x: 0, y: 0, w: 1000, h: 50 }, ...view, maxZoom: 5 });
  assert.ok(Math.abs(wide.zoom - (PLACE_SHARE * 1200) / 1000) < 1e-9, 'width is the tighter side');
  const half = settleCamera({ card: c, ...view, maxZoom: 3, share: 0.9 });
  assert.ok(Math.abs(half.zoom - (0.9 * 800) / 300) < 1e-9, 'share is a parameter');
});

test('settleCamera: a huge card keeps the fit view, never zooming out from it', () => {
  const cam = settleCamera({ card: { x: 0, y: 0, w: 5000, h: 4000 }, ...view });
  assert.equal(cam.zoom, view.fitZoom);
});

test('settleCamera: the card\'s centre lands at the centre of the area right of the rail', () => {
  const cases = [
    { card: { x: 1000, y: 500, w: 400, h: 300 }, railDx: 0 },
    { card: { x: -300, y: -80, w: 400, h: 300 }, railDx: 320 },
    { card: { x: 250, y: 4000, w: 5000, h: 4000 }, railDx: 64 },
    { card: { x: 7, y: 9, w: 20, h: 10 }, railDx: 200, maxZoom: 2 },
  ];
  for (const k of cases) {
    const cam = settleCamera({ ...k, ...view });
    const c = centreOf(k.card, cam);
    assert.ok(Math.abs(c.x - (k.railDx + (view.viewW - k.railDx) / 2)) < 1e-9, `x for ${JSON.stringify(k)}`);
    assert.ok(Math.abs(c.y - view.viewH / 2) < 1e-9, `y for ${JSON.stringify(k)}`);
  }
});

test('settleCamera: bad input is null', () => {
  const card0 = { x: 10, y: 10, w: 200, h: 100 };
  assert.ok(settleCamera({ card: card0, ...view }));
  assert.equal(settleCamera(), null);
  assert.equal(settleCamera({ ...view }), null, 'no card');
  assert.equal(settleCamera({ card: null, ...view }), null);
  for (const bad of [{ x: NaN }, { y: undefined }, { w: NaN }, { h: Infinity }, { w: 0 }, { h: 0 }, { w: -5 }, { h: -5 }]) {
    assert.equal(settleCamera({ card: { ...card0, ...bad }, ...view }), null, JSON.stringify(bad));
  }
  assert.equal(settleCamera({ card: card0, ...view, fitZoom: NaN }), null);
  assert.equal(settleCamera({ card: card0, ...view, fitZoom: undefined }), null);
  assert.equal(settleCamera({ card: card0, ...view, viewW: NaN }), null);
  assert.equal(settleCamera({ card: card0, ...view, viewH: NaN }), null);
  assert.equal(settleCamera({ card: card0, ...view, viewH: 0 }), null);
  assert.equal(settleCamera({ card: card0, ...view, viewW: 300, railDx: 320 }), null, 'no room right of the rail');
  assert.equal(settleCamera({ card: card0, ...view, viewW: 320, railDx: 320 }), null);
  assert.equal(settleCamera({ card: card0, ...view, railDx: NaN }), null);
});

// --- day-one greeting news ---

const rows = (...list) => list.map(([card_id, ...keywords]) => ({ card_id, keywords }));
const pics3 = [{ id: 'p1', at: 1000 }, { id: 'p2', at: 2000 }, { id: 'p3', at: 3000 }];

test('searchNews needs three pictures, every one of them read', () => {
  const r = rows(['p1', 'beach'], ['p2', 'beach'], ['p3', 'beach']);
  assert.deepEqual(searchNews({ rows: r, myPictures: pics3 }), { word: 'beach', n: 3 });
  assert.equal(searchNews({ rows: r.slice(0, 2), myPictures: pics3.slice(0, 2) }), null, 'two is too few');
  assert.equal(searchNews({ rows: r, myPictures: [] }), null);
  assert.equal(searchNews({ rows: r.slice(0, 2), myPictures: pics3 }), null, 'one picture is not read yet');
  assert.equal(searchNews({ rows: [], myPictures: pics3 }), null);
  assert.equal(searchNews({ rows: null, myPictures: pics3 }), null);
  assert.equal(searchNews({ rows: r, myPictures: null }), null);
  assert.equal(searchNews(), null);
  const more = [...pics3, { id: 'p4', at: 4000 }];
  assert.equal(searchNews({ rows: r, myPictures: more }), null, 'a fourth, unread');
  assert.deepEqual(searchNews({ rows: [...r, ...rows(['p4', 'beach'], ['other', 'x'])], myPictures: more }), { word: 'beach', n: 4 });
});

test('searchNews: the keyword most of my pictures share wins', () => {
  const r = rows(
    ['p1', 'beach', 'sunset'],
    ['p2', 'sunset', 'dog'],
    ['p3', 'city', 'sunset'],
  );
  assert.deepEqual(searchNews({ rows: r, myPictures: pics3 }), { word: 'sunset', n: 3 }, 'not the newest picture\'s first');
  const two = rows(['p1', 'harbour', 'rain'], ['p2', 'harbour', 'dog'], ['p3', 'cat', 'bird']);
  assert.deepEqual(searchNews({ rows: two, myPictures: pics3 }), { word: 'harbour', n: 3 });
});

test('searchNews: a tie goes to the newest picture\'s first tied keyword', () => {
  const r = rows(['p1', 'cats', 'dogs'], ['p2', 'cats', 'dogs'], ['p3', 'dogs', 'cats']);
  assert.equal(searchNews({ rows: r, myPictures: pics3 }).word, 'dogs', 'p3 is newest and lists dogs first');
  // the order pictures arrive in does not matter, their times do
  assert.equal(searchNews({ rows: r, myPictures: [pics3[2], pics3[0], pics3[1]] }).word, 'dogs');
  const flipped = [{ id: 'p1', at: 3000 }, { id: 'p2', at: 2000 }, { id: 'p3', at: 1000 }];
  assert.equal(searchNews({ rows: r, myPictures: flipped }).word, 'cats', 'now p1 is the newest');
});

test('searchNews: when the newest picture has no tied keyword the next newest speaks', () => {
  const r = rows(['p1', 'tree', 'moss'], ['p2', 'fern', 'tree'], ['p3', 'zebra']);
  assert.deepEqual(searchNews({ rows: r, myPictures: pics3 }), { word: 'tree', n: 3 });
  // a picture with no time counts as the oldest
  const undated = [{ id: 'p1', at: NaN }, { id: 'p2', at: 2000 }, { id: 'p3', at: 1000 }];
  const t = rows(['p1', 'tree', 'moss'], ['p2', 'moss', 'tree'], ['p3', 'tree', 'moss']);
  assert.equal(searchNews({ rows: t, myPictures: undated }).word, 'moss', 'p2 is the newest dated one');
  const allUndated = pics3.map((p) => ({ ...p, at: undefined }));
  assert.equal(searchNews({ rows: t, myPictures: allUndated }).word, 'tree', 'stable: the first picture leads');
});

test('searchNews skips keywords that are too short, too long or not words', () => {
  const junk = ['ab', 'x'.repeat(25), '#sunset', '-dash', "'quote", '', '   ', 42, null, undefined, { a: 1 }, 'a_b', 'sun!', 'emoji ☀'];
  const r = rows(['p1', ...junk, 'river'], ['p2', ...junk, 'river'], ['p3', ...junk, 'river']);
  assert.deepEqual(searchNews({ rows: r, myPictures: pics3 }), { word: 'river', n: 3 });
  const allJunk = rows(['p1', ...junk], ['p2', ...junk], ['p3', ...junk]);
  assert.equal(searchNews({ rows: allJunk, myPictures: pics3 }), null, 'no keywords at all');
  const same = (kw) => rows(['p1', kw], ['p2', kw], ['p3', kw]);
  assert.equal(searchNews({ rows: same('abc'), myPictures: pics3 }).word, 'abc', 'three characters are in');
  assert.equal(searchNews({ rows: same('x'.repeat(24)), myPictures: pics3 }).word, 'x'.repeat(24), 'twenty-four are in');
  assert.equal(searchNews({ rows: same('x'.repeat(25)), myPictures: pics3 }), null, 'twenty-five are not');
  assert.equal(searchNews({ rows: same('ab'), myPictures: pics3 }), null, 'two are not');
  const okShapes = rows(['p1', "rock 'n' roll", 'café', 'ice-cream', '  river  '], ['p2', 'ice-cream'], ['p3', 'ice-cream']);
  assert.equal(searchNews({ rows: okShapes, myPictures: pics3 }).word, 'ice-cream');
  const trimmed = rows(['p1', '  river  '], ['p2', 'river'], ['p3', 'river']);
  assert.equal(searchNews({ rows: trimmed, myPictures: pics3 }).word, 'river', 'spaces around a word are not part of it');
  const unicode = rows(['p1', 'café'], ['p2', 'café'], ['p3', 'montaña']);
  assert.equal(searchNews({ rows: unicode, myPictures: pics3 }).word, 'café');
  const odd = [{ card_id: 'p1', keywords: undefined }, { card_id: 'p2', keywords: 'beach' }, { card_id: 'p3', keywords: null }];
  assert.equal(searchNews({ rows: odd, myPictures: pics3 }), null, 'a picture whose keyword list is missing or odd has none');
  const oneBare = [{ card_id: 'p1' }, ...rows(['p2', 'beach'], ['p3', 'beach'])];
  assert.equal(searchNews({ rows: oneBare, myPictures: pics3 }).word, 'beach', 'and the others still count');
});

test('searchNews counts case-insensitively, once per picture, and keeps the spelling it saw', () => {
  const r = rows(['p1', 'Sunset', 'sunset', 'SUNSET'], ['p2', 'SUNSET'], ['p3', 'sunset']);
  const newestFirst = [{ id: 'p1', at: 3000 }, { id: 'p2', at: 2000 }, { id: 'p3', at: 1000 }];
  assert.deepEqual(searchNews({ rows: r, myPictures: newestFirst }), { word: 'Sunset', n: 3 }, 'the first spelling in the newest picture');
  assert.deepEqual(searchNews({ rows: r, myPictures: pics3 }), { word: 'sunset', n: 3 }, 'p3 is newest here and spells it its own way');
  // one picture repeating a word is still one picture
  const once = rows(['p1', 'Sunset', 'sunset'], ['p2', 'beach'], ['p3', 'beach']);
  assert.equal(searchNews({ rows: once, myPictures: [{ id: 'p1', at: 3000 }, { id: 'p2', at: 2000 }, { id: 'p3', at: 1000 }] }).word, 'beach');
});

test('searchNews matches card ids as strings, whichever way they arrive', () => {
  const numeric = rows([1, 'harbour'], [2, 'harbour'], [3, 'harbour']);
  assert.deepEqual(searchNews({ rows: numeric, myPictures: [{ id: '1', at: 1 }, { id: '2', at: 2 }, { id: '3', at: 3 }] }), { word: 'harbour', n: 3 });
  const strings = rows(['1', 'harbour'], ['2', 'harbour'], ['3', 'harbour']);
  assert.deepEqual(searchNews({ rows: strings, myPictures: [{ id: 1, at: 1 }, { id: 2, at: 2 }, { id: 3, at: 3 }] }), { word: 'harbour', n: 3 });
  const mixed = rows([1, 'harbour'], ['2', 'harbour'], [3, 'harbour']);
  assert.equal(searchNews({ rows: mixed, myPictures: [{ id: 1, at: 1 }, { id: 2, at: 2 }, { id: '3', at: 3 }] }).n, 3);
});
