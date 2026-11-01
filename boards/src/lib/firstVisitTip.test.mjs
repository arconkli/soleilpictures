// firstVisitTip.test.mjs — the first-visit tip's steps.
//
//   node --test src/lib/firstVisitTip.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIP_KEY, initialTipState, tipReducer, tipOutcome, tipCopy, tipDots, readTipSeen, markTipSeen, retargetTip,
} from './firstVisitTip.js';

const sub = (extra) => initialTipState({ hasSubClusters: true, ...extra });
const flat = (extra) => initialTipState({ hasSubClusters: false, ...extra });

test('starts on open with clusters inside, on move without, on done once seen', () => {
  assert.equal(sub().step, 'open');
  assert.equal(flat().step, 'move');
  assert.equal(sub({ seen: true }).step, 'done');
  assert.equal(flat({ seen: true }).step, 'done');
  assert.equal(initialTipState().step, 'move');
});

test('open -> back -> done by doing what it asks', () => {
  let s = sub();
  s = tipReducer(s, 'opened_cluster');
  assert.equal(s.step, 'back');
  s = tipReducer(s, 'went_back');
  assert.equal(s.step, 'done');
});

test('any tap or Got it finishes the step it is on', () => {
  for (const ev of ['tap', 'dismiss']) {
    assert.equal(tipReducer(sub(), ev).step, 'done', `open + ${ev}`);
    assert.equal(tipReducer(tipReducer(sub(), 'opened_cluster'), ev).step, 'done', `back + ${ev}`);
    assert.equal(tipReducer(flat(), ev).step, 'done', `move + ${ev}`);
  }
});

test('events that do not belong to the step change nothing', () => {
  const open = sub();
  assert.strictEqual(tipReducer(open, 'went_back'), open);
  const back = tipReducer(open, 'opened_cluster');
  assert.strictEqual(tipReducer(back, 'opened_cluster'), back, 'a second cluster does not restart it');
  const move = flat();
  assert.strictEqual(tipReducer(move, 'opened_cluster'), move);
  assert.strictEqual(tipReducer(move, 'went_back'), move);
  assert.strictEqual(tipReducer(open, 'nonsense'), open);
});

test('done is final', () => {
  const done = tipReducer(flat(), 'dismiss');
  for (const ev of ['tap', 'dismiss', 'opened_cluster', 'went_back']) assert.strictEqual(tipReducer(done, ev), done);
});

test('the outcome says done when the visitor did it, skipped when they did not', () => {
  assert.deepEqual(tipOutcome(sub(), 'opened_cluster'), { step: 'open', action: 'done' });
  assert.deepEqual(tipOutcome(sub(), 'dismiss'), { step: 'open', action: 'skipped' });
  assert.deepEqual(tipOutcome(sub(), 'tap'), { step: 'open', action: 'skipped' });
  const back = tipReducer(sub(), 'opened_cluster');
  assert.deepEqual(tipOutcome(back, 'went_back'), { step: 'back', action: 'done' });
  assert.deepEqual(tipOutcome(back, 'dismiss'), { step: 'back', action: 'skipped' });
  assert.deepEqual(tipOutcome(flat(), 'tap'), { step: 'move', action: 'done' });
  assert.deepEqual(tipOutcome(flat(), 'dismiss'), { step: 'move', action: 'skipped' });
  assert.equal(tipOutcome(flat(), 'went_back'), null);
});

test('the words, on a computer and on a phone', () => {
  assert.equal(tipCopy(sub()).title, 'Click a cluster to open it');
  assert.equal(tipCopy(sub({ isPhone: true })).title, 'Tap a cluster to open it');
  const back = tipReducer(sub(), 'opened_cluster');
  assert.equal(tipCopy(back, 'Lost Time').title, 'Click Lost Time to go back');
  assert.equal(tipCopy(back, 'Lost Time').hint, 'Your browser’s back button works too.');
  assert.equal(tipCopy({ ...back, isPhone: true }, 'Lost Time').title, 'Tap Lost Time to go back');
  assert.equal(tipCopy(back, '').title, 'Click the cluster above to go back');
  assert.equal(tipCopy(flat()).title, 'Drag to look around, scroll to zoom');
  assert.equal(tipCopy(flat({ isPhone: true })).title, 'Drag to move around, pinch to zoom');
});

test('two dots only when there are clusters inside', () => {
  assert.deepEqual(tipDots(sub()), { total: 2, on: 0 });
  assert.deepEqual(tipDots(tipReducer(sub(), 'opened_cluster')), { total: 2, on: 1 });
  assert.equal(tipDots(flat()), null);
  assert.equal(tipDots(tipReducer(sub(), 'tap')), null);
});

test('once per device, and a storage that throws just means once per page load', () => {
  const m = new Map();
  const store = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  assert.equal(readTipSeen(store), false);
  markTipSeen(store);
  assert.equal(m.get(TIP_KEY), 'done');
  assert.equal(readTipSeen(store), true);
  assert.equal(TIP_KEY, 'soleil.firstVisitTip.v1');
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.equal(readTipSeen(broken), false);
  assert.doesNotThrow(() => markTipSeen(broken));
  assert.equal(readTipSeen(undefined), false);
});

test('a late sub-cluster map moves the starting step; later steps and done stay put', () => {
  const late = retargetTip(flat({ isPhone: true }), true);
  assert.equal(late.step, 'open');
  assert.equal(late.hasSubClusters, true);
  assert.equal(late.isPhone, true);
  assert.equal(retargetTip(sub(), false).step, 'move');
  const same = sub();
  assert.strictEqual(retargetTip(same, true), same);
  const back = tipReducer(sub(), 'opened_cluster');
  assert.strictEqual(retargetTip(back, false), back);
  const done = sub({ seen: true });
  assert.strictEqual(retargetTip(done, false), done);
});
