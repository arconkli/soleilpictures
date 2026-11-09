// activityTray.test.mjs — the tray's rules and every word it says.
//
//   node --test src/lib/activityTray.test.mjs
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { trayModel, SHOW_AFTER_MS, OFFLINE_AFTER_MS } from './activityTray.js';
import {
  startBatch, addTransfer, updateTransfer, setCardCanceller, __resetActivityForTests, __setActivityClock,
} from './activity.js';

const MB = 1024 ** 2;
const GB = 1024 ** 3;
const T0 = 1_000_000;
const NOW = T0 + 60_000;

beforeEach(() => { __resetActivityForTests(); __setActivityClock(() => T0); });
afterEach(() => { __resetActivityForTests(); });

const batch = (o = {}) => ({
  id: 'b1', kind: 'upload', boardId: 'x', boardName: 'Halcyon', label: null, hidden: false,
  createdAt: T0, paused: false, dismissed: false, ...o,
});
let seq = 0;
const it = (state, o = {}) => ({
  id: `t${++seq}`, batch: 'b1', kind: 'upload', label: `f${seq}.jpg`, boardId: 'x', cardId: null, bytesTotal: 0,
  fraction: 0, sentBytes: 0, rateBps: 0, state, error: null, startedAt: null, doneAt: null, actions: null,
  etaText: null, parked: false, mime: '', thumb: null, paused: false, retryOnline: false,
  cancellable: false, abortable: false, ...o,
});
const many = (n, state, o) => Array.from({ length: n }, () => it(state, o));
const conn = (o = {}) => ({ state: 'live', pending: false, kept: true, live: true, liveSince: 0, everLive: true, ...o });
const model = (o = {}) => trayModel({
  activity: { batches: [], items: [] }, held: { entries: [], awaiting: false }, importLead: null, guideOpen: false,
  conn: null, offlineForMs: null, canRetryConnection: false, now: NOW, ...o,
});
const act = (batches, items) => ({ batches, items });
const only = (m) => { assert.equal(m.sections.length, 1, 'one section'); return m.sections[0]; };
const text = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.b)).join('');

// A running batch of 12: 6 done (100 MB each), 6 waiting (100 MB each).
const twelve = (o = {}) => act([batch(o)], [...many(6, 'done', { bytesTotal: 100 * MB, doneAt: T0 + 5000 }), ...many(6, 'waiting', { bytesTotal: 100 * MB })]);

test('constants', () => {
  assert.equal(SHOW_AFTER_MS, 1000);
  assert.equal(OFFLINE_AFTER_MS, 2000);
});

test('an upload batch: title, line, bytes, pct, head action, chip', () => {
  const s = only(model({ activity: twelve() }));
  assert.equal(s.kind, 'batch');
  assert.equal(s.title, 'Uploading 12 files to Halcyon');
  assert.equal(s.announce, s.title);
  assert.deepEqual(s.line, [{ b: '6 of 12' }, ' uploaded', ' · 0.6 of 1.2 GB']);
  assert.equal(s.pct, 50);
  assert.deepEqual(s.headAction, { id: 'pause', label: 'Pause' });
  assert.equal(s.close, 'fold');
  assert.equal(s.opens, true);
  assert.equal(s.chipOnly, false);
  assert.deepEqual(s.chip.parts, ['Uploading · ', { b: '6 of 12' }]);
  assert.equal(s.chip.icon, 'ring');
  assert.equal(s.chip.pct, 50);
  assert.equal(s.chip.tone, null);
  assert.equal(s.chip.chevron, true);
  assert.equal(s.chip.label, 'Uploading · 6 of 12. Open');
});

test('sizes: 0.4 of 1.6 GB, one decimal under 100, .0 dropped, 0 when nothing sent', () => {
  const a = act([batch()], [it('running', { bytesTotal: 1.6 * GB, sentBytes: 0.4 * GB, fraction: 0.25 }), it('waiting')]);
  assert.deepEqual(only(model({ activity: a })).line.slice(0, 3), [{ b: '0 of 2' }, ' uploaded', ' · 0.4 of 1.6 GB']);
  const b = act([batch()], [it('running', { bytesTotal: 1.6 * GB, sentBytes: 0, fraction: 0 }), it('waiting')]);
  assert.equal(text(only(model({ activity: b })).line), '0 of 2 uploaded · 0 of 1.6 GB');
  const c = act([batch()], [it('running', { bytesTotal: 2 * GB, sentBytes: 1 * GB, fraction: 0.5 }), it('waiting')]);
  assert.equal(text(only(model({ activity: c })).line), '0 of 2 uploaded · 1 of 2 GB');
  const d = act([batch()], [it('running', { bytesTotal: 300 * MB, sentBytes: 120 * MB, fraction: 0.4 }), it('waiting')]);
  assert.equal(text(only(model({ activity: d })).line), '0 of 2 uploaded · 120 of 300 MB');
});

