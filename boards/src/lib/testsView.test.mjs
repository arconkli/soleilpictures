// testsView.test.mjs — the words on the admin's Tests page, from invented reads.
//
//   node --test src/lib/testsView.test.mjs
//
// Every count here is made up. What is pinned is the rules: when a gap may be
// called, when a side is too small, when a check asks for a look.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testByKey } from './testsCatalog.js';
import {
  MIN_N, MIN_EVENTS, gapOf, mhGapOf, exactRange, reachOf, wilson, spanOf, splitP, verdictOf, checksOf,
  healthOf, measureRows, testsPage, fmtDay, fmtSince, fmtUntil, splitNote, timelineOf, missesOf, strataOf, signupStrataOf,
} from './testsView.js';

const NOW = '2026-11-20T12:00:00Z';
const LATE = '2027-02-01T12:00:00Z';
const more = testByKey('first_board_more');
const box = testByKey('signup_box');
const email = testByKey('email_holdout');
const share = testByKey('share_ask');
const trial = testByKey('trial_early');
// Shapes no running test has today, made from the real ones.
const offTest = { ...more, offNote: 'Off for now.' };
const rotation = { key: 'rot', group: 'waiting', kind: 'rotation', unit: 'email', registry: false, name: 'Two versions', what: 'x', aName: 'Version A', a: 'x', bName: 'Version B', b: 'x', reads: [], verdictIso: null, measures: [], signals: [] };

const side = (n, k) => ({ n, k });
const near = (a, b, eps, what) => assert.ok(Math.abs(a - b) < eps, `${what}: ${a} is not ${b}`);
const healthy = (over = {}) => ({
  in: { A: 60, B: 62 },
  eligible: 140,
  recent: { eligible: 12, assigned: 10 },
  last: { A: '2026-11-20T09:00:00Z', B: '2026-11-20T10:00:00Z' },
  mismatched: 0,
  measures: {
    ten_after_1d: { A: side(50, 10), B: side(52, 14), due: 122, next: '2026-11-21T08:00:00Z' },
    back_7d: { A: side(50, 10), B: side(52, 14), due: 122, next: '2026-11-21T08:00:00Z' },
    card_1d: { A: side(58, 40), B: side(60, 41), due: 122, next: null },
  },
  ...over,
});
const state = (checks, id) => checks.find((c) => c.id === id)?.state;

test('dates read in UTC', () => {
  assert.equal(fmtDay('2026-11-19'), 'Nov 19');
  assert.equal(fmtSince('2026-11-20T04:42:00Z', NOW), '04:42 today');
  assert.match(fmtSince('2026-11-19T22:10:00Z', NOW), /^yesterday/);
  assert.match(fmtUntil('2026-11-21T07:00:00Z', NOW), /^tomorrow/);
});

test('fewer than MIN_N on a side is too few to read', () => {
  assert.deepEqual(gapOf({ A: side(MIN_N - 1, 5), B: side(200, 50) }), { few: true, min: MIN_N - 1 });
  const g = gapOf({ A: side(400, 100), B: side(400, 100) });
  assert.equal(g.d, 0);
  assert.ok(g.lo < 0 && g.hi > 0);
  assert.equal(spanOf([g]), 40);
  assert.equal(spanOf([{ d: 0, lo: -47, hi: 3 }]), 50);
});

// Newcombe (1998), Statistics in Medicine 17:873, Table II, example (a):
// 56/70 against 48/80, method 10 gives 0.0524 to 0.3339. Pinned with the
// view's z of 1.96.
test('the gap’s range is Newcombe’s hybrid score interval', () => {
  const g = gapOf({ B: side(70, 56), A: side(80, 48) });
  near(g.d, 20, 1e-9, 'gap');
  near(g.lo, 5.24, 0.01, 'low end');
  near(g.hi, 33.39, 0.01, 'high end');
  // Wilson's own interval for 0 of 10 starts at zero and is not empty.
  const w = wilson(0, 10);
  assert.equal(w.lo, 0);
  near(w.hi, 0.2775, 0.001, 'Wilson 0 of 10');
});

test('fewer than MIN_EVENTS events on both sides is too few events, never “no clear difference”', () => {
  const g = gapOf({ A: side(300, MIN_EVENTS - 1), B: side(300, 2) });
  assert.deepEqual(g, { few: true, events: true, most: MIN_EVENTS - 1 });
  // One side with enough events is readable.
  assert.ok(!gapOf({ A: side(300, MIN_EVENTS), B: side(300, 2) }).few);
  const r = healthy({ measures: { ten_after_1d: { A: side(300, 3), B: side(300, 4), due: 600 } } });
  assert.equal(verdictOf(more, r, LATE).text, 'Too few events');
});

