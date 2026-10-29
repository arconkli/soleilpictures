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
  MIN_N, gapOf, spanOf, splitP, verdictOf, checksOf, healthOf, measureRows,
  testsPage, fmtDay, fmtSince, fmtUntil, splitNote, timelineOf,
} from './testsView.js';

const NOW = '2026-11-20T12:00:00Z';
const LATE = '2027-02-01T12:00:00Z';
const setup = testByKey('workspace_setup');
const more = testByKey('first_board_more');
const box = testByKey('signup_box');
const email = testByKey('email_holdout');
const share = testByKey('share_ask');
const trial = testByKey('trial_early');
const whatsNew = testByKey('whats_new');

const side = (n, k) => ({ n, k });
const healthy = (over = {}) => ({
  in: { A: 60, B: 62 },
  eligible: 140,
  recent: { eligible: 12, assigned: 10 },
  last: { A: '2026-11-20T09:00:00Z', B: '2026-11-20T10:00:00Z' },
  mismatched: 0,
  measures: {
    back_7d: { A: side(50, 10), B: side(52, 14), due: 122, next: '2026-11-21T08:00:00Z' },
    joined_7d: { A: side(50, 2), B: side(52, 5), due: 122, next: null },
    card_1d: { A: side(58, 40), B: side(60, 41), due: 122, next: null },
    board_1d: { A: side(58, 55), B: side(60, 57), due: 122, next: null },
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

test('the verdict waits for its date, then names a side only when the range clears zero', () => {
  const clear = healthy({ measures: { back_7d: { A: side(400, 80), B: side(400, 160), due: 800 } } });
  assert.equal(verdictOf(setup, clear, NOW).text, `Too early · verdict ${fmtDay(setup.verdictIso)}`);
  const v = verdictOf(setup, clear, LATE);
  assert.equal(v.tone, 'good');
  assert.match(v.text, /^Setup steps ahead, \+20\.0 pts$/);
  const even = healthy({ measures: { back_7d: { A: side(400, 80), B: side(400, 84), due: 800 } } });
  assert.equal(verdictOf(setup, even, LATE).text, 'No clear difference');
  const few = healthy({ measures: { back_7d: { A: side(10, 2), B: side(12, 3), due: 22 } } });
  assert.equal(verdictOf(setup, few, LATE).text, 'Too few to say');
});

test('for the email hold-back, the email’s side being ahead is the good news', () => {
  const r = { in: { A: 400, B: 400 }, measures: { nudge_made_72h: { A: side(400, 120), B: side(400, 60), due: 800 } } };
  const v = verdictOf(email, r, LATE);
  assert.equal(v.tone, 'good');
  assert.match(v.text, /^Sent ahead/);
});

test('a measure with nobody old enough says when the first ones finish', () => {
  const r = healthy({ measures: { back_7d: { A: side(0, 0), B: side(0, 0), due: 8, next: '2026-11-21T07:00:00Z' } } });
  const row = measureRows(setup, r, NOW).rows.find((x) => x.m.id === 'back_7d');
  assert.match(row.pending, /^First ones finish tomorrow/);
  const none = measureRows(box, { in: { A: 0, B: 0 }, measures: {} }, NOW).rows[0];
  assert.equal(none.pending, 'No visitor in it yet');
});

test('a fair coin passes the split check, a lopsided one asks for a look', () => {
  assert.ok(splitP(50, 100) > 0.9);
  assert.ok(splitP(30, 100) < 0.01);
  assert.equal(state(checksOf(setup, healthy(), NOW), 'split'), 'ok');
  assert.equal(state(checksOf(setup, healthy({ in: { A: 90, B: 40 }, eligible: 130 }), NOW), 'split'), 'look');
  // The hold-back's expected share comes from its config.
  const held = { in: { A: 75, B: 25 }, holdout_pct: 25, last_run: '2026-11-20T11:00:00Z', mismatched: 0, parts: [] };
  assert.equal(state(checksOf(email, held, NOW), 'split'), 'ok');
});

test('nobody being put in asks for a look; nobody to put in waits', () => {
  const stuck = healthy({ recent: { eligible: 9, assigned: 0 } });
  assert.equal(state(checksOf(setup, stuck, NOW), 'put_in'), 'look');
  const half = healthy({ in: { A: 10, B: 10 }, eligible: 80 });
  assert.equal(state(checksOf(setup, half, NOW), 'put_in'), 'look');
  const empty = healthy({ in: { A: 0, B: 0 }, eligible: 0, recent: { eligible: 0, assigned: 0 } });
  assert.equal(state(checksOf(setup, empty, NOW), 'put_in'), 'wait');
  assert.equal(healthOf(setup, empty, NOW).text, 'Waiting for people');
});

test('one side going quiet while the other still arrives asks for a look', () => {
  const quiet = healthy({ last: { A: '2026-11-20T09:00:00Z', B: '2026-11-15T09:00:00Z' } });
  assert.equal(state(checksOf(setup, quiet, NOW), 'events'), 'look');
  assert.equal(healthOf(setup, quiet, NOW).text, 'Needs a look');
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

test('a leak between the groups asks for a look', () => {
  assert.equal(state(checksOf(setup, healthy({ mismatched: 2 }), NOW), 'match'), 'look');
  const checks = checksOf(setup, healthy(), NOW);
  assert.equal(state(checks, 'match'), 'ok');
  assert.equal(healthOf(setup, healthy(), NOW, checks).text, 'Running properly');
});

test('the email sender stopping asks for a look', () => {
  const r = { in: { A: 20, B: 21 }, holdout_pct: 50, last_run: '2026-11-16T11:00:00Z', mismatched: 0, parts: [] };
  assert.equal(state(checksOf(email, r, NOW), 'events'), 'look');
});

test('a switched-off test with nobody in it is off as planned; anybody in it is a look', () => {
  assert.equal(healthOf(trial, { stamped_off: 0 }, NOW).text, 'Off, as planned');
  assert.equal(healthOf(trial, { stamped_off: 3 }, NOW).text, 'Needs a look');
});

test('a read that failed says so', () => {
  assert.equal(checksOf(setup, { error: '57014' }, NOW)[0].state, 'look');
  assert.equal(checksOf(setup, null, NOW)[0].state, 'look');
});

test('the before-and-after test checks its reach', () => {
  const unseen = { in: { A: 200, B: 15 }, shown: 0, signals: { ask_at_10: { last: null, due: 15 } }, measures: {} };
  const checks = checksOf(share, unseen, NOW);
  assert.equal(state(checks, 'reach'), 'look');
  assert.equal(state(checks, 'events'), 'look');
  const ok = { in: { A: 200, B: 15 }, shown: 12, signals: { ask_at_10: { last: '2026-11-20T08:00:00Z', due: 0 } }, measures: {} };
  assert.equal(healthOf(share, ok, NOW).text, 'Running properly');
});

test('the rotation email waits while nothing is being sent', () => {
  assert.equal(healthOf(whatsNew, { idle: true, in: { A: 10, B: 9 } }, NOW).text, 'Nothing sent lately');
});

test('under the split, who has no side', () => {
  assert.match(splitNote(setup, healthy()), /^18 more never reached the app/);
  assert.equal(splitNote(box, {}), box.inNote);
});

test('the timeline runs from the start to the last read', () => {
  const tl = timelineOf(setup, healthy(), NOW);
  assert.equal(tl.marks.length, setup.reads.length);
  assert.equal(tl.marks[tl.marks.length - 1].at, 100);
  assert.equal(timelineOf(trial, {}, NOW), null);
});

test('the page has three sections, the earlier list, and its counts', () => {
  const page = testsPage({
    now: NOW,
    tests: {
      workspace_setup: healthy(),
      first_board_more: healthy({ mismatched: 1 }),
      trial_early: { stamped_off: 0 },
    },
  });
  assert.deepEqual(page.groups.map((g) => g.id), ['running', 'changed', 'waiting']);
  assert.ok(page.earlier.tests.length > 0);
  assert.equal(page.running, page.groups[0].tests.filter((m) => m.on).length);
  // The leak, plus every test whose read didn't come back.
  assert.equal(page.looks, 1 + ['signup_box', 'email_holdout', 'share_ask', 'whats_new'].length);
});