test('no byte totals: no size part, pct by count', () => {
  const s = only(model({ activity: act([batch()], [...many(1, 'done', { doneAt: T0 + 100 }), ...many(3, 'waiting')]) }));
  assert.equal(text(s.line), '1 of 4 uploaded');
  assert.equal(s.pct, 25);
});

test('time left in the line and the chip, and failures', () => {
  const items = [
    it('running', { bytesTotal: 300 * MB, sentBytes: 120 * MB, rateBps: 1 * MB, startedAt: T0 }),
    it('waiting'), it('failed'),
  ];
  const s = only(model({ activity: act([batch()], items) }));
  assert.equal(text(s.line), '0 of 3 uploaded · 120 of 300 MB · about 3 min left · 1 didn’t upload');
  assert.equal(text(s.chip.parts), 'Uploading · 0 of 3 · about 3 min · 1 didn’t upload');
  assert.equal(s.opens, true);
});

test('paused: words, head action, chip', () => {
  const a = twelve({ paused: true });
  a.items.forEach((i) => { if (i.state === 'waiting') i.paused = true; });
  const s = only(model({ activity: a }));
  assert.deepEqual(s.line, [{ b: '6 of 12' }, ' uploaded · paused']);
  assert.deepEqual(s.headAction, { id: 'resume', label: 'Resume' });
  assert.deepEqual(s.chip.parts, ['Paused · ', { b: '6 of 12' }]);
  assert.equal(s.chip.icon, 'pause');
  const waiting = s.rows.filter((r) => r.state === 'later');
  assert.equal(waiting.length, 6);
  assert.ok(waiting.every((r) => r.c === 'Paused'));
});

test('head action: none while everything is running', () => {
  const a = act([batch()], [...many(2, 'running', { bytesTotal: MB }), ...many(2, 'finishing')]);
  assert.equal(only(model({ activity: a })).headAction, null);
});

test('one file reads by its percent', () => {
  const run = it('running', { bytesTotal: 8 * MB, sentBytes: 3.36 * MB, fraction: 0.42, rateBps: (4.64 * MB) / 180, etaText: 'about 3 min' });
  const a = act([batch()], [run]);
  const s = only(model({ activity: a }));
  assert.equal(s.title, 'Uploading 1 file to Halcyon');
  assert.deepEqual(s.line, [{ b: '42%' }, ' · 3.4 of 8 MB', ' · about 3 min left']);
  assert.deepEqual(s.chip.parts, ['Uploading · ', { b: '42%' }, ' · about 3 min']);
  assert.equal(s.opens, false);
  const p = act([batch({ paused: true })], [{ ...run, state: 'waiting', paused: true, fraction: 0, sentBytes: 0 }]);
  const sp = only(model({ activity: p }));
  assert.deepEqual(sp.line, ['Paused']);
  assert.deepEqual(sp.chip.parts, ['Paused']);
});

test('one file, no board name; finished ok; failed', () => {
  const ok = only(model({ activity: act([batch({ boardName: null })], [it('done', { doneAt: T0 + 2000 })]) }));
  assert.equal(ok.title, 'Uploaded');
  assert.deepEqual(ok.chip.parts, ['Uploaded']);
  assert.equal(ok.chip.icon, 'check');
  assert.equal(ok.chip.tone, 'quiet');
  assert.equal(ok.close, 'dismiss');
  assert.equal(ok.pct, 100);
  const bad = only(model({ activity: act([batch()], [it('failed')]) }));
  assert.equal(bad.title, 'Didn’t upload to Halcyon');
  assert.deepEqual(bad.line, [{ b: '1 file' }, ' didn’t upload']);
  assert.deepEqual(bad.chip.parts, ['Didn’t upload']);
  assert.equal(bad.chip.icon, 'warning');
  assert.equal(bad.chip.tone, 'err');
  assert.equal(bad.opens, true);
  assert.equal(only(model({ activity: act([batch()], [it('running'), it('running')]) })).title, 'Uploading 2 files to Halcyon');
});

test('finished: all done, with problems, and every one failed', () => {
  const done = only(model({ activity: act([batch()], many(12, 'done', { bytesTotal: MB, doneAt: T0 + 3000 })) }));
  assert.equal(done.title, 'Uploaded to Halcyon');
  assert.deepEqual(done.line, [{ b: '12 of 12' }, ' uploaded']);
  assert.deepEqual(done.chip.parts, ['Uploaded · ', { b: '12 of 12' }]);
  assert.equal(done.chip.tone, 'quiet');
  const prob = only(model({ activity: act([batch()], [...many(11, 'done', { doneAt: T0 + 3000 }), it('failed')]) }));
  assert.equal(prob.title, 'Uploaded to Halcyon');
  assert.deepEqual(prob.line, [{ b: '11 of 12' }, ' uploaded', ' · 1 didn’t upload']);
  assert.deepEqual(prob.chip.parts, [{ b: '11 of 12' }, ' uploaded · 1 didn’t upload']);
  assert.equal(prob.chip.icon, 'warning');
  assert.equal(prob.chip.tone, 'err');
  assert.equal(prob.close, 'dismiss');
  assert.equal(prob.pct, 100);
  const allBad = only(model({ activity: act([batch({ boardName: null })], many(3, 'failed')) }));
  assert.equal(allBad.title, 'Didn’t upload');
  assert.deepEqual(allBad.line, [{ b: '3 files' }, ' didn’t upload']);
  assert.deepEqual(allBad.chip.parts, [{ b: '3 files' }, ' didn’t upload']);
  assert.equal(allBad.chip.icon, 'warning');
  assert.equal(allBad.chip.tone, 'err');
});