// Two strata, by hand. Stratum 1: A 10 of 40, B 20 of 40 (N 80, weight 20,
// B·nA − A·nB over N = 5). Stratum 2: A 30 of 60, B 20 of 30 (N 90, weight 20,
// 300/90). RD = (5 + 10/3) / 40 = 5/24. Sato: P = −2.5 − 20/9, Q = 5 + 5,
// var = (RD·P + Q) / 40² = 0.0056351.
test('like for like is the Mantel-Haenszel difference with Sato’s variance', () => {
  const strata = [
    { page: 'full', phone: false, A: side(40, 10), B: side(40, 20) },
    { page: 'full', phone: true, A: side(60, 30), B: side(30, 20) },
    // A stratum with nobody on one side carries no weight.
    { page: 'held', phone: true, A: side(0, 0), B: side(5, 1) },
  ];
  const g = mhGapOf(strata);
  const rd = 5 / 24;
  const se = Math.sqrt((rd * (-2.5 - 20 / 9) + 10) / 1600);
  near(g.d, rd * 100, 1e-9, 'MH difference');
  near(g.lo, (rd - 1.96 * se) * 100, 1e-9, 'low end');
  near(g.hi, (rd + 1.96 * se) * 100, 1e-9, 'high end');
  near(se * se, 0.0056351, 1e-6, 'Sato variance');
  // One stratum alone is close to the plain two-sample range at this size.
  const one = mhGapOf([{ A: side(1000, 200), B: side(1000, 300) }]);
  near(one.d, 10, 1e-9, 'one stratum');
  near((one.hi - one.lo) / (2 * 1.96), Math.sqrt(0.00037) * 100, 1e-6, 'one stratum, its spread');
  assert.equal(mhGapOf([]), null);
  assert.deepEqual(mhGapOf([{ A: side(10, 2), B: side(12, 3) }]), { few: true, min: 10 });
});

test('signupStrataOf pools each device\'s first page into the written groups', () => {
  const pooled = signupStrataOf([
    { page: '/vs/pureref', phone: false, A: side(10, 1), B: side(20, 2) },
    { page: '/tools/mood-board-maker', phone: false, A: side(5, 1), B: side(7, 3) },
    { page: '/use-cases/x', phone: false, A: side(4, 0), B: side(6, 1) },
    { page: 'held', phone: false, A: side(3, 1), B: side(2, 0) },
    { page: '/vs/pureref', phone: true, A: side(8, 2), B: side(9, 1) },
  ]);
  const get = (page, phone) => pooled.find((x) => x.page === page && x.phone === phone);
  assert.equal(pooled.length, 4);
  assert.deepEqual(get('kept_close', false), { page: 'kept_close', phone: false, A: { n: 15, k: 2 }, B: { n: 27, k: 5 } });
  assert.deepEqual(get('full', false).A, { n: 4, k: 0 });
  assert.equal(get('held', false).A.n, 3);
  assert.equal(get('kept_close', true).A.n, 8, 'phone and desktop stay apart');
  assert.equal(signupStrataOf(undefined), undefined);
  const raw = [
    { page: '/vs/pureref', phone: false, A: side(60, 6), B: side(60, 9) },
    { page: '/tools/shot-list-maker', phone: false, A: side(40, 2), B: side(50, 6) },
    { page: '/', phone: true, A: side(60, 3), B: side(60, 6) },
  ];
  const row = measureRows(box, { in: { A: 100, B: 100 }, strata: raw, measures: {} }, NOW).rows.find((x) => x.m.id === 'signup_like');
  near(row.gap.d, mhGapOf(signupStrataOf(raw)).d, 1e-9, 'like for like on pooled strata');
});

