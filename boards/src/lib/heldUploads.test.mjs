// heldUploads.test.mjs — the store that keeps a drop that did not fit until
// there is room for it (owner request 2026-10-18). Pure: no DOM, no network.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  AWAIT_PAYMENT_MS,
  TAB_CLOSED_GRACE_MS,
  __resetHeldForTests,
  awaitingPayment,
  claimReady,
  discardHeld,
  hasHeld,
  heldAckCount,
  heldEntries,
  heldSnapshot,
  heldTotals,
  holdDrop,
  letGoHeld,
  markAllReady,
  markReady,
  noteAwaitingPayment,
  readyFor,
  restoreHeld,
  setHeldBaseline,
  setHeldLogger,
  setHeldOwner,
  settleAwaitingPayment,
  subscribeHeld,
  clearAwaitingPayment,
} from './heldUploads.js';

const file = (name, size) => ({ name, size });
const TB = 1024 ** 4;

beforeEach(() => __resetHeldForTests());

test('a drop is held with what it weighs, and nothing is held without a cluster or files', () => {
  const id = holdDrop({
    boardId: 'b1', via: 'canvas', limit: 'storage',
    files: [file('a.mov', 4e9), file('b.mov', 2e9)], at: { x: 10, y: 20 }, tier: 'demo', quota: 5 * 1024 ** 3,
  });
  assert.ok(id);
  assert.equal(hasHeld(), true);
  assert.deepEqual(heldTotals(), { count: 2, bytes: 6e9, entries: 1, boards: ['b1'] });
  assert.equal(holdDrop({ via: 'canvas', limit: 'storage', files: [file('x', 1)] }), null, 'no cluster');
  assert.equal(holdDrop({ boardId: 'b1', via: 'canvas', limit: 'storage', files: [] }), null, 'no files');
  assert.equal(heldEntries().length, 1);
});

test('a folder is held whole, by its own count and weight', () => {
  holdDrop({ boardId: 'b1', via: 'folder', limit: 'storage', folder: { count: 40, bytes: 9e9, args: {} } });
  assert.deepEqual(heldTotals('b1'), { count: 40, bytes: 9e9, entries: 1, boards: ['b1'] });
  assert.deepEqual(heldTotals('b2').count, 0);
});

test('a card-cap hold is released by the upgrade, not by anything else', () => {
  const e = { limit: 'cards', tierAtHold: 'demo', quotaAtHold: null };
  assert.equal(readyFor(e, { tier: 'demo' }), false);
  assert.equal(readyFor(e, { tier: 'paid' }), true);
  assert.equal(readyFor(e, { tier: 'admin' }), true);
  assert.equal(readyFor({ ...e, tierAtHold: 'paid' }, { tier: 'paid' }), false, 'a paying owner has no cap to lift');
  assert.equal(readyFor({ ...e, tierAtHold: null }, { tier: 'paid' }), false, 'a plan not known at hold time shows no upgrade');
});

test('a storage hold is released by the upgrade or by a bigger drive', () => {
  const e = { limit: 'storage', tierAtHold: 'paid', quotaAtHold: TB };
  assert.equal(readyFor(e, { tier: 'paid', quota: TB }), false, 'nothing changed');
  assert.equal(readyFor(e, { tier: 'paid', quota: 2 * TB }), true, 'a block was added');
  assert.equal(readyFor({ ...e, tierAtHold: 'demo', quotaAtHold: 5 * 1024 ** 3 }, { tier: 'paid', quota: 100 * 1024 ** 3 }), true, 'free to Creator');
  assert.equal(readyFor({ ...e, quotaAtHold: null }, { tier: 'paid', quota: 2 * TB }), false, 'no baseline yet');
});

test('a hold made without a drive size takes the first size seen as its baseline', () => {
  const id = holdDrop({ boardId: 'b1', via: 'canvas', limit: 'storage', files: [file('a', 1)], tier: 'paid', quota: null });
  setHeldBaseline(id, TB);
  assert.equal(heldEntries()[0].quotaAtHold, TB);
  setHeldBaseline(id, 3 * TB);
  assert.equal(heldEntries()[0].quotaAtHold, TB, 'the baseline is set once');
  assert.equal(readyFor(heldEntries()[0], { tier: 'paid', quota: 2 * TB }), true);
});

