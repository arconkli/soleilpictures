// activity.test.mjs — the store of what this tab is moving.
//
//   node --test src/lib/activity.test.mjs
//
// Time is a manual clock (__setActivityClock) and node:test's mock timers; the
// `advance` helper moves both together.
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeLimiter } from './asyncPool.js';
import {
  subscribeActivity, activitySnapshot, startBatch, addTransfer, updateTransfer, removeTransfer, dismissBatch,
  transferForCard, cardTransferKey, transferCardIds, itemEtaMs, batchEtaMs, slotFree,
  pauseBatch, resumeBatch, transferPaused, untilTransferRuns, inLimiterUnlessPaused,
  setCardCanceller, canCancelTransfer, cancelTransfer,
  trayMounted, noteTrayMounted,
  DONE_LINGER_MS, __resetActivityForTests, __setActivityClock,
} from './activity.js';

let t = 0;
const advance = (ms) => { t += ms; mock.timers.tick(ms); };
const micro = () => new Promise((r) => queueMicrotask(r));
const MB = 1024 ** 2;

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t = 1_000_000;
  __resetActivityForTests();
  __setActivityClock(() => t);
});
afterEach(() => {
  __resetActivityForTests();
  mock.timers.reset();
});

const item = (id) => activitySnapshot().items.find((i) => i.id === id);

test('ids count up per kind of thing', () => {
  assert.equal(startBatch({}), 'b1');
  assert.equal(startBatch({ boardId: 'x' }), 'b2');
  const b = startBatch({});
  assert.equal(addTransfer({ batch: b, label: 'a' }), 't1');
  assert.equal(addTransfer({ batch: b, label: 'b' }), 't2');
});

test('add, update and remove show in the snapshot; an unknown id is a no-op', () => {
  const b = startBatch({ boardId: 'x', boardName: 'Halcyon' });
  const id = addTransfer({ batch: b, label: 'a.jpg', bytesTotal: 100, boardId: 'x' });
  assert.deepEqual(activitySnapshot().batches.map((x) => [x.id, x.kind, x.boardName]), [[b, 'upload', 'Halcyon']]);
  assert.equal(item(id).state, 'waiting');
  assert.equal(item(id).kind, 'upload');
  assert.equal(item(id).startedAt, null);
  updateTransfer(id, { cardId: 'c1' });
  assert.equal(item(id).cardId, 'c1');
  updateTransfer('nope', { state: 'running' });
  assert.equal(activitySnapshot().items.length, 1);
  removeTransfer(id);
  assert.equal(activitySnapshot().items.length, 0);
  assert.equal(activitySnapshot().batches.length, 0, 'an emptied batch goes with its last item');
  removeTransfer(id);
});

test('the snapshot is the same object until something changes', () => {
  const b = startBatch({});
  const a = activitySnapshot();
  assert.equal(activitySnapshot(), a);
  addTransfer({ batch: b, label: 'a' });
  assert.notEqual(activitySnapshot(), a);
});

test('running sets startedAt once', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', bytesTotal: 10 });
  updateTransfer(id, { state: 'running' });
  assert.equal(item(id).startedAt, t);
  advance(5000);
  updateTransfer(id, { fraction: 0.3 });
  assert.equal(item(id).startedAt, t - 5000);
});

test('waiting (a retry) resets progress and the error', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', bytesTotal: 10 * MB });
  updateTransfer(id, { state: 'running' });
  advance(1000);
  updateTransfer(id, { fraction: 0.2 });
  advance(1000);
  updateTransfer(id, { fraction: 0.5 });
  updateTransfer(id, { state: 'failed', error: 'Didn’t upload' });
  assert.equal(item(id).error, 'Didn’t upload');
  updateTransfer(id, { state: 'waiting' });
  const it = item(id);
  assert.deepEqual([it.fraction, it.sentBytes, it.rateBps, it.startedAt, it.error], [0, 0, 0, null, null]);
});

test('a fraction becomes sentBytes', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', bytesTotal: 1000 });
  updateTransfer(id, { state: 'running', fraction: 0.4 });
  assert.equal(item(id).sentBytes, 400);
  assert.equal(item(id).fraction, 0.4);
});