test('the sign-up box is decided like for like, with the raw line beside it', () => {
  const r = {
    in: { A: 200, B: 200 },
    strata: [
      { page: 'full', phone: true, A: side(60, 3), B: side(60, 6) },
      { page: 'kept_close', phone: false, A: side(80, 8), B: side(70, 10) },
      { page: 'full', phone: false, A: side(60, 6), B: side(70, 9) },
    ],
    measures: { signup_1d: { A: side(200, 17), B: side(200, 25), due: 400 } },
  };
  const rows = measureRows(box, r, NOW).rows;
  const like = rows.find((x) => x.m.id === 'signup_like');
  assert.equal(like.A.n, 200);
  assert.equal(like.B.k, 25);
  near(like.gap.d, mhGapOf(r.strata).d, 1e-9, 'like for like');
  assert.ok(rows.find((x) => x.m.id === 'signup_1d').gap);
  // Kept close first, desktops before phones.
  assert.deepEqual(strataOf(box, r).map((x) => x.label), ['Kept close · desktop', 'Full stage · desktop', 'Full stage · phone']);
  // A read that predates the strata says so.
  const old = { in: { A: 50, B: 50 }, measures: {} };
  assert.equal(measureRows(box, old, NOW).rows[0].pending, 'Not in the read yet');
});

test('the exact binomial range', () => {
  const r = exactRange(8, 10);
  near(r.lo, 0.4439, 1e-4, '8 of 10, low');
  near(r.hi, 0.9748, 1e-4, '8 of 10, high');
  near(exactRange(0, 10).hi, 0.3085, 1e-4, '0 of 10, high');
  assert.equal(exactRange(0, 10).lo, 0);
  assert.equal(exactRange(10, 10).hi, 1);
});

test('the share ask reads its reach against its target, by the exact range, from its read date', () => {
  const target = share.measures.find((m) => m.id === 'reach_load').target;
  assert.equal(reachOf(side(100, 90), target).state, 'reaching');
  assert.equal(reachOf(side(100, 70), target).state, 'short');
  assert.equal(reachOf(side(20, 16), target).state, 'open');
  const read = (k, n) => ({ fix_from: '2026-11-10T00:00:00Z', in: { A: 100, B: n }, measures: { reach_load: { A: side(40, 20), B: side(n, k), due: n + 40 } } });
  assert.match(verdictOf(share, read(90, 100), NOW).text, /^Too early/);
  const after = '2026-11-27T12:00:00Z';
  assert.deepEqual(verdictOf(share, read(90, 100), after), { tone: 'good', text: 'Reaching it' });
  assert.deepEqual(verdictOf(share, read(70, 100), after), { tone: 'bad', text: 'Short of it' });
  assert.equal(verdictOf(share, read(16, 20), after).text, 'Too early to say');
  const row = measureRows(share, read(90, 100), after).rows[0];
  assert.equal(row.reach.state, 'reaching');
  assert.equal(row.tone, 'good');
  // Before the first fixed build the reach waits for it.
  const unfixed = { in: { A: 100, B: 20 }, measures: {} };
  assert.equal(measureRows(share, unfixed, NOW).rows[0].pending, 'Starts with the first fixed build');
});

test('the share ask’s misses read in plain words, most first', () => {
  const r = { misses: [{ reason: 'tour', n: 1 }, { reason: 'not_in_view', n: 4 }, { reason: 'slot_busy', n: 0 }] };
  assert.deepEqual(missesOf(share, r).map((x) => [x.text, x.n]), [[share.missReasons.not_in_view, 4], [share.missReasons.tour, 1]]);
  assert.equal(missesOf(more, r), null);
});

test('the verdict waits for its date, then names a side only when the range clears zero', () => {
  const clear = healthy({ measures: { ten_after_1d: { A: side(400, 80), B: side(400, 160), due: 800 } } });
  assert.equal(verdictOf(more, clear, NOW).text, `Too early · verdict ${fmtDay(more.verdictIso)}`);
  const v = verdictOf(more, clear, LATE);
  assert.equal(v.tone, 'good');
  assert.match(v.text, /^The ask ahead, \+20\.0 pts$/);
  const even = healthy({ measures: { ten_after_1d: { A: side(400, 80), B: side(400, 84), due: 800 } } });
  assert.equal(verdictOf(more, even, LATE).text, 'No clear difference');
  const few = healthy({ measures: { ten_after_1d: { A: side(10, 2), B: side(12, 3), due: 22 } } });
  assert.equal(verdictOf(more, few, LATE).text, 'Too few to say');
});

test('for the email hold-back, the email’s side being ahead is the good news', () => {
  const r = { in: { A: 400, B: 400 }, measures: { open_72h: { A: side(400, 120), B: side(400, 60), due: 800 } } };
  const v = verdictOf(email, r, LATE);
  assert.equal(v.tone, 'good');
  assert.match(v.text, /^Sent ahead/);
});