test('the 1 s rule: a batch done in 600 ms never shows; one still running at 1.2 s does', () => {
  const quick = act([batch()], many(2, 'done', { doneAt: T0 + 600 }));
  const m = model({ activity: quick, now: T0 + 5000 });
  assert.deepEqual(m.sections, []);
  assert.equal(m.chip, null);
  assert.equal(m.wakeAt, null);
  const running = act([batch()], many(2, 'running'));
  const early = model({ activity: running, now: T0 + 600 });
  assert.deepEqual(early.sections, []);
  assert.equal(early.wakeAt, T0 + SHOW_AFTER_MS);
  const later = model({ activity: running, now: T0 + 1200 });
  assert.equal(later.sections.length, 1);
  assert.equal(later.wakeAt, null);
  // Done after 1 s (but longer than the show delay) still shows.
  const slow = act([batch()], many(2, 'done', { doneAt: T0 + 1500 }));
  assert.equal(model({ activity: slow, now: T0 + 2000 }).sections.length, 1);
  // A failure shows at once.
  assert.equal(model({ activity: act([batch()], [it('failed')]), now: T0 + 100 }).sections.length, 1);
});

test('dismissed batches show only while something moves', () => {
  const a = act([batch({ dismissed: true })], [it('failed', { cardId: 'c', actions: { retry() {} } })]);
  assert.deepEqual(model({ activity: a }).sections, []);
  const b = act([batch({ dismissed: true })], [it('failed'), it('running')]);
  assert.equal(model({ activity: b }).sections.length, 1);
});

test('hidden batches and parked items do not count; newest batch first', () => {
  const a = act(
    [batch({ id: 'b1', boardName: 'One' }), batch({ id: 'b2', boardName: 'Two', createdAt: T0 + 10 }), batch({ id: 'b3', hidden: true })],
    [it('running', { batch: 'b1' }), it('running', { batch: 'b2' }), it('waiting', { batch: 'b2', parked: true }), it('running', { batch: 'b3' })],
  );
  const m = model({ activity: a });
  assert.deepEqual(m.sections.map((s) => s.key), ['batch:b2', 'batch:b1']);
  assert.equal(m.sections[0].counts.total, 1);
  assert.deepEqual(m.sections.map((s) => s.title), ['Uploading 1 file to Two', 'Uploading 1 file to One']);
});

test('a failed new version offers Retry and Dismiss, not Remove', () => {
  const fail = it('failed', { cardId: 'c1', version: { n: 3 }, actions: { retry() {}, remove() {} } });
  const [f] = only(model({ activity: act([batch()], [fail]) })).rows;
  assert.equal(f.retry, true);
  assert.deepEqual(f.button, { id: 'remove', label: 'Dismiss' });
});

