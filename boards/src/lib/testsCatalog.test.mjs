// testsCatalog.test.mjs — the admin's Tests page lists every test, and says the
// same thing the code does about each one.
//
//   node --test src/lib/testsCatalog.test.mjs
//
// A test added to the registry with no line on the page, a test switched off in
// code while the page still calls it running, or a start date typed twice and
// drifting: each of these makes the page say something untrue, so each fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIMENTS } from './experiments.js';
import { BOARD_MORE_EPOCH } from './boardMoreEpoch.js';
import {
  TESTS, EARLIER_TESTS, TEST_GROUPS, isTestOn, testByKey,
  SHARE_ASK_RELEASE, EMAIL_HOLDOUT_START, SIGNUP_BOX_PAGE_GROUPS, SHARE_ASK_MISSES,
} from './testsCatalog.js';

const ROLES = new Set(['decides', 'aims at', 'also read', 'guardrail', 'counted']);
const KINDS = new Set(['coin', 'holdout', 'beforeafter', 'rotation']);
const liveArms = (key) => (EXPERIMENTS[key]?.arms || []).filter((a) => Number(a.weight) > 0);

test('every test in the registry has a line on the page', () => {
  const listed = new Set([...TESTS, ...EARLIER_TESTS].map((t) => t.key));
  for (const key of Object.keys(EXPERIMENTS)) {
    assert.ok(listed.has(key), `${key} is in experiments.js but not in testsCatalog.js (TESTS or EARLIER_TESTS)`);
  }
});

test('a test is listed once', () => {
  const keys = [...TESTS, ...EARLIER_TESTS].map((t) => t.key);
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), []);
});

test('a test marked as from the registry is in it, and only those are', () => {
  for (const t of TESTS) {
    assert.equal(!!EXPERIMENTS[t.key], !!t.registry, `${t.key}: registry is ${t.registry}`);
  }
});

test('on or off, the page agrees with the code', () => {
  for (const t of TESTS.filter((x) => x.registry)) {
    const e = EXPERIMENTS[t.key];
    if (t.offNote) assert.equal(e.enabled, false, `${t.key} carries an offNote but is enabled in experiments.js`);
    else assert.equal(e.enabled, true, `${t.key} is switched off in experiments.js: give it an offNote`);
  }
  const far = '2099-01-01T00:00:00Z';
  for (const t of TESTS) {
    assert.equal(isTestOn(t, far), !t.offNote, `${t.key}: isTestOn after every start`);
  }
});

test('a running coin flip really splits, and an earlier test that still runs has one side', () => {
  for (const t of TESTS.filter((x) => x.registry && !x.offNote && x.kind === 'coin')) {
    assert.deepEqual(liveArms(t.key).map((a) => a.id).sort(), ['A', 'B'], `${t.key}: both A and B carry weight`);
  }
  for (const t of EARLIER_TESTS.filter((x) => EXPERIMENTS[x.key]?.enabled)) {
    assert.equal(liveArms(t.key).length, 1, `${t.key} is under Earlier tests but still splits people`);
  }
});

test('start dates are the code’s own, or the read’s for a test that starts with a release', () => {
  assert.equal(testByKey('first_board_more').startIso, BOARD_MORE_EPOCH);
  assert.equal(testByKey('signup_box').startIso, EXPERIMENTS.signup_box.startsAt);
  assert.equal(testByKey('share_ask').startIso, SHARE_ASK_RELEASE);
  assert.equal(testByKey('email_holdout').startIso, EMAIL_HOLDOUT_START);
  // The trial from card one starts with the release that carries it: only the
  // read can know when that was, so the code types no instant for it.
  const trial = testByKey('trial_early');
  assert.equal(trial.startKey, 'on_from');
  assert.equal(trial.startIso, undefined);
  for (const t of TESTS.filter((x) => x.startKey)) assert.ok(!t.startIso, `${t.key}: a start from the read and one from the code`);
});

test('the ended tests moved to Earlier tests', () => {
  for (const key of ['workspace_setup', 'whats_new']) {
    assert.equal(testByKey(key), null, `${key} is still on the page as a test`);
    const e = EARLIER_TESTS.find((x) => x.key === key);
    assert.ok(e && e.name && e.when && e.out, `${key} has its line under Earlier tests`);
  }
  assert.equal(EXPERIMENTS.workspace_setup.enabled, false);
  assert.equal(testByKey('trial_early').group, 'running');
  assert.equal(testByKey('trial_early').offNote, undefined);
});