test('a measure with nobody old enough says when the first ones finish; one the read lacks says so', () => {
  const r = healthy({ measures: { back_7d: { A: side(0, 0), B: side(0, 0), due: 8, next: '2026-11-21T07:00:00Z' } } });
  const row = measureRows(more, r, NOW).rows.find((x) => x.m.id === 'back_7d');
  assert.match(row.pending, /^First ones finish tomorrow/);
  const none = measureRows(box, { in: { A: 0, B: 0 }, measures: {} }, NOW).rows[0];
  assert.equal(none.pending, 'No visitor in it yet');
  const older = { in: { A: 40, B: 41 }, measures: { open_72h: { A: side(40, 10), B: side(41, 12), due: 81 } } };
  assert.equal(measureRows(email, older, NOW).rows.find((x) => x.m.id === 'unsub').pending, 'Not in the read yet');
});

test('a fair coin passes the split check, a lopsided one asks for a look', () => {
  assert.ok(splitP(50, 100) > 0.9);
  assert.ok(splitP(30, 100) < 0.01);
  assert.equal(state(checksOf(more, healthy(), NOW), 'split'), 'ok');
  assert.equal(state(checksOf(more, healthy({ in: { A: 90, B: 40 }, eligible: 130 }), NOW), 'split'), 'look');
  // The hold-back's expected share comes from its config.
  const held = { in: { A: 75, B: 25 }, holdout_pct: 25, last_run: '2026-11-20T11:00:00Z', mismatched: 0, parts: [] };
  assert.equal(state(checksOf(email, held, NOW), 'split'), 'ok');
});

test('nobody being put in asks for a look; nobody to put in waits', () => {
  const stuck = healthy({ recent: { eligible: 9, assigned: 0 } });
  assert.equal(state(checksOf(more, stuck, NOW), 'put_in'), 'look');
  const half = healthy({ in: { A: 10, B: 10 }, eligible: 80 });
  assert.equal(state(checksOf(more, half, NOW), 'put_in'), 'look');
  const empty = healthy({ in: { A: 0, B: 0 }, eligible: 0, recent: { eligible: 0, assigned: 0 } });
  assert.equal(state(checksOf(more, empty, NOW), 'put_in'), 'wait');
  assert.equal(healthOf(more, empty, NOW).text, 'Waiting for people');
});

test('one side going quiet while the other still arrives asks for a look', () => {
  const quiet = healthy({ last: { A: '2026-11-20T09:00:00Z', B: '2026-11-15T09:00:00Z' } });
  assert.equal(state(checksOf(more, quiet, NOW), 'events'), 'look');
  assert.equal(healthOf(more, quiet, NOW).text, 'Needs a look');
});

test('a test’s own event going quiet while people were due it asks for a look', () => {
  const r = healthy({
    measures: {},
    signals: { shown: { last: '2026-11-10T09:00:00Z', due: 7 } },
  });
  assert.equal(state(checksOf(more, r, NOW), 'events'), 'look');
  const fine = healthy({ measures: {}, signals: { shown: { last: '2026-11-20T08:00:00Z', due: 1 } } });
  assert.equal(state(checksOf(more, fine, NOW), 'events'), 'ok');
});

test('the ask’s click-through shows under its own event, never as a look', () => {
  const r = healthy({ signals: { shown: { last: '2026-11-20T08:00:00Z', due: 1 }, click: { views: 40, clicks: 6 } } });
  const c = checksOf(more, r, NOW).find((x) => x.id === 'click');
  assert.equal(c.state, 'ok');
  assert.match(c.text, /^6 of 40 views/);
  assert.equal(checksOf(more, healthy(), NOW).find((x) => x.id === 'click'), undefined);
});

test('a leak between the groups asks for a look', () => {
  assert.equal(state(checksOf(more, healthy({ mismatched: 2 }), NOW), 'match'), 'look');
  const checks = checksOf(more, healthy(), NOW);
  assert.equal(state(checks, 'match'), 'ok');
  assert.equal(healthOf(more, healthy(), NOW, checks).text, 'Running properly');
});

test('the email sender stopping asks for a look', () => {
  const r = { in: { A: 20, B: 21 }, holdout_pct: 50, last_run: '2026-11-16T11:00:00Z', mismatched: 0, parts: [] };
  assert.equal(state(checksOf(email, r, NOW), 'events'), 'look');
});

