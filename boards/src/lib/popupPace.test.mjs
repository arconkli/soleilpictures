// popupPace.test.mjs — node --test src/lib/popupPace.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  REGULAR_DAYS, ASK_GAP_MS, ASK_KINDS, getPace, subscribePace, setPace, resetPace, __resetPace,
  isRegular, pastDayOne, paceRefuses, hintRefused, dayVisit, depthDockGate, noteAsk,
  TIP_HINT_KINDS, bindPaceUser,
} from './popupPace.js';

beforeEach(() => __resetPace());

test('regular from 5 days, past day one from 1; unknown is neither', () => {
  assert.equal(REGULAR_DAYS, 5);
  assert.equal(isRegular(4), false);
  assert.equal(isRegular(5), true);
  assert.equal(pastDayOne(0), false);
  assert.equal(pastDayOne(1), true);
  for (const v of [null, undefined, NaN, '5', -1]) {
    assert.equal(isRegular(v), false);
    assert.equal(pastDayOne(v), false);
  }
});

test('setPace keeps only a finite integer >= 0, and null never becomes 0', () => {
  setPace({ daysBack: 6 });
  assert.equal(getPace().daysBack, 6);
  setPace({ daysBack: null });
  assert.equal(getPace().daysBack, null);
  for (const v of ['5', -1, NaN, 1.5, Infinity]) {
    setPace({ daysBack: 3 });
    setPace({ daysBack: v });
    assert.equal(getPace().daysBack, null, String(v));
  }
  setPace({ daysBack: 3 });
  setPace({});
  assert.equal(getPace().daysBack, 3, 'an absent key changes nothing');
  setPace({ daysBack: undefined });
  assert.equal(getPace().daysBack, 3);
});

test('lastAskAt takes ms or ISO, never moves backwards, ignores junk', () => {
  setPace({ lastAskAt: 1000 });
  setPace({ lastAskAt: 500 });
  assert.equal(getPace().lastAskAt, 1000);
  setPace({ lastAskAt: new Date(5000).toISOString() });
  assert.equal(getPace().lastAskAt, 5000);
  setPace({ lastAskAt: 'nonsense' });
  setPace({ lastAskAt: null });
  assert.equal(getPace().lastAskAt, 5000);
});

test('getPace is reference-stable until something changes; subscribers hear only changes', () => {
  const a = getPace();
  let n = 0;
  const off = subscribePace(() => { n++; });
  setPace({ daysBack: null });
  setPace({});
  assert.equal(getPace(), a);
  assert.equal(n, 0);
  setPace({ daysBack: 2 });
  assert.notEqual(getPace(), a);
  assert.equal(n, 1);
  setPace({ daysBack: 2 });
  assert.equal(n, 1);
  off();
  setPace({ daysBack: 3 });
  assert.equal(n, 1);
  resetPace();
  assert.equal(getPace().daysBack, null);
});

test('tips are refused for regulars only; money kinds never', () => {
  const now = Date.now();
  setPace({ daysBack: 5 });
  for (const k of ['power-reveal', 'mix-prompt', 'depth-dock', 'whats-new']) assert.equal(paceRefuses(k, { now }), 'tip', k);
  for (const k of ['cap-hit', 'first-value', 'cap-toast', 'storage-gate', 'upgrade-reason', 'pricing-intent', 'return-reason', 'resume']) {
    assert.equal(paceRefuses(k, { now }), null, k);
  }
  setPace({ daysBack: 4 });
  __resetPace();
  setPace({ daysBack: 4 });
  assert.equal(paceRefuses('power-reveal', { now }), null);
});

test('one ask a week for a regular: exactly 7 days allowed, 7d-1ms refused, skew allowed', () => {
  const t0 = Date.UTC(2026, 10, 1, 12);
  setPace({ daysBack: 9, lastAskAt: t0 });
  for (const k of ASK_KINDS) {
    assert.equal(paceRefuses(k, { now: t0 + ASK_GAP_MS - 1 }), 'pace', k);
    assert.equal(paceRefuses(k, { now: t0 + ASK_GAP_MS }), null, k);
    assert.equal(paceRefuses(k, { now: t0 - 1 }), null, 'negative elapsed');
  }
  __resetPace();
  setPace({ daysBack: 4, lastAskAt: t0 });
  assert.equal(paceRefuses('share-ask', { now: t0 + 1 }), null, 'not a regular');
});

test('hintRefused hits the four tip hints for regulars only', () => {
  setPace({ daysBack: 5 });
  for (const k of TIP_HINT_KINDS) assert.equal(hintRefused(k), true, k);
  for (const k of ['setup_tips', 'invite_reask', 'board_more', 'profile_ask']) assert.equal(hintRefused(k), false, k);
  assert.equal(hintRefused('paste', { daysBack: 4 }), false);
  assert.equal(hintRefused('paste', { daysBack: null }), false);
});

test('dayVisit is the UTC date', () => {
  assert.equal(dayVisit(Date.UTC(2026, 10, 15, 23, 59, 59)), 'day:2026-11-15');
  assert.equal(dayVisit(Date.UTC(2026, 10, 16, 0, 0, 0)), 'day:2026-11-16');
});

test('depthDockGate: hide, claim, free', () => {
  assert.equal(depthDockGate({ daysBack: 5 }), 'hide');
  assert.equal(depthDockGate({ daysBack: 1 }), 'claim');
  assert.equal(depthDockGate({ daysBack: 0 }), 'free');
  assert.equal(depthDockGate({ daysBack: null }), 'free');
});

test('noteAsk stamps and calls onAsk with an ISO string; a throwing onAsk is harmless', () => {
  const got = [];
  setPace({ onAsk: (iso) => got.push(iso) });
  noteAsk('share-ask', 5000);
  assert.deepEqual(got, [new Date(5000).toISOString()]);
  assert.equal(getPace().lastAskAt, 5000);
  noteAsk('power-reveal', 9000);
  assert.equal(got.length, 1);
  noteAsk('invite-nudge', 2000);
  assert.equal(getPace().lastAskAt, 5000, 'never backwards');
  setPace({ onAsk: () => { throw new Error('boom'); } });
  assert.doesNotThrow(() => noteAsk('layout-ask', 7000));
  assert.equal(getPace().lastAskAt, 7000);
});

test('bindPaceUser resets for a different person and is a no-op for the same one', () => {
  bindPaceUser('a');
  setPace({ daysBack: 6, lastAskAt: 5000, ready: true });
  const s = getPace();
  bindPaceUser('a');
  assert.equal(getPace(), s, 'same uid changes nothing');
  bindPaceUser('b');
  assert.equal(getPace().daysBack, null);
  assert.equal(getPace().lastAskAt, null);
  assert.equal(getPace().onAsk, null);
  assert.equal(getPace().ready, false);
  bindPaceUser(null);
  assert.equal(getPace().ready, true, 'signed out is ready');
});

test('a bound person waits until ready; then free with an unknown count', () => {
  assert.equal(getPace().ready, true, 'unbound fails open');
  bindPaceUser('a');
  assert.equal(getPace().ready, false);
  assert.equal(depthDockGate(), 'wait');
  setPace({ ready: false });
  assert.equal(getPace().ready, false, 'only true is meaningful');
  setPace({ ready: true });
  assert.equal(getPace().daysBack, null);
  assert.equal(depthDockGate(), 'free');
});

test('resetPace restores ready and forgets the bound person', () => {
  bindPaceUser('a');
  resetPace();
  assert.equal(getPace().ready, true);
  bindPaceUser('a');
  assert.equal(getPace().ready, false, 'the same uid binds afresh after a reset');
});