test('0.999 or more while running means finishing; 1 while waiting does not', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', bytesTotal: 1000 });
  updateTransfer(id, { state: 'running', fraction: 0.998 });
  assert.equal(item(id).state, 'running');
  updateTransfer(id, { fraction: 0.999 });
  assert.equal(item(id).state, 'finishing');
  const w = addTransfer({ batch: b, label: 'w', bytesTotal: 1000 });
  updateTransfer(w, { fraction: 1 });
  assert.equal(item(w).state, 'waiting');
});

test('rate is an EWMA over samples at least a second apart', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', bytesTotal: 100 * MB });
  updateTransfer(id, { state: 'running' });
  updateTransfer(id, { fraction: 0 });                // base sample
  advance(500);
  updateTransfer(id, { fraction: 0.05 });             // under a second: no sample
  assert.equal(item(id).rateBps, 0);
  advance(500);
  updateTransfer(id, { fraction: 0.1 });              // 10 MB in 1 s, taken as is
  assert.equal(item(id).rateBps, 10 * MB);
  advance(1000);
  updateTransfer(id, { fraction: 0.12 });             // 2 MB in 1 s
  assert.equal(item(id).rateBps, 10 * MB * 0.8 + 2 * MB * 0.2);
});

test('a fraction going backwards resets the sample base', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', bytesTotal: 100 * MB });
  updateTransfer(id, { state: 'running', fraction: 0 });
  advance(1000);
  updateTransfer(id, { fraction: 0.5 });
  assert.equal(item(id).rateBps, 50 * MB);
  advance(1000);
  updateTransfer(id, { fraction: 0.1 });              // a retried PUT restarts
  assert.equal(item(id).rateBps, 50 * MB, 'no sample from the jump back');
  advance(1000);
  updateTransfer(id, { fraction: 0.2 });              // 10 MB since the new base
  assert.equal(item(id).rateBps, 50 * MB * 0.8 + 10 * MB * 0.2);
});

test('done sets doneAt, fraction 1 and every byte', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', bytesTotal: 1000 });
  updateTransfer(id, { state: 'running', fraction: 0.5 });
  advance(10);
  updateTransfer(id, { state: 'done' });
  const it = item(id);
  assert.deepEqual([it.state, it.fraction, it.sentBytes, it.doneAt], ['done', 1, 1000, t]);
});

test('notifications coalesce on a microtask', async () => {
  let n = 0;
  subscribeActivity(() => { n++; });
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a' });
  updateTransfer(id, { state: 'running' });
  assert.equal(n, 0);
  await micro();
  assert.equal(n, 1);
  const off = subscribeActivity(() => { n += 100; });
  off();
  updateTransfer(id, { cardId: 'c' });
  await micro();
  assert.equal(n, 2);
});

test('progress-only notifies at most every 250 ms, and the last value lands', async () => {
  const seen = [];
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', bytesTotal: 1000 });
  updateTransfer(id, { state: 'running' });
  await micro();                                      // the structural flush opens the 250 ms window
  subscribeActivity(() => { seen.push(item(id).fraction); });
  updateTransfer(id, { fraction: 0.1 });
  await micro();
  const first = seen.length;
  assert.equal(first, 0, 'inside the window: held');
  advance(10);
  updateTransfer(id, { fraction: 0.2 });
  advance(10);
  updateTransfer(id, { fraction: 0.3 });
  await micro();
  assert.equal(seen.length, first, 'inside the window: held');
  advance(240);
  assert.equal(seen.length, first + 1, 'trailing notify fires once');
  assert.equal(seen.at(-1), 0.3, 'with the last value');
});

test('an all-done batch leaves 4 s after its last item finished', async () => {
  const b = startBatch({});
  const a = addTransfer({ batch: b, label: 'a', bytesTotal: 10 });
  const c = addTransfer({ batch: b, label: 'c', bytesTotal: 10 });
  updateTransfer(a, { state: 'done' });
  advance(3000);
  updateTransfer(c, { state: 'done' });
  advance(DONE_LINGER_MS - 1);
  assert.equal(activitySnapshot().items.length, 2);
  advance(1);
  assert.equal(activitySnapshot().items.length, 0);
  assert.equal(activitySnapshot().batches.length, 0);
});

test('a retry or a new item cancels the leaving', () => {
  const b = startBatch({});
  const a = addTransfer({ batch: b, label: 'a', bytesTotal: 10 });
  updateTransfer(a, { state: 'done' });
  advance(2000);
  const c = addTransfer({ batch: b, label: 'c' });
  advance(10_000);
  assert.equal(activitySnapshot().items.length, 2);
  updateTransfer(c, { state: 'done' });
  advance(DONE_LINGER_MS);
  assert.equal(activitySnapshot().items.length, 0);
});