test('claiming takes only ready entries for that cluster and entry point, once', () => {
  const a = holdDrop({ boardId: 'b1', via: 'canvas', limit: 'storage', files: [file('a', 1)] });
  const b = holdDrop({ boardId: 'b1', via: 'list', limit: 'storage', files: [file('b', 1)] });
  const c = holdDrop({ boardId: 'b2', via: 'canvas', limit: 'storage', files: [file('c', 1)] });
  assert.deepEqual(claimReady({ boardId: 'b1', via: 'canvas' }), [], 'nothing is ready yet');
  markReady([a, b, c]);
  const got = claimReady({ boardId: 'b1', via: 'canvas' });
  assert.deepEqual(got.map((e) => e.id), [a]);
  assert.deepEqual(claimReady({ boardId: 'b1', via: 'canvas' }), [], 'a second claimer gets nothing');
  assert.deepEqual(heldEntries().map((e) => e.id), [b, c], 'the others wait for their own surface');
});

test('"Upload now" readies one cluster\'s holds, whatever changed', () => {
  const a = holdDrop({ boardId: 'b1', via: 'canvas', limit: 'cards', files: [file('a', 1)] });
  const b = holdDrop({ boardId: 'b2', via: 'canvas', limit: 'cards', files: [file('b', 1)] });
  markAllReady('b1');
  assert.deepEqual(heldEntries().filter((e) => e.ready).map((e) => e.id), [a]);
  assert.ok(b);
});

test('discarding lets the files go; listeners hear every change', () => {
  let calls = 0;
  const off = subscribeHeld(() => { calls += 1; });
  const a = holdDrop({ boardId: 'b1', via: 'canvas', limit: 'cards', files: [file('a', 1)] });
  holdDrop({ boardId: 'b1', via: 'canvas', limit: 'cards', files: [file('b', 1)] });
  discardHeld([a]);
  assert.equal(heldTotals().count, 1);
  discardHeld();
  assert.equal(hasHeld(), false);
  off();
  holdDrop({ boardId: 'b1', via: 'canvas', limit: 'cards', files: [file('c', 1)] });
  assert.equal(calls, 4, 'two holds and two discards, and nothing after unsubscribing');
});

test('a payment under way is awaited for a bounded time, and only while files are held', () => {
  const t0 = 1_800_000_000_000;
  noteAwaitingPayment(t0);
  assert.equal(awaitingPayment(t0 + 1000), false, 'nothing held, nothing to wait for');
  holdDrop({ boardId: 'b1', via: 'canvas', limit: 'storage', files: [file('a', 1)] });
  assert.equal(awaitingPayment(t0 + 1000), true);
  assert.equal(awaitingPayment(t0 + AWAIT_PAYMENT_MS + 1), false, 'the wait runs out');
});

test('a tab that just uploaded what it held still answers the success page, for a while', () => {
  const t0 = 1_800_000_000_000;
  assert.equal(heldAckCount(t0), 0);
  const a = holdDrop({ boardId: 'b1', via: 'canvas', limit: 'cards', files: [file('a', 1), file('b', 1)] });
  assert.equal(heldAckCount(t0), 2, 'holding');
  markReady([a]);
  claimReady({ boardId: 'b1', via: 'canvas', now: t0 });
  assert.equal(heldAckCount(t0 + 1000), 2, 'just released');
  const f = holdDrop({ boardId: 'b1', via: 'folder', limit: 'cards', folder: { count: 5, bytes: 1 } });
  markReady([f]);
  claimReady({ boardId: 'b1', via: 'folder', now: t0 + 2000 });
  assert.equal(heldAckCount(t0 + 3000), 7, 'one release, two claims: both counted');
  assert.equal(heldAckCount(t0 + 10 * 60 * 1000), 0, 'long ago');
});

