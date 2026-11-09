// activityWords.test.mjs — every word the tray and the cards say about a transfer.
//
//   node --test src/lib/activityWords.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { etaWords, etaShort, cardTransferWords, titlePrefix, hasActiveTransfers, awayWords,
  opWords, exportWords, copyWords, copyDoneWords } from './activityWords.js';

const MB = 1024 ** 2;
const NOW = 100_000;
const batch = (o = {}) => ({ id: 'b1', kind: 'upload', boardId: 'x', boardName: 'Halcyon', label: null, createdAt: 0, ...o });
const it = (state, o = {}) => ({
  id: 't', batch: 'b1', kind: 'upload', label: 'a', boardId: 'x', cardId: null, bytesTotal: 0,
  fraction: 0, sentBytes: 0, rateBps: 0, state, error: null, startedAt: null, doneAt: null, actions: null, ...o,
});
const many = (n, state, o) => Array.from({ length: n }, () => it(state, o));

test('time left: importCopy’s rounding, first letter lower-cased', () => {
  assert.equal(etaWords(3 * 60000), 'about 3 min left');
  assert.equal(etaWords(20_000), 'less than a minute left');
  assert.equal(etaWords(80 * 60000), 'about 1 hr 20 min left');
  assert.equal(etaWords(null), null);
  assert.equal(etaWords(0), null);
});

test('the card form drops " left"', () => {
  assert.equal(etaShort(3 * 60000), 'about 3 min');
  assert.equal(etaShort(20_000), 'less than a minute');
  assert.equal(etaShort(80 * 60000), 'about 1 hr 20 min');
  assert.equal(etaShort(null), null);
});

test('a new version reads as that, in every state', () => {
  const v = { n: 3 };
  assert.deepEqual(cardTransferWords(it('running', { fraction: 0.42, version: v }), NOW), { tone: 'up', text: 'Uploading version 3', sub: '42%', pct: 42 });
  assert.equal(cardTransferWords(it('finishing', { version: v }), NOW).text, 'Making a preview…');
  assert.equal(cardTransferWords(it('failed', { version: v }), NOW).text, 'Didn’t upload');
});

test('card words, one per state', () => {
  assert.deepEqual(cardTransferWords(it('waiting'), NOW), { tone: 'wait', text: 'Waiting', sub: null, pct: null });
  assert.deepEqual(cardTransferWords(it('finishing'), NOW), { tone: 'busy', text: 'Making a preview…', sub: null, pct: null });
  assert.deepEqual(cardTransferWords(it('failed'), NOW), { tone: 'fail', text: 'Didn’t upload', sub: null, pct: null });
  assert.equal(cardTransferWords(it('done'), NOW), null);
  assert.equal(cardTransferWords(null, NOW), null);
});

test('a waiting card in a paused batch says Paused', () => {
  assert.deepEqual(cardTransferWords(it('waiting', { paused: true }), NOW), { tone: 'wait', text: 'Paused', sub: null, pct: null });
  assert.equal(cardTransferWords(it('waiting', { paused: false }), NOW).text, 'Waiting');
});

test('a running card says its percent, and the time left only once there is an estimate', () => {
  const young = it('running', { fraction: 0.42, bytesTotal: 100 * MB, sentBytes: 42 * MB, rateBps: MB, startedAt: NOW - 1000 });
  assert.deepEqual(cardTransferWords(young, NOW), { tone: 'up', text: '42%', sub: null, pct: 42 });
  const old = { ...young, etaText: 'about 3 min' };   // activity.js stores the words on the item
  assert.deepEqual(cardTransferWords(old, NOW), { tone: 'up', text: '42%', sub: 'about 3 min', pct: 42 });
  assert.equal(cardTransferWords(it('running', { fraction: 0.9985 }), NOW).text, '99%');
});

test('the tab title prefix sums upload batches with something still going', () => {
  const snap = {
    batches: [batch({ id: 'b1' }), batch({ id: 'b2' }), batch({ id: 'b3' }), batch({ id: 'b4', kind: 'export' })],
    items: [
      it('done', { batch: 'b1' }), it('running', { batch: 'b1' }),
      it('done', { batch: 'b2' }), it('done', { batch: 'b2' }),            // all done: not counted
      it('failed', { batch: 'b3' }), it('waiting', { batch: 'b3' }), it('finishing', { batch: 'b3' }),
      it('running', { batch: 'b4' }),                                       // not an upload
    ],
  };
  assert.equal(titlePrefix(snap), '(1/5) ');
  assert.equal(titlePrefix({ batches: [batch()], items: [it('done'), it('failed')] }), '');
  assert.equal(titlePrefix({ batches: [], items: [] }), '');
  assert.equal(titlePrefix(null), '');
});