test('a batch with a failure stays until dismissed', () => {
  const b = startBatch({});
  const a = addTransfer({ batch: b, label: 'a', bytesTotal: 10 });
  const c = addTransfer({ batch: b, label: 'c', bytesTotal: 10 });
  updateTransfer(a, { state: 'done' });
  updateTransfer(c, { state: 'failed', error: 'x' });
  advance(60_000);
  assert.equal(activitySnapshot().items.length, 2);
  dismissBatch(b);
  assert.equal(activitySnapshot().items.length, 0);
  assert.equal(activitySnapshot().batches.length, 0);
});

test('dismissBatch keeps what is still moving', () => {
  const b = startBatch({});
  const a = addTransfer({ batch: b, label: 'a' });
  const c = addTransfer({ batch: b, label: 'c' });
  updateTransfer(c, { state: 'failed' });
  dismissBatch(b);
  assert.deepEqual(activitySnapshot().items.map((i) => i.id), [a]);
  assert.equal(activitySnapshot().batches.length, 1);
});

test('transferForCard picks the newest item that is not done', () => {
  const b = startBatch({});
  const a = addTransfer({ batch: b, label: 'a', cardId: 'c1' });
  const c = addTransfer({ batch: b, label: 'c', cardId: 'c1' });
  const d = addTransfer({ batch: b, label: 'd', cardId: 'c2' });
  assert.equal(transferForCard('c1').id, c);
  updateTransfer(c, { state: 'done' });
  assert.equal(transferForCard('c1').id, a);
  updateTransfer(a, { state: 'done' });
  assert.equal(transferForCard('c1'), null);
  assert.equal(transferForCard('c2').id, d);
  assert.equal(transferForCard(null), null);
  assert.equal(transferForCard('zzz'), null);
});

test('cardTransferKey changes only with state, percent or time left', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', cardId: 'c1', bytesTotal: 100 * MB });
  assert.equal(cardTransferKey('none'), '');
  assert.equal(cardTransferKey('c1'), 'waiting|0|');
  updateTransfer(id, { state: 'running', fraction: 0 });
  assert.equal(cardTransferKey('c1'), 'running|0|');
  updateTransfer(id, { fraction: 0.014 });
  assert.equal(cardTransferKey('c1'), 'running|1|');
  updateTransfer(id, { fraction: 0.019 });
  assert.equal(cardTransferKey('c1'), 'running|1|', 'same percent, same key');
  advance(4000);
  updateTransfer(id, { fraction: 0.02 });             // a rate now exists
  const withEta = cardTransferKey('c1');
  assert.match(withEta, /^running\|2\|about \d/);
  assert.equal(cardTransferKey('c1'), withEta, 'reading it again changes nothing');
  advance(30_000);
  assert.equal(cardTransferKey('c1'), withEta, 'the clock alone never moves the key');
  updateTransfer(id, { state: 'finishing', fraction: 1 });
  assert.equal(cardTransferKey('c1'), 'finishing|0|');
  updateTransfer(id, { state: 'failed' });
  assert.equal(cardTransferKey('c1'), 'failed|0|');
  updateTransfer(id, { state: 'done' });
  assert.equal(cardTransferKey('c1'), '');
});

test('transferCardIds keeps its Set across progress and changes with membership', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', cardId: 'c1', bytesTotal: 100 });
  const s1 = transferCardIds();
  assert.deepEqual([...s1], ['c1']);
  updateTransfer(id, { state: 'running', fraction: 0.3 });
  assert.equal(transferCardIds(), s1);
  updateTransfer(id, { state: 'failed' });
  assert.equal(transferCardIds(), s1, 'a failed card is still a member');
  const id2 = addTransfer({ batch: b, label: 'b', cardId: 'c2' });
  const s2 = transferCardIds();
  assert.notEqual(s2, s1);
  assert.deepEqual([...s2].sort(), ['c1', 'c2']);
  updateTransfer(id2, { state: 'done' });
  assert.deepEqual([...transferCardIds()], ['c1']);
  const noCard = addTransfer({ batch: b, label: 'x' });
  assert.deepEqual([...transferCardIds()], ['c1'], 'items without a card are not members');
  removeTransfer(noCard);
});