test('rows: order, words and buttons', () => {
  const run = it('running', { fraction: 0.42, bytesTotal: 10 * MB, etaText: 'about 3 min', cardId: 'c1', boardId: 'x', thumb: 'blob:t', mime: 'image/png', cancellable: true, abortable: true });
  const run2 = it('running', { fraction: 0.18, bytesTotal: 10 * MB, cardId: 'c2', boardId: 'x', cancellable: true });
  const fin = it('finishing', { fraction: 1 });
  const wait = it('waiting', { cardId: 'c3', boardId: 'x', cancellable: true });
  const waitNoCancel = it('waiting', { boardId: 'other' });
  const fail = it('failed', { retryOnline: true, actions: { retry() {}, remove() {} } });
  const fail2 = it('failed', { error: 'Over your storage' });
  const fail3 = it('failed', { error: 'Didn’t upload' });
  const dn = it('done', { label: 'ok.jpg', doneAt: T0 + 3000 });
  const a = act([batch()], [dn, fail, wait, fin, run, waitNoCancel, run2, fail2, fail3]);
  const off = setCardCanceller('x', () => {});
  const rows = only(model({ activity: a })).rows;
  assert.deepEqual(rows.map((r) => r.state), ['now', 'now', 'busy', 'later', 'later', 'fail', 'fail', 'fail', 'done-fold']);
  const [r1, r2, r3, r4, r5, f1, f2, f3, fold] = rows;
  assert.equal(r1.tid, run.id);
  assert.equal(r1.c, '42% · about 3 min');
  assert.equal(r1.pct, 42);
  assert.equal(r1.thumb, 'blob:t');
  assert.equal(r1.mime, 'image/png');
  assert.equal(r1.name, run.label);
  assert.deepEqual(r1.button, { id: 'cancel', label: 'Cancel this upload' });
  assert.equal(r2.c, '18%');
  assert.equal(r2.button, null, 'running, but its upload does not abort with the card');
  assert.equal(r3.c, 'Making a preview…');
  assert.equal(r3.button, null);
  assert.equal(r4.c, 'Waiting');
  assert.deepEqual(r4.button, { id: 'cancel', label: 'Remove this file' });
  assert.equal(r5.button, null, 'no canceller for that board');
  assert.equal(f1.why, 'Didn’t upload · connection dropped');
  assert.equal(f1.retry, true);
  assert.deepEqual(f1.button, { id: 'remove', label: 'Remove this file' });
  assert.equal(f2.why, 'Over your storage');
  assert.equal(f2.retry, false);
  assert.deepEqual(f2.button, { id: 'dismiss-row', label: 'Dismiss' });
  assert.equal(f3.why, 'Didn’t upload');
  assert.equal(fold.c, '1 uploaded');
  assert.deepEqual(fold.done, [{ key: dn.id, name: 'ok.jpg' }]);
  off();
});

test('row caps: 50 moving rows, then one "more waiting"; failed and done lists cap at 50', () => {
  const items = [...many(170, 'waiting'), ...many(60, 'failed'), ...many(80, 'done', { doneAt: T0 + 3000 })];
  const rows = only(model({ activity: act([batch()], items) })).rows;
  assert.equal(rows.filter((r) => r.state === 'later').length, 50);
  const more = rows.find((r) => r.state === 'more');
  assert.equal(more.c, '120 more waiting');
  assert.equal(rows.filter((r) => r.state === 'fail').length, 50);
  const fold = rows.at(-1);
  assert.equal(fold.state, 'done-fold');
  assert.equal(fold.c, '80 uploaded');
  assert.equal(fold.done.length, 51);
  assert.deepEqual(fold.done.at(-1), { key: 'more-done', name: '30 more' });
  const moreFailed = rows.filter((r) => r.state === 'more')[1];
  assert.equal(moreFailed.c, '10 more didn’t upload');
  assert.deepEqual(rows.map((r) => r.state).filter((s, i, a) => s !== a[i - 1]), ['later', 'more', 'fail', 'more', 'done-fold']);
});

test('connection: offline hides batch sections and counts retryOnline failures as paused', () => {
  const a = act([batch()], [
    it('running', { fraction: 0.42 }), it('waiting'),
    it('failed', { retryOnline: true }), it('failed', { error: 'Over your storage' }), it('done', { doneAt: T0 + 3000 }),
  ]);
  const m = model({ activity: a, conn: conn({ state: 'offline' }), offlineForMs: 2000 });
  const s = only(m);
  assert.equal(s.kind, 'conn');
  assert.equal(s.title, 'Offline');
  assert.equal(s.icon, 'offline');
  assert.deepEqual(s.line, ['3 uploads paused, they’ll continue when you’re back']);
  assert.equal(s.meta, 'Changes are kept on this device');
  assert.deepEqual(s.rows.map((r) => [r.state, r.c, r.pct]), [
    ['later', 'Paused at 42%', 42], ['later', 'Waiting', null], ['later', 'Waiting', null], ['fail', null, null],
  ]);
  assert.ok(s.rows.every((r) => r.button == null || r.state === 'fail'));
  assert.deepEqual(s.chip.parts, ['Offline · 3 paused']);
  assert.equal(s.chip.chevron, true);
  assert.equal(s.opens, true);
  assert.equal(s.chipOnly, false);
  assert.equal(m.lead, s);
  assert.equal(m.chip, s.chip);
});

test('connection: offline words with one paused, none, and a tab that keeps nothing', () => {
  const one = only(model({ activity: act([batch()], [it('running'), it('done', { doneAt: T0 + 3000 })]), conn: conn({ state: 'offline' }), offlineForMs: 5000 }));
  assert.deepEqual(one.line, ['1 upload paused, it’ll continue when you’re back']);
  const none = only(model({ conn: conn({ state: 'offline' }), offlineForMs: 5000 }));
  assert.deepEqual(none.line, ['Changes you make are kept on this device']);
  assert.equal(none.meta, null);
  assert.deepEqual(none.chip.parts, ['Offline']);
  const notKept = only(model({ conn: conn({ state: 'offline', kept: false }), offlineForMs: 5000 }));
  assert.deepEqual(notKept.line, ['Keep this tab open until you’re back online']);
  const notKeptPaused = only(model({ activity: act([batch()], [it('running')]), conn: conn({ state: 'offline', kept: false }), offlineForMs: 5000 }));
  assert.equal(notKeptPaused.meta, 'Keep this tab open until you’re back online');
  const noConn = only(model({ activity: act([batch()], [it('running')]), offlineForMs: 5000 }));
  assert.deepEqual(noConn.line, ['1 upload paused, it’ll continue when you’re back']);
  assert.equal(noConn.meta, null);
  // Offline, no cluster and nothing to say: nothing shows.
  assert.deepEqual(model({ offlineForMs: 5000 }).sections, []);
});