test('each running test is read on one deciding line', () => {
  for (const t of TESTS) {
    assert.equal(t.measures.filter((m) => m.role === 'decides' || m.role === 'aims at').length, 1, `${t.key}: one line decides`);
  }
  assert.equal(testByKey('email_holdout').measures[0].id, 'open_72h');
  assert.equal(testByKey('first_board_more').measures[0].id, 'ten_after_1d');
  const box = testByKey('signup_box').measures[0];
  assert.equal(box.from, 'strata');
  const reach = testByKey('share_ask').measures[0];
  assert.equal(reach.id, 'reach_load');
  // The registered target is a number the view reads, never words on the page.
  assert.equal(typeof reach.target, 'number');
});

test('the sign-up box’s strata are frozen as they were on Nov 3', () => {
  assert.ok(Object.isFrozen(SIGNUP_BOX_PAGE_GROUPS));
  assert.deepEqual(SIGNUP_BOX_PAGE_GROUPS.map((g) => g.id), ['kept_close', 'held', 'full']);
  // Copied from landingStage.js's KEPT_CLOSE and STAGE_HELD, not imported: the
  // landing stage may move on, the read's strata may not (0855 holds the same
  // lists).
  const kept = SIGNUP_BOX_PAGE_GROUPS[0].paths, held = SIGNUP_BOX_PAGE_GROUPS[1].paths;
  assert.deepEqual([...kept], ['/vs/pureref', '/tools/reference-board-maker', '/tools/shot-list-maker', '/tools/mood-board-maker']);
  assert.deepEqual([...held], ['/best/pureref-alternatives']);
  assert.equal(SIGNUP_BOX_PAGE_GROUPS[2].paths, null);
});

test('every share-ask miss has plain words', () => {
  for (const r of ['tour', 'board_stamp', 'weekly_stamp', 'not_editor', 'already_shared', 'slot_busy', 'not_in_view']) {
    assert.ok(SHARE_ASK_MISSES[r], `${r} has no words`);
  }
});

test('a switched-on test has a start, its reads in order, and is read on something', () => {
  const groups = new Set(TEST_GROUPS.map((g) => g.id));
  for (const t of TESTS) {
    assert.ok(groups.has(t.group) && t.group !== 'earlier', `${t.key}: group ${t.group}`);
    assert.ok(KINDS.has(t.kind), `${t.key}: kind ${t.kind}`);
    assert.ok(t.name && t.what && t.aName && t.a && t.bName && t.b, `${t.key}: says what each side gets`);
    const ids = t.measures.map((m) => m.id);
    assert.deepEqual(ids.filter((k, i) => ids.indexOf(k) !== i), [], `${t.key}: measure ids repeat`);
    for (const m of t.measures) {
      assert.ok(ROLES.has(m.role), `${t.key}.${m.id}: role ${m.role}`);
      assert.ok(Number.isFinite(m.windowDays) && m.windowDays >= 0, `${t.key}.${m.id}: windowDays`);
      assert.ok(m.label, `${t.key}.${m.id}: label`);
    }
    if (t.offNote || t.kind === 'rotation') continue;
    assert.ok(t.startKey || (t.startIso && !Number.isNaN(Date.parse(t.startIso))), `${t.key}: startIso or startKey`);
    const days = t.reads.map((r) => r.iso);
    assert.deepEqual([...days].sort(), days, `${t.key}: reads in date order`);
    assert.ok(days.length > 0 && days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)), `${t.key}: read dates`);
    if (t.startIso) assert.ok(days[0] > t.startIso.slice(0, 10), `${t.key}: first read after the start`);
    assert.equal(t.verdictIso, days[days.length - 1], `${t.key}: the verdict is the last read`);
    assert.ok(t.measures.some((m) => m.role === 'decides' || m.role === 'aims at'), `${t.key}: nothing decides it`);
  }
});

// The saved reads (outside this public repo) hold what counts as a win. Nothing
// on the page may say how big a gap has to be.
test('no win threshold is written into the page', () => {
  const text = JSON.stringify([TESTS, EARLIER_TESTS, TEST_GROUPS]);
  const bad = text.match(/\d+(\.\d+)?\s*(%|pts?\b|points?\b|pp\b)|threshold|\bMDE\b|minimum detectable|win if|wins if|ship if/gi);
  assert.equal(bad, null, `threshold-like text: ${bad}`);
});