test('item time left needs 3 s of running and a rate', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', bytesTotal: 100 * MB });
  updateTransfer(id, { state: 'running', fraction: 0 });
  advance(1000);
  updateTransfer(id, { fraction: 0.1 });              // 10 MB/s, 90 MB left
  assert.equal(itemEtaMs(item(id)), null, 'running only 1 s');
  advance(2000);
  assert.equal(itemEtaMs(item(id)), 9000);
  assert.equal(itemEtaMs({ ...item(id), state: 'waiting' }), null);
  assert.equal(itemEtaMs({ ...item(id), rateBps: 0 }), null);
  assert.equal(itemEtaMs({ ...item(id), bytesTotal: 0 }), null);
});

test('batch time left: remaining bytes over the running items’ rates', () => {
  const b = startBatch({});
  const a = addTransfer({ batch: b, label: 'a', bytesTotal: 100 * MB });
  const c = addTransfer({ batch: b, label: 'c', bytesTotal: 100 * MB });
  const d = addTransfer({ batch: b, label: 'd', bytesTotal: 100 * MB });
  const e = addTransfer({ batch: b, label: 'e', bytesTotal: 100 * MB });
  const batch = () => activitySnapshot().batches[0];
  const mine = () => activitySnapshot().items;
  updateTransfer(a, { state: 'running', fraction: 0 });
  updateTransfer(c, { state: 'running', fraction: 0 });
  advance(1000);
  updateTransfer(a, { fraction: 0.1 });               // 10 MB/s
  updateTransfer(c, { fraction: 0.1 });
  assert.equal(batchEtaMs(batch(), mine()), null, 'batch younger than 3 s');
  advance(2000);
  // left: a 90 + c 90 + d 100 (waiting) + e 100 (failed, not counted when failed) ; rate 20
  updateTransfer(e, { state: 'failed' });
  updateTransfer(d, { state: 'done' });
  assert.equal(batchEtaMs(batch(), mine()), (180 / 20) * 1000);
  updateTransfer(a, { state: 'failed' });
  updateTransfer(c, { state: 'failed' });
  assert.equal(batchEtaMs(batch(), mine()), null, 'nothing running: no rate');
});

test('finishing goes back to running when a retried PUT restarts the fraction', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', bytesTotal: 1000 });
  updateTransfer(id, { state: 'running', fraction: 0.5 });
  const started = item(id).startedAt;
  updateTransfer(id, { fraction: 1 });
  assert.equal(item(id).state, 'finishing');
  updateTransfer(id, { fraction: 0.2 });
  assert.equal(item(id).state, 'running');
  assert.equal(item(id).startedAt, started);
  updateTransfer(id, { fraction: 1 });
  assert.equal(item(id).state, 'finishing');
  updateTransfer(id, { fraction: 1 });
  assert.equal(item(id).state, 'finishing', 'not lower than before: stays');
});

test('slotFree resolves when the item reaches finishing', async () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', bytesTotal: 1000 });
  updateTransfer(id, { state: 'running', fraction: 0.1 });
  let done = false;
  const h = slotFree(id);
  h.promise.then(() => { done = true; });
  await micro();
  assert.equal(done, false);
  updateTransfer(id, { fraction: 1 });
  await micro(); await micro();
  assert.equal(done, true);
});

test('slotFree resolves when the item is removed, done or failed, or already gone', async () => {
  const b = startBatch({});
  for (const how of ['remove', 'done', 'failed']) {
    const id = addTransfer({ batch: b, label: how, bytesTotal: 10, state: 'running' });
    let done = false;
    slotFree(id).promise.then(() => { done = true; });
    if (how === 'remove') removeTransfer(id); else updateTransfer(id, { state: how });
    await micro(); await micro();
    assert.equal(done, true, how);
  }
  let gone = false;
  slotFree('t999').promise.then(() => { gone = true; });
  await micro(); await micro();
  assert.equal(gone, true);
});

test('slotFree resolves after quietMs without progress, and not while progress keeps coming', async () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', bytesTotal: 1000, state: 'running' });
  let done = false;
  slotFree(id).promise.then(() => { done = true; });
  for (let i = 1; i <= 5; i++) {
    advance(30_000);
    updateTransfer(id, { fraction: i * 0.1 });
  }
  await micro(); await micro();
  assert.equal(done, false, '150 s in, but never quiet for 60 s');
  advance(59_999);
  await micro(); await micro();
  assert.equal(done, false);
  advance(1);
  await micro(); await micro();
  assert.equal(done, true);
});