test('connection: offline for under 2 s shows nothing, and wakes at 2 s', () => {
  const m = model({ conn: conn({ state: 'offline' }), offlineForMs: 500 });
  assert.deepEqual(m.sections, []);
  assert.equal(m.wakeAt, NOW + 1500);
  assert.equal(model({ conn: conn(), offlineForMs: null }).wakeAt, null);
  const both = model({ activity: act([batch({ createdAt: NOW - 400 })], many(2, 'running')), offlineForMs: 500, conn: conn({ state: 'offline' }) });
  assert.equal(both.wakeAt, NOW + 600, 'the earliest');
});

test('connection: error, with and without Retry and a kept draft', () => {
  const s = only(model({ conn: conn({ state: 'error' }), canRetryConnection: true }));
  assert.equal(s.title, 'Couldn’t save');
  assert.equal(s.icon, 'warning');
  assert.equal(s.tone, 'err');
  assert.deepEqual(s.line, ['Your changes are kept on this device and will save when the connection is back']);
  assert.deepEqual(s.headAction, { id: 'retry-conn', label: 'Retry' });
  assert.deepEqual(s.chip.parts, ['Couldn’t save']);
  assert.equal(s.chip.tone, 'err');
  assert.deepEqual(s.chip.action, { id: 'retry-conn', label: 'Retry' });
  assert.equal(s.chip.chevron, true);
  assert.equal(s.opens, true);
  const n = only(model({ conn: conn({ state: 'error', kept: false }) }));
  assert.deepEqual(n.line, ['Your latest changes aren’t saved yet. Keep this tab open.']);
  assert.equal(n.headAction, null);
  assert.equal(n.chip.action, null);
});

test('connection: reconnecting only with everLive; a chip, no panel', () => {
  const s = only(model({ conn: conn({ state: 'reconnecting', everLive: true }) }));
  assert.equal(s.title, 'Reconnecting…');
  assert.equal(s.icon, 'reconnecting');
  assert.equal(s.line, null);
  assert.deepEqual(s.chip.parts, ['Reconnecting…']);
  assert.equal(s.chip.chevron, false);
  assert.equal(s.opens, false);
  assert.equal(s.chipOnly, true);
  assert.deepEqual(model({ conn: conn({ state: 'reconnecting', everLive: false }) }).sections, []);
});

test('connection: saved is a quiet chip, left out beside any other section', () => {
  const m = model({ conn: conn({ state: 'saved' }) });
  const s = only(m);
  assert.deepEqual(s.chip.parts, ['Saved']);
  assert.equal(s.chip.icon, 'check');
  assert.equal(s.chip.tone, 'quiet');
  assert.equal(s.chip.chevron, false);
  assert.equal(s.opens, false);
  assert.equal(s.chipOnly, true);
  assert.equal(m.lead, s);
  const beside = model({ conn: conn({ state: 'saved' }), activity: twelve() });
  assert.deepEqual(beside.sections.map((x) => x.kind), ['batch']);
  const withHeld = model({ conn: conn({ state: 'saved' }), held: { entries: [{ id: 'h', via: 'drop', count: 1, ready: false }], awaiting: false } });
  assert.deepEqual(withHeld.sections.map((x) => x.kind), ['held']);
  assert.equal(model({ conn: conn() }).sections.length, 0);
});

test('held: waiting for room, waiting for payment, ready; imports left out', () => {
  const e = (o) => ({ id: 'h', via: 'drop', count: 1, ready: false, ...o });
  const wait = only(model({ held: { entries: [e({ count: 2 }), e({ count: 1 })], awaiting: false } }));
  assert.equal(wait.kind, 'held');
  assert.equal(wait.key, 'held');
  assert.equal(wait.title, 'Waiting for room');
  assert.equal(wait.count, 3);
  assert.deepEqual(wait.chip.parts, ['Waiting for room · ', { b: '3 files' }]);
  assert.equal(wait.chip.icon, 'clock');
  assert.equal(wait.chip.chevron, true);
  assert.equal(wait.opens, true);
  assert.equal(wait.chip.label, 'Waiting for room · 3 files. Open');
  const pay = only(model({ held: { entries: [e()], awaiting: true } }));
  assert.deepEqual(pay.chip.parts, ['Waiting for payment · ', { b: '1 file' }]);
  const ready = only(model({ held: { entries: [e({ ready: true })], awaiting: true } }));
  assert.deepEqual(ready.chip.parts, ['Ready to upload · ', { b: '1 file' }]);
  assert.equal(ready.chip.icon, 'check');
  assert.equal(ready.title, 'Ready to upload');
  assert.deepEqual(model({ held: { entries: [e({ via: 'import' })], awaiting: false } }).sections, []);
});