test('hasActiveTransfers: waiting, running or finishing', () => {
  for (const s of ['waiting', 'running', 'finishing']) assert.equal(hasActiveTransfers({ items: [it(s)] }), true, s);
  for (const s of ['done', 'failed']) assert.equal(hasActiveTransfers({ items: [it(s)] }), false, s);
  assert.equal(hasActiveTransfers({ items: [] }), false);
  assert.equal(hasActiveTransfers(null), false);
});

test('away words: mine in another tab, or a teammate', () => {
  assert.deepEqual(awayWords({ name: 'Lena', mine: false }), { tone: 'up', text: 'Lena is uploading', sub: null, pct: null });
  assert.deepEqual(awayWords({ name: 'Lena', mine: true }), { tone: 'up', text: 'Uploading in another tab', sub: null, pct: null });
});

test('a hidden batch has no title prefix, but still counts as active', () => {
  const hidden = batch({ hidden: true });
  assert.equal(titlePrefix({ batches: [hidden], items: [it('running')] }), '');
  assert.equal(hasActiveTransfers({ items: [it('running')] }), true);
});

test('a parked item is left out of counts, the title prefix and the guards', () => {
  const items = [it('waiting', { parked: true }), it('done'), it('running')];
  assert.equal(titlePrefix({ batches: [batch()], items }), '(1/2) ');
  assert.equal(titlePrefix({ batches: [batch()], items: [it('waiting', { parked: true })] }), '');
  assert.equal(hasActiveTransfers({ items: [it('waiting', { parked: true })] }), false);
  assert.equal(hasActiveTransfers({ items }), true);
});

test('downloads: counted, single, no count, done, hand-off', () => {
  const d = (o) => it('running', { kind: 'download', label: 'Halcyon.zip', ...o });
  assert.equal(opWords(d({ count: { done: 34, total: 120 } })), 'Preparing download · 34 of 120 files');
  assert.equal(opWords(d({ count: { done: 0, total: 1200 } })), 'Preparing download · 0 of 1,200 files');
  assert.equal(opWords(d({ label: 'Reel.mov', count: { done: 0, total: 1 } })), 'Preparing Reel.mov…');
  assert.equal(opWords(d({ label: null })), 'Preparing download…');
  assert.equal(opWords(d({ state: 'done', doneLabel: 'Downloaded Halcyon.zip' })), 'Downloaded Halcyon.zip');
  assert.equal(opWords(d({ label: 'Reel.mov', state: 'done', doneLabel: 'Download started' })), 'Download started');
  assert.equal(opWords(d({ label: 'Reel.mov', state: 'done' })), 'Downloaded Reel.mov');
});

test('exports and copies', () => {
  assert.equal(exportWords({ name: 'Treatment_v3', format: 'pdf' }), 'Exporting Treatment_v3 as PDF…');
  assert.equal(exportWords({ name: 'Board', format: 'PNG' }), 'Exporting Board as PNG…');
  assert.equal(exportWords({ name: 'Notes', format: 'html' }), 'Exporting Notes as HTML…');
  assert.equal(exportWords({ name: 'Notes', format: 'md' }), 'Exporting Notes as Markdown…');
  assert.equal(copyWords({ count: 24 }), 'Copying 24 cards…');
  assert.equal(copyWords({ count: 1 }), 'Copying 1 card…');
  assert.equal(copyWords({ name: 'Halcyon' }), 'Copying Halcyon…');
  assert.equal(copyWords(), 'Copying…');
  assert.equal(copyDoneWords(), 'Copied');
  assert.equal(copyDoneWords({ personal: true }), 'Copied to your personal workspace');
  const e = it('running', { kind: 'export', label: exportWords({ name: 'T', format: 'pdf' }) });
  assert.equal(opWords(e), 'Exporting T as PDF…');
  assert.equal(opWords({ ...e, state: 'done', doneLabel: 'Exported T.pdf' }), 'Exported T.pdf');
  assert.equal(opWords(it('running', { kind: 'copy', label: 'Copying 24 cards…' })), 'Copying 24 cards…');
  assert.equal(opWords(it('done', { kind: 'copy', doneLabel: 'Copied' })), 'Copied');
  assert.equal(opWords(null), null);
});

test('ops count as active transfers but never reach the title prefix', () => {
  const snap = { batches: [batch({ kind: 'download' })], items: [it('running', { kind: 'download' })] };
  assert.equal(hasActiveTransfers(snap), true);
  assert.equal(titlePrefix(snap), '');
  assert.equal(hasActiveTransfers({ batches: snap.batches, items: [it('done', { kind: 'download' })] }), false);
});