test('slotFree cancel leaves no timer or subscription', async () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', bytesTotal: 1000, state: 'running' });
  let done = false;
  const h = slotFree(id);
  h.promise.then(() => { done = true; });
  h.cancel();
  advance(120_000);
  updateTransfer(id, { fraction: 1 });
  await micro(); await micro();
  assert.equal(done, false);
});

test('the time-left words refresh on a 1 s tick and notify only when they change', async () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', cardId: 'c1', bytesTotal: 100 * MB });
  updateTransfer(id, { state: 'running', fraction: 0 });
  advance(1000);
  updateTransfer(id, { fraction: 0.1 });              // 10 MB/s
  await micro();
  assert.equal(item(id).etaText, null, 'running only 1 s');
  let n = 0;
  subscribeActivity(() => { n++; });
  advance(1000);
  await micro();
  assert.equal(n, 0, 'still under 3 s: nothing changed');
  advance(1000);
  await micro();
  assert.equal(item(id).etaText, 'less than a minute');
  assert.equal(n, 1);
  assert.equal(cardTransferKey('c1'), 'running|10|less than a minute');
  advance(1000);
  await micro();
  assert.equal(n, 1, 'same words: no notify');
});

test('transferForCard follows the index through add, update, done, remove and a card change', () => {
  const b = startBatch({});
  const a = addTransfer({ batch: b, label: 'a', cardId: 'c1' });
  const c = addTransfer({ batch: b, label: 'c' });
  assert.equal(transferForCard('c1').id, a);
  updateTransfer(c, { cardId: 'c1' });
  assert.equal(transferForCard('c1').id, c, 'the newest wins');
  updateTransfer(c, { cardId: 'c2' });
  assert.equal(transferForCard('c1').id, a);
  assert.equal(transferForCard('c2').id, c);
  removeTransfer(a);
  assert.equal(transferForCard('c1'), null);
  updateTransfer(c, { state: 'done' });
  assert.equal(transferForCard('c2'), null);
});

test('500 cards across 500 items resolve by index', () => {
  const b = startBatch({});
  const ids = [];
  for (let i = 0; i < 500; i++) ids.push(addTransfer({ batch: b, label: `f${i}`, cardId: `card${i}`, bytesTotal: 10 }));
  for (let i = 0; i < 500; i++) assert.equal(transferForCard(`card${i}`).id, ids[i]);
  for (let i = 0; i < 500; i += 2) updateTransfer(ids[i], { state: 'done' });
  for (let i = 0; i < 500; i++) assert.equal(cardTransferKey(`card${i}`), i % 2 ? 'waiting|0|' : '');
  assert.equal(transferCardIds().size, 250);
});

test('a hidden batch counts for cards; a parked item leaves transferCardIds', () => {
  const b = startBatch({ hidden: true });
  assert.equal(activitySnapshot().batches[0].hidden, true);
  const id = addTransfer({ batch: b, label: 'a', cardId: 'c1' });
  assert.deepEqual([...transferCardIds()], ['c1']);
  assert.equal(transferForCard('c1').id, id);
  updateTransfer(id, { parked: true });
  assert.equal(item(id).parked, true);
  assert.deepEqual([...transferCardIds()], []);
  assert.equal(transferForCard('c1').id, id, 'the card still reads it');
  updateTransfer(id, { parked: false });
  assert.deepEqual([...transferCardIds()], ['c1']);
});

test('mime and thumb are stored on the item', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a.jpg', mime: 'image/jpeg', thumb: 'blob:x' });
  assert.equal(item(id).mime, 'image/jpeg');
  assert.equal(item(id).thumb, 'blob:x');
  const bare = addTransfer({ batch: b, label: 'b' });
  assert.equal(item(bare).mime, '');
  assert.equal(item(bare).thumb, null);
  updateTransfer(id, { thumb: 'blob:y' });
  assert.equal(item(id).thumb, 'blob:y');
});

test('retryOnline is cleared by a state change unless the patch sets it', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a' });
  updateTransfer(id, { state: 'running' });
  updateTransfer(id, { state: 'failed', retryOnline: true });
  assert.equal(item(id).retryOnline, true);
  updateTransfer(id, { error: 'x' });
  assert.equal(item(id).retryOnline, true, 'no state change: kept');
  updateTransfer(id, { state: 'waiting' });
  assert.equal(item(id).retryOnline, false);
  updateTransfer(id, { state: 'failed' });
  assert.equal(item(id).retryOnline, false);
});