test('the trial from card one starts with its release, from the read', () => {
  const before = { stamped_off: 0 };
  assert.equal(verdictOf(trial, before, NOW).text, 'Starts with its release');
  assert.equal(healthOf(trial, before, NOW).text, 'Not started');
  assert.equal(timelineOf(trial, before, NOW), null);
  const r = {
    on_from: '2026-11-06T10:00:00Z', stamped_off: 0, in: { A: 300, B: 310 },
    signals: { reach: { views: 5, early: 5 }, leak: 0 },
    measures: { press_14d: { A: side(3, 0), B: side(4, 1), due: 7, next: null } },
  };
  const checks = checksOf(trial, r, NOW);
  assert.deepEqual(checks.map((c) => c.id), ['put_in', 'split', 'reach', 'match']);
  assert.equal(healthOf(trial, r, NOW, checks).text, 'Running properly');
  const tl = timelineOf(trial, r, NOW);
  assert.equal(tl.start.label, 'Nov 6');
  assert.equal(tl.marks.length, trial.reads.length);
  assert.match(splitNote(trial, r), /since the release/);
  // B's offers under 13 cards not carrying the early trial, or any to A, is a look.
  assert.equal(state(checksOf(trial, { ...r, signals: { reach: { views: 6, early: 0 }, leak: 0 } }, NOW), 'reach'), 'look');
  assert.equal(state(checksOf(trial, { ...r, signals: { reach: { views: 6, early: 6 }, leak: 1 } }, NOW), 'match'), 'look');
});

test('a switched-off test with nobody in it is off as planned; anybody in it is a look', () => {
  assert.equal(healthOf(offTest, { stamped_off: 0 }, NOW).text, 'Off, as planned');
  assert.equal(healthOf(offTest, { stamped_off: 3 }, NOW).text, 'Needs a look');
});

test('a read that failed says so', () => {
  assert.equal(checksOf(more, { error: '57014' }, NOW)[0].state, 'look');
  assert.equal(checksOf(more, null, NOW)[0].state, 'look');
  assert.equal(checksOf(trial, { error: '57014' }, NOW)[0].state, 'look');
});

test('the before-and-after test checks its reach, and waits for its fix', () => {
  const unseen = { in: { A: 200, B: 15 }, shown: 0, signals: { ask_at_10: { last: null, due: 15 } }, measures: {} };
  const checks = checksOf(share, unseen, NOW);
  assert.equal(state(checks, 'reach'), 'look');
  assert.equal(state(checks, 'events'), 'look');
  assert.equal(state(checks, 'fix'), 'wait');
  const ok = {
    fix_from: '2026-11-10T00:00:00Z', in: { A: 200, B: 15 }, shown: 12,
    signals: { ask_at_10: { last: '2026-11-20T08:00:00Z', due: 0 }, lost_to_ask: 2 }, measures: {},
  };
  const okChecks = checksOf(share, ok, NOW);
  assert.equal(state(okChecks, 'fix'), 'ok');
  assert.match(okChecks.find((c) => c.id === 'lost').text, /^2 upgrade offers/);
  assert.equal(healthOf(share, ok, NOW).text, 'Running properly');
});

test('the rotation email waits while nothing is being sent', () => {
  assert.equal(healthOf(rotation, { idle: true, in: { A: 10, B: 9 } }, NOW).text, 'Nothing sent lately');
});

test('under the split, who has no side', () => {
  assert.match(splitNote(more, healthy()), /^18 more never reached the app/);
  assert.equal(splitNote(box, {}), box.inNote);
});

test('the timeline runs from the start to the last read', () => {
  const tl = timelineOf(more, healthy(), NOW);
  assert.equal(tl.marks.length, more.reads.length);
  assert.equal(tl.marks[tl.marks.length - 1].at, 100);
});

test('the page draws only sections with a test in them, the earlier list, and its counts', () => {
  const page = testsPage({
    now: NOW,
    tests: {
      // The ended tests the read still returns are not drawn.
      workspace_setup: healthy({ mismatched: 4 }),
      whats_new: { idle: true },
      first_board_more: healthy({ mismatched: 1 }),
      trial_early: { stamped_off: 0 },
    },
  });
  assert.deepEqual(page.groups.map((g) => g.id), ['running', 'changed']);
  assert.ok(page.earlier.tests.some((e) => e.key === 'workspace_setup'));
  assert.ok(page.earlier.tests.some((e) => e.key === 'whats_new'));
  assert.equal(page.running, page.groups[0].tests.filter((m) => m.on).length);
  assert.equal(page.running, 4);
  // The leak, plus every test whose read didn't come back.
  assert.equal(page.looks, 1 + ['signup_box', 'email_holdout', 'share_ask'].length);
});