test('import: chip from the lead, the guide alone, and its own label', () => {
  const lead = { key: 'j1', phase: 'running', chip: { kind: 'ring', pct: 42, text: '42%', label: 'Importing Halcyon: 42%. Open the import' } };
  const s = only(model({ importLead: lead }));
  assert.equal(s.kind, 'import');
  assert.equal(s.key, 'import:j1');
  assert.deepEqual(s.chip.parts, ['Import · ', { b: '42%' }]);
  assert.equal(s.chip.icon, 'ring');
  assert.equal(s.chip.pct, 42);
  assert.equal(s.chip.label, 'Importing Halcyon: 42%. Open the import');
  assert.equal(s.chip.chevron, true);
  assert.equal(s.opens, true);
  const spin = only(model({ importLead: { ...lead, chip: { ...lead.chip, pct: null } } }));
  assert.equal(spin.chip.pct, null);
  const glyph = only(model({ importLead: { key: 'j2', phase: 'paused', chip: { kind: 'glyph', icon: 'pause', text: 'Paused', label: 'L' } } }));
  assert.equal(glyph.chip.icon, 'pause');
  assert.equal(glyph.chip.pct, null);
  const guide = only(model({ guideOpen: true }));
  assert.equal(guide.key, 'guide');
  assert.deepEqual(guide.chip.parts, ['Import']);
  assert.equal(guide.opens, true);
});

test('order: conn, batches newest first, held, import', () => {
  const a = act([batch({ id: 'b1' }), batch({ id: 'b2', createdAt: T0 + 5 })], [it('running', { batch: 'b1' }), it('running', { batch: 'b2' })]);
  const m = model({
    activity: a, conn: conn({ state: 'error' }),
    held: { entries: [{ id: 'h', via: 'drop', count: 1, ready: false }], awaiting: false },
    importLead: { key: 'j', phase: 'running', chip: { kind: 'ring', pct: 1, text: '1%', label: 'x' } },
  });
  assert.deepEqual(m.sections.map((s) => s.key), ['conn', 'batch:b2', 'batch:b1', 'held', 'import:j']);
});

test('lead: error, offline, failures, active batch, import, held, finished batch, reconnecting, saved', () => {
  const running = act([batch({ id: 'b1' })], [it('running', { batch: 'b1' })]);
  const failing = act([batch({ id: 'b9', createdAt: T0 - 5 })], [it('failed', { batch: 'b9' })]);
  const finished = act([batch({ id: 'b2' })], many(2, 'done', { batch: 'b2', doneAt: T0 + 3000 }));
  const held = { entries: [{ id: 'h', via: 'drop', count: 1, ready: false }], awaiting: false };
  const imp = { key: 'j', phase: 'running', chip: { kind: 'ring', pct: 1, text: '1%', label: 'x' } };
  const merged = (...as) => act(as.flatMap((x) => x.batches), as.flatMap((x) => x.items));

  assert.equal(model({ activity: running, conn: conn({ state: 'error' }), importLead: imp }).lead.key, 'conn');
  assert.equal(model({ activity: running, conn: conn({ state: 'offline' }), offlineForMs: 9000 }).lead.conn, 'offline');
  assert.equal(model({ activity: merged(running, failing), importLead: imp }).lead.key, 'batch:b9');
  assert.equal(model({ activity: merged(running, finished), importLead: imp, held }).lead.key, 'batch:b1');
  assert.equal(model({ activity: finished, importLead: imp, held }).lead.key, 'import:j');
  assert.equal(model({ activity: finished, held }).lead.key, 'held');
  assert.equal(model({ activity: finished }).lead.key, 'batch:b2');
  assert.equal(model({ conn: conn({ state: 'reconnecting' }) }).lead.conn, 'reconnecting');
  assert.equal(model({ conn: conn({ state: 'saved' }) }).lead.conn, 'saved');
  assert.equal(model({ conn: conn() }).lead, null);
  assert.equal(model({}).chip, null);
  // The newest active batch leads.
  const two = act([batch({ id: 'b1' }), batch({ id: 'b2', createdAt: T0 + 5 })], [it('running', { batch: 'b1' }), it('running', { batch: 'b2' })]);
  assert.equal(model({ activity: two }).lead.key, 'batch:b2');
});

test('the lead’s chip is the model chip; every chip has a label', () => {
  const m = model({ activity: twelve(), held: { entries: [{ id: 'h', via: 'drop', count: 1, ready: false }], awaiting: false } });
  assert.equal(m.chip, m.lead.chip);
  for (const s of m.sections) assert.equal(typeof s.chip.label, 'string');
  const noChev = only(model({ conn: conn({ state: 'saved' }) }));
  assert.equal(noChev.chip.label, 'Saved');
});