test('pause marks the waiting items, resume clears them; running is unaffected', () => {
  const b = startBatch({});
  const run = addTransfer({ batch: b, label: 'r', state: 'running' });
  const w1 = addTransfer({ batch: b, label: 'w1' });
  assert.equal(activitySnapshot().batches[0].paused, false);
  pauseBatch(b);
  assert.equal(activitySnapshot().batches[0].paused, true);
  assert.equal(item(w1).paused, true);
  assert.equal(item(run).paused, false);
  assert.equal(transferPaused(w1), true);
  assert.equal(transferPaused(run), false);
  const w2 = addTransfer({ batch: b, label: 'w2' });
  assert.equal(item(w2).paused, true, 'a new waiting item in a paused batch');
  updateTransfer(w2, { state: 'running' });
  assert.equal(item(w2).paused, false);
  updateTransfer(w2, { state: 'waiting' });
  assert.equal(item(w2).paused, true, 'back to waiting while paused');
  resumeBatch(b);
  assert.equal(activitySnapshot().batches[0].paused, false);
  assert.equal(item(w1).paused, false);
  assert.equal(item(w2).paused, false);
  assert.equal(transferPaused(w1), false);
  pauseBatch('nope');
});

test('cardTransferKey carries paused', () => {
  const b = startBatch({});
  addTransfer({ batch: b, label: 'a', cardId: 'c1' });
  assert.equal(cardTransferKey('c1'), 'waiting|0|');
  pauseBatch(b);
  assert.equal(cardTransferKey('c1'), 'waiting|0||paused');
  resumeBatch(b);
  assert.equal(cardTransferKey('c1'), 'waiting|0|');
});

test('untilTransferRuns resolves at once when not paused, on resume, on removal and when no longer waiting', async () => {
  const b = startBatch({});
  const free = addTransfer({ batch: b, label: 'f', state: 'running' });
  await untilTransferRuns(free);
  await untilTransferRuns('gone');
  const a = addTransfer({ batch: b, label: 'a' });
  const c = addTransfer({ batch: b, label: 'c' });
  const d = addTransfer({ batch: b, label: 'd' });
  pauseBatch(b);
  const log = [];
  const pa = untilTransferRuns(a).then(() => log.push('a'));
  const pc = untilTransferRuns(c).then(() => log.push('c'));
  const pd = untilTransferRuns(d).then(() => log.push('d'));
  await micro();
  assert.deepEqual(log, []);
  removeTransfer(a);
  await pa;
  assert.deepEqual(log, ['a']);
  updateTransfer(c, { state: 'failed' });
  await pc;
  resumeBatch(b);
  await pd;
  assert.deepEqual(log.sort(), ['a', 'c', 'd']);
});

test('inLimiterUnlessPaused gives the slot back when paused while queued, and runs after resume', async () => {
  const b = startBatch({});
  const limiter = makeLimiter(1);
  const t1 = addTransfer({ batch: b, label: '1' });
  const t2 = addTransfer({ batch: b, label: '2' });
  const ran = [];
  let release1;
  const p1 = inLimiterUnlessPaused(t1, limiter, () => new Promise((r) => { release1 = r; ran.push('1'); }));
  const p2 = inLimiterUnlessPaused(t2, limiter, async () => { ran.push('2'); return 'two'; });
  await micro(); await micro();
  assert.deepEqual(ran, ['1']);
  pauseBatch(b);                      // t2 is queued behind t1; t1 is already running its task
  release1();
  await p1;
  await micro(); await micro();
  assert.deepEqual(ran, ['1'], 't2 did not run while paused');
  // The slot is free: another task goes straight through.
  assert.equal(await limiter(async () => 'other'), 'other');
  resumeBatch(b);
  assert.equal(await p2, 'two');
  assert.deepEqual(ran, ['1', '2']);
});

