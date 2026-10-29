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
import { SETUP_EPOCH } from './setupRule.js';
import { BOARD_MORE_EPOCH } from './boardMoreEpoch.js';
import {
  TESTS, EARLIER_TESTS, TEST_GROUPS, isTestOn, testByKey,
  SHARE_ASK_RELEASE, EMAIL_HOLDOUT_START,
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

test('start dates are the code’s own', () => {
  assert.equal(testByKey('workspace_setup').startIso, SETUP_EPOCH);
  assert.equal(testByKey('first_board_more').startIso, BOARD_MORE_EPOCH);
  assert.equal(testByKey('signup_box').startIso, EXPERIMENTS.signup_box.startsAt);
  assert.equal(testByKey('share_ask').startIso, SHARE_ASK_RELEASE);
  assert.equal(testByKey('email_holdout').startIso, EMAIL_HOLDOUT_START);
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
    assert.ok(t.startIso && !Number.isNaN(Date.parse(t.startIso)), `${t.key}: startIso`);
    const days = t.reads.map((r) => r.iso);
    assert.deepEqual([...days].sort(), days, `${t.key}: reads in date order`);
    assert.ok(days.length > 0 && days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)), `${t.key}: read dates`);
    assert.ok(days[0] > t.startIso.slice(0, 10), `${t.key}: first read after the start`);
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