// ── downloads, exports and copies ──────────────────────────────────────────
const opBatch = (kind, o = {}) => batch({ id: 'o1', kind, ...o });
const opItem = (kind, o = {}) => it('running', { batch: 'o1', kind, label: 'Halcyon.zip', cancel: () => {}, ...o });

test('a zip: title, meter, Cancel, opens the tray, chip with the percent', () => {
  const run = () => {};
  const m = model({ activity: act([opBatch('download')], [opItem('download', { count: { done: 34, total: 120 }, fraction: 0.28, cancel: run })]) });
  const s = only(m);
  assert.equal(s.kind, 'op');
  assert.equal(s.key, 'op:o1');
  assert.equal(s.opKind, 'download');
  assert.equal(s.title, 'Preparing download · 34 of 120 files');
  assert.equal(s.opens, true);
  assert.equal(s.chipOnly, false);
  assert.equal(s.icon, 'download');
  assert.equal(s.pct, 28);
  assert.equal(s.active, true);
  assert.equal(s.close, 'fold');
  assert.equal(s.headAction.label, 'Cancel');
  assert.equal(s.headAction.aria, 'Cancel download of Halcyon.zip');
  assert.equal(s.headAction.run, run);
  assert.equal(s.open, null);
  assert.equal(text(s.chip.parts), 'Preparing download · 34 of 120 files · 28%');
  assert.equal(m.lead, s);
});

test('a zip with no cancel has no Cancel; a count with no fraction gives the pct', () => {
  const s = only(model({ activity: act([opBatch('download')], [opItem('download', { count: { done: 30, total: 120 }, cancel: null })]) }));
  assert.equal(s.headAction, null);
  assert.equal(s.pct, 25);
});

test('a single download and an export are chip-only; no pct, no meter', () => {
  const d = only(model({ activity: act([opBatch('download')], [opItem('download', { label: 'Reel.mov' })]) }));
  assert.equal(d.title, 'Preparing Reel.mov…');
  assert.equal(d.opens, false);
  assert.equal(d.chipOnly, true);
  assert.equal(d.pct, null);
  assert.equal(d.chip.chevron, false);
  const e = only(model({ activity: act([opBatch('export')], [opItem('export', { label: 'Exporting Treatment_v3 as PDF…', cancel: null })]) }));
  assert.equal(e.title, 'Exporting Treatment_v3 as PDF…');
  assert.equal(e.icon, 'export');
  assert.equal(e.chipOnly, true);
  assert.equal(e.headAction, null);
  assert.equal(text(e.chip.parts), 'Exporting Treatment_v3 as PDF…');
});

test('a copy opens the tray and shows at once; done reads Copied with Open and a dismiss', () => {
  const open = () => {};
  const b = opBatch('copy', { showAfterMs: 0, createdAt: NOW - 10 });
  const running = only(model({ activity: act([b], [opItem('copy', { label: 'Copying 24 cards…', fraction: 0.55, cancel: null })]) }));
  assert.equal(running.opens, true);
  assert.equal(running.icon, 'copy');
  assert.equal(running.pct, 55);
  assert.equal(text(running.chip.parts), 'Copying 24 cards… · 55%');
  const m = model({ activity: act([{ ...b, createdAt: NOW - 1 }], [opItem('copy', { state: 'done', doneLabel: 'Copied', doneAt: NOW, actions: { open } })]) });
  const done = only(m);
  assert.equal(done.title, 'Copied');
  assert.equal(done.icon, 'check');
  assert.equal(done.tone, 'quiet');
  assert.equal(done.finished, true);
  assert.equal(done.close, 'dismiss');
  assert.equal(done.headAction, null);
  assert.equal(done.open.label, 'Open');
  assert.equal(done.open.run, open);
  assert.equal(done.open.aria, 'Open the copy');
  assert.equal(text(done.chip.parts), 'Copied');
});

test('the beat: a download inside showAfterMs stays out and wakes; one done inside it never shows', () => {
  const b = opBatch('download', { createdAt: NOW - 400 });
  const m = model({ activity: act([b], [opItem('download', { label: 'Reel.mov' })]) });
  assert.equal(m.sections.length, 0);
  assert.equal(m.wakeAt, NOW - 400 + SHOW_AFTER_MS);
  const quick = model({ activity: act([b], [opItem('download', { state: 'done', doneLabel: 'Downloaded Reel.mov', doneAt: NOW - 200 })]) });
  assert.equal(quick.sections.length, 0);
  const slow = model({ activity: act([{ ...b, createdAt: NOW - 3000 }], [opItem('download', { state: 'done', doneLabel: 'Downloaded Reel.mov', doneAt: NOW - 100 })]) });
  assert.equal(only(slow).title, 'Downloaded Reel.mov');
  const custom = model({ activity: act([{ ...b, showAfterMs: 200 }], [opItem('download', { label: 'Reel.mov' })]) });
  assert.equal(custom.sections.length, 1);
});