test('leaving for a same-tab checkout lets the files go and says how many', () => {
  holdDrop({ boardId: 'b1', via: 'canvas', limit: 'storage', files: [file('a', 1), file('b', 1)] });
  holdDrop({ boardId: 'b1', via: 'folder', limit: 'storage', folder: { count: 5, bytes: 10 } });
  noteAwaitingPayment();
  assert.equal(letGoHeld(), 7);
  assert.equal(hasHeld(), false);
  assert.equal(awaitingPayment(), false);
});

test('every hold, release and discard is logged once, with what it carried', () => {
  const seen = [];
  setHeldLogger((kind, list) => seen.push([kind, list.map((e) => e.count)]));
  const a = holdDrop({ boardId: 'b1', via: 'canvas', limit: 'storage', files: [file('a', 1), file('b', 1)] });
  const b = holdDrop({ boardId: 'b1', via: 'list', limit: 'storage', files: [file('c', 1)] });
  markReady([a]);
  claimReady({ boardId: 'b1', via: 'canvas' });
  claimReady({ boardId: 'b1', via: 'canvas' });
  discardHeld([b]);
  discardHeld([b]);
  holdDrop({ boardId: 'b1', via: 'canvas', limit: 'cards', files: [file('d', 1)] });
  letGoHeld();
  assert.deepEqual(seen, [
    ['kept', [2]], ['kept', [1]], ['released', [2]], ['discarded', [1]], ['kept', [1]], ['let_go', [1]],
  ]);
});

test('a discard can be undone, once, and comes back as it was', () => {
  const a = holdDrop({ boardId: 'b1', via: 'canvas', limit: 'storage', files: [file('a', 3)] });
  holdDrop({ boardId: 'b2', via: 'canvas', limit: 'storage', files: [file('b', 4)] });
  markReady([a]);
  const gone = heldEntries();
  discardHeld();
  restoreHeld(gone);
  restoreHeld(gone);
  assert.equal(heldEntries().length, 2, 'restored once');
  assert.deepEqual(heldEntries().map((e) => e.ready), [true, false], 'a released drop stays released');
  assert.equal(heldTotals().bytes, 7);
});

test('every change makes a new snapshot, the payment wait included', () => {
  const s0 = heldSnapshot();
  holdDrop({ boardId: 'b1', via: 'canvas', limit: 'storage', files: [file('a', 1)] });
  const s1 = heldSnapshot();
  assert.notEqual(s1, s0);
  assert.equal(heldSnapshot(), s1, 'stable between changes');
  noteAwaitingPayment();
  const s2 = heldSnapshot();
  assert.notEqual(s2, s1, 'the entries did not change, the wait did');
  assert.equal(s2.awaiting, true);
  clearAwaitingPayment();
  assert.equal(heldSnapshot().awaiting, false);
});

test('closing the tab the payment happens in ends the wait, after a grace for a late activation', () => {
  const t0 = 1_800_000_000_000;
  holdDrop({ boardId: 'b1', via: 'canvas', limit: 'storage', files: [file('a', 1)] });
  const tab = { closed: false };
  noteAwaitingPayment(t0, AWAIT_PAYMENT_MS, tab);
  assert.equal(awaitingPayment(t0 + 1000), true);
  tab.closed = true;
  assert.equal(awaitingPayment(t0 + 2000), true, 'just closed: the plan may still be landing');
  assert.equal(awaitingPayment(t0 + 2000 + TAB_CLOSED_GRACE_MS), false);
  assert.equal(heldSnapshot().awaiting, true, 'nobody has said so yet');
  settleAwaitingPayment(t0 + 2000 + TAB_CLOSED_GRACE_MS);
  assert.equal(heldSnapshot().awaiting, false);
});

test('another account signing in to the same tab is not handed the last one\'s files', () => {
  setHeldOwner('u1');
  holdDrop({ boardId: 'b1', via: 'canvas', limit: 'cards', files: [file('a', 1)] });
  setHeldOwner(null);
  assert.equal(hasHeld(), true, 'signed out: nothing is decided yet');
  setHeldOwner('u1');
  assert.equal(hasHeld(), true, 'the same person back: still theirs');
  setHeldOwner('u2');
  assert.equal(hasHeld(), false);
});