test('inLimiterUnlessPaused: paused while it sat in the limiter queue', async () => {
  const limiter = makeLimiter(1);
  const b = startBatch({});
  const t = addTransfer({ batch: b, label: 'x' });
  let release;
  const holder = limiter(() => new Promise((r) => { release = r; }));
  const ran = [];
  const p = inLimiterUnlessPaused(t, limiter, async () => { ran.push('x'); return 1; });
  await micro();
  pauseBatch(b);
  release();
  await holder;
  await micro(); await micro();
  assert.deepEqual(ran, []);
  assert.equal(await limiter(async () => 'free'), 'free', 'the slot was handed back');
  resumeBatch(b);
  assert.equal(await p, 1);
});

test('dismissBatch keeps a failed card that still offers Retry, and the batch stays dismissed', () => {
  const b = startBatch({});
  const kept = addTransfer({ batch: b, label: 'k', cardId: 'c1', actions: { retry: () => {} } });
  const noRetry = addTransfer({ batch: b, label: 'n', cardId: 'c2', actions: { remove: () => {} } });
  const bare = addTransfer({ batch: b, label: 'b' });
  const ok = addTransfer({ batch: b, label: 'ok', state: 'done' });
  updateTransfer(kept, { state: 'failed' });
  updateTransfer(noRetry, { state: 'failed' });
  updateTransfer(bare, { state: 'failed' });
  dismissBatch(b);
  assert.deepEqual(activitySnapshot().items.map((i) => i.id), [kept]);
  assert.equal(activitySnapshot().batches[0].dismissed, true);
  void ok;
  // A retry brings it back.
  updateTransfer(kept, { state: 'waiting' });
  assert.equal(activitySnapshot().batches[0].dismissed, false);
});

test('dismissBatch does not keep a failed new version: its card is intact', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'v', cardId: 'c1', version: { n: 2 }, actions: { retry: () => {} } });
  updateTransfer(id, { state: 'failed' });
  dismissBatch(b);
  assert.equal(activitySnapshot().items.length, 0);
  assert.equal(activitySnapshot().batches.length, 0);
});

test('dismissBatch with only kept failures left goes away when nothing stays', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'k', cardId: 'c1' });
  updateTransfer(id, { state: 'failed' });
  dismissBatch(b);
  assert.equal(activitySnapshot().batches.length, 0);
});

test('card cancellers: only cancellable list rows, and a running one only when its upload aborts', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', boardId: 'x', cardId: 'c1', cancellable: true });
  const noCard = addTransfer({ batch: b, label: 'n', boardId: 'x', cancellable: true });
  const listDrop = addTransfer({ batch: b, label: 'l', boardId: 'x', cardId: 'c2' });
  assert.equal(canCancelTransfer(item(id)), false, 'no canceller yet');
  const calls = [];
  const s0 = activitySnapshot();
  const off = setCardCanceller('x', (c) => calls.push(c));
  assert.notEqual(activitySnapshot(), s0, 'the snapshot changes so the tray re-renders');
  assert.deepEqual(activitySnapshot().cancellers, ['x']);
  assert.equal(canCancelTransfer(item(id)), true);
  assert.equal(canCancelTransfer(item(noCard)), false, 'no card yet');
  assert.equal(canCancelTransfer(item(listDrop)), false, 'a list drop is not cancellable from the tray');
  updateTransfer(id, { state: 'running' });
  assert.equal(canCancelTransfer(item(id)), false, 'running but its upload does not abort');
  updateTransfer(id, { abortable: true });
  assert.equal(canCancelTransfer(item(id)), true);
  cancelTransfer(id);
  assert.deepEqual(calls, ['c1']);
  cancelTransfer(noCard);
  assert.deepEqual(calls, ['c1']);
  updateTransfer(id, { state: 'finishing' });
  assert.equal(canCancelTransfer(item(id)), false);
  updateTransfer(id, { state: 'waiting' });
  assert.equal(item(id).abortable, false, 'a new wait clears the mark');
  assert.equal(canCancelTransfer(item(id)), true);
  off();
  assert.equal(canCancelTransfer(item(id)), false);
  const off2 = setCardCanceller('y', () => {});
  assert.deepEqual(activitySnapshot().cancellers, ['y']);
  off2();
  assert.deepEqual(activitySnapshot().cancellers, []);
});