test('a dismissed finished op is gone; hidden batches and parked items are left out', () => {
  const done = opItem('copy', { state: 'done', doneLabel: 'Copied', doneAt: NOW });
  assert.equal(model({ activity: act([opBatch('copy', { showAfterMs: 0, dismissed: true })], [done]) }).sections.length, 0);
  assert.equal(model({ activity: act([opBatch('copy', { showAfterMs: 0, hidden: true })], [done]) }).sections.length, 0);
  assert.equal(model({ activity: act([opBatch('copy', { showAfterMs: 0 })], [{ ...done, parked: true }]) }).sections.length, 0);
});

test('lead: an active op beats the import, held and a finished batch; a finished op follows a batch', () => {
  const up = batch({ id: 'b1' });
  const doneUp = [it('done', { batch: 'b1', doneAt: T0 + 5000, bytesTotal: 1, fraction: 1 })];
  const op = (state, extra) => opItem('download', { count: { done: 1, total: 5 }, state, ...extra });
  const importLead = { key: 'j1', phase: 'job', chip: { kind: 'ring', pct: 10, text: '10%', label: 'Import 10%' } };
  const run = model({ activity: act([up, opBatch('download', { createdAt: T0 })], [...doneUp, op('running')]), importLead });
  assert.equal(run.lead.kind, 'op');
  const fin = model({
    activity: act([up, opBatch('download', { createdAt: T0 })], [...doneUp, op('done', { doneLabel: 'Downloaded Halcyon.zip', doneAt: T0 + 3000 })]),
  });
  assert.equal(fin.lead.kind, 'batch');
  const finOnly = model({
    activity: act([opBatch('download', { createdAt: T0 })], [op('done', { doneLabel: 'Downloaded Halcyon.zip', doneAt: T0 + 3000 })]),
    conn: conn({ state: 'saved' }),
  });
  assert.equal(finOnly.lead.kind, 'op');
  const activeBatch = model({
    activity: act([opBatch('download', { createdAt: T0 }), up], [op('running'), it('running', { batch: 'b1', bytesTotal: 10, sentBytes: 1 })]),
  });
  assert.equal(activeBatch.lead.kind, 'op', 'what the person just asked for leads');
  assert.equal(activeBatch.sections.map((s) => s.kind).join(), 'batch,op');
});

test('lead: an active op leads over an active and a failed batch; offline and a conn error still lead over it', () => {
  const op = opItem('export', { state: 'running' });
  const opB = opBatch('export', { createdAt: T0 });
  const running = act([batch({ id: 'b1' }), opB], [it('running', { batch: 'b1' }), op]);
  const failing = act([batch({ id: 'b1' }), opB], [it('failed', { batch: 'b1' }), op]);
  assert.equal(model({ activity: running }).lead.kind, 'op');
  assert.equal(model({ activity: failing }).lead.kind, 'op');
  assert.equal(model({ activity: running, conn: conn({ state: 'error' }) }).lead.key, 'conn');
  assert.equal(model({ activity: running, conn: conn({ state: 'offline' }), offlineForMs: 9000 }).lead.conn, 'offline');
});

test('chip: a chip-only op that leads opens the tray when another panel would draw, not alone', () => {
  const op = opItem('export', { state: 'running' });
  const opB = opBatch('export', { createdAt: T0 });
  const alone = model({ activity: act([opB], [op]) });
  assert.equal(alone.chip.chevron, false);
  assert.ok(!alone.chip.label.endsWith('. Open'));
  const withUpload = model({ activity: act([batch({ id: 'b1' }), opB], [it('running', { batch: 'b1' }), op]) });
  assert.equal(withUpload.lead.kind, 'op');
  assert.equal(withUpload.chip.chevron, true);
  assert.ok(withUpload.chip.label.endsWith('. Open'), withUpload.chip.label);
  // Another chip-only section draws no panel: still no chevron.
  const withSaved = model({ activity: act([opB], [op]), conn: conn({ state: 'saved' }) });
  assert.equal(withSaved.chip.chevron, false);
});

test('announce: a zip download says one constant line while its files count up', () => {
  const at = (done) => only(model({
    activity: act([opBatch('download', { createdAt: T0 })], [opItem('download', { count: { done, total: 120 }, state: 'running' })]),
  })).announce;
  assert.equal(at(1), 'Preparing download of 120 files');
  assert.equal(at(1), at(77));
  const one = only(model({ activity: act([opBatch('download', { createdAt: T0 })], [opItem('download', { label: 'Reel.mov', count: { done: 0, total: 1 }, state: 'running' })]) }));
  assert.equal(one.announce, one.title);
});