test('the same cluster in both panes: a stack of cancellers per board, the newest cancels', () => {
  const b = startBatch({});
  const id = addTransfer({ batch: b, label: 'a', boardId: 'x', cardId: 'c1', cancellable: true });
  const calls = [];
  const offA = setCardCanceller('x', (c) => calls.push(`A ${c}`));
  const s1 = activitySnapshot();
  const offB = setCardCanceller('x', (c) => calls.push(`B ${c}`));
  assert.notEqual(activitySnapshot(), s1, 'the snapshot changes on every register');
  cancelTransfer(id);
  assert.deepEqual(calls, ['B c1']);
  const s2 = activitySnapshot();
  offB();                              // one pane closes: the other still cancels
  assert.notEqual(activitySnapshot(), s2, 'and on every unregister');
  assert.equal(canCancelTransfer(item(id)), true);
  cancelTransfer(id);
  assert.equal(calls.at(-1), 'A c1');
  offB();                              // twice: no effect
  assert.equal(canCancelTransfer(item(id)), true);
  offA();
  assert.equal(canCancelTransfer(item(id)), false);
  assert.deepEqual(activitySnapshot().cancellers, []);
});

test('a paused file whose card is deleted does not hang: a parked item is not paused', async () => {
  const limiter = makeLimiter(1);
  const b = startBatch({});
  const t1 = addTransfer({ batch: b, label: 'x', cardId: 'c1' });
  pauseBatch(b);
  assert.equal(transferPaused(t1), true);
  updateTransfer(t1, { parked: true });
  assert.equal(transferPaused(t1), false);
  await untilTransferRuns(t1);
  const ran = [];
  assert.equal(await inLimiterUnlessPaused(t1, limiter, async () => { ran.push('x'); return 'ran'; }), 'ran');
  assert.deepEqual(ran, ['x']);
});

test('Undo before its slot unparks a paused item: it gives the slot back and waits again', async () => {
  const limiter = makeLimiter(1);
  const b = startBatch({});
  const t1 = addTransfer({ batch: b, label: 'x', cardId: 'c1' });
  pauseBatch(b);
  updateTransfer(t1, { parked: true });
  let release;
  const holder = limiter(() => new Promise((r) => { release = r; }));
  const ran = [];
  const p = inLimiterUnlessPaused(t1, limiter, async () => { ran.push('x'); return 1; });
  await micro();                       // queued behind the holder, not paused (parked)
  updateTransfer(t1, { parked: false });
  assert.equal(transferPaused(t1), true);
  release();
  await holder;
  await micro(); await micro();
  assert.deepEqual(ran, [], 'did not run while paused');
  assert.equal(await limiter(async () => 'free'), 'free', 'the slot was handed back');
  resumeBatch(b);
  assert.equal(await p, 1);
});

test('op batches: kind, per-batch linger, count, cancel and version ride on the items', () => {
  const b = startBatch({ kind: 'copy', showAfterMs: 0, lingerMs: 8000 });
  assert.equal(activitySnapshot().batches[0].kind, 'copy');
  assert.equal(activitySnapshot().batches[0].showAfterMs, 0);
  const cancel = () => {};
  const id = addTransfer({ batch: b, kind: 'copy', label: 'Copying…', state: 'running', count: { done: 0, total: 24 }, cancel });
  assert.deepEqual(item(id).count, { done: 0, total: 24 });
  assert.equal(item(id).cancel, cancel);
  assert.equal(item(id).version, null);
  updateTransfer(id, { count: { done: 5, total: 24 } });
  assert.deepEqual(item(id).count, { done: 5, total: 24 });
  updateTransfer(id, { state: 'done', actions: { open: () => {} } });
  advance(DONE_LINGER_MS);
  assert.equal(activitySnapshot().batches.length, 1, 'a longer linger outlasts the default');
  advance(8000 - DONE_LINGER_MS);
  assert.equal(activitySnapshot().batches.length, 0);
  const v = addTransfer({ batch: startBatch({}), label: 'a.png', version: { n: 3 } });
  assert.deepEqual(item(v).version, { n: 3 });
});

test('the default linger is unchanged', () => {
  const b = startBatch({});
  addTransfer({ batch: b, label: 'a', state: 'done' });
  advance(DONE_LINGER_MS - 1);
  assert.equal(activitySnapshot().batches.length, 1);
  advance(1);
  assert.equal(activitySnapshot().batches.length, 0);
});

test('tray presence: a counter, each unmount undoes only its own', () => {
  assert.equal(trayMounted(), false);
  const a = noteTrayMounted();
  const b = noteTrayMounted();
  assert.equal(trayMounted(), true);
  a(); a();
  assert.equal(trayMounted(), true);
  b();
  assert.equal(trayMounted(), false);
});
