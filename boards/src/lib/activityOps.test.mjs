// activityOps.test.mjs — trackOp: a download, export or copy as one tray row.
//
//   node --test src/lib/activityOps.test.mjs
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { activitySnapshot, noteTrayMounted, DONE_LINGER_MS, __resetActivityForTests, __setActivityClock } from './activity.js';
import { trackOp, opsHaveTray } from './activityOps.js';
import { trayModel, SHOW_AFTER_MS } from './activityTray.js';

let t = 0;
const advance = (ms) => { t += ms; mock.timers.tick(ms); };
let unmount = null;

beforeEach(() => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t = 1_000_000;
  __resetActivityForTests();
  __setActivityClock(() => t);
  unmount = noteTrayMounted();
});
afterEach(() => {
  unmount?.();
  __resetActivityForTests();
  mock.timers.reset();
});

const snap = () => activitySnapshot();
const row = () => snap().items[0];
const shown = () => trayModel({ activity: snap(), held: { entries: [] }, now: t }).sections;

test('a running op is one batch with one running item, and shows after the beat', async () => {
  let release;
  const p = trackOp({ kind: 'download', label: 'Halcyon.zip', total: 120, doneLabel: 'Downloaded Halcyon.zip' }, () => new Promise((r) => { release = r; }));
  assert.equal(snap().batches.length, 1);
  assert.equal(snap().batches[0].kind, 'download');
  assert.equal(row().state, 'running');
  assert.deepEqual(row().count, { done: 0, total: 120 });
  assert.equal(shown().length, 0, 'inside the beat');
  advance(SHOW_AFTER_MS);
  assert.equal(shown().length, 1);
  release('x');
  assert.equal(await p, 'x');
});

test('progress: count, fraction (derived from done/total, clamped under 1), label', async () => {
  let progress;
  let release;
  const p = trackOp({ kind: 'copy', label: 'Copying…' }, (ctx) => { progress = ctx.progress; return new Promise((r) => { release = r; }); });
  progress({ done: 34, total: 120 });
  assert.deepEqual(row().count, { done: 34, total: 120 });
  assert.equal(Math.round(row().fraction * 100), 28);
  progress({ done: 35 });
  assert.deepEqual(row().count, { done: 35, total: 120 });
  progress({ fraction: 1 });
  assert.equal(row().state, 'running', 'never flips to finishing');
  progress({ label: 'Copying 24 cards…' });
  assert.equal(row().label, 'Copying 24 cards…');
  release();
  await p;
});

test('done: the row says doneLabel (string or function of the result), Open, then lingers and leaves', async () => {
  const open = () => {};
  await trackOp({ kind: 'copy', label: 'Copying…', doneLabel: (r) => `Copied ${r}`, open, lingerMs: 8000 }, async () => 'it');
  assert.equal(row().state, 'done');
  assert.equal(row().doneLabel, 'Copied it');
  assert.equal(row().actions.open, open);
  assert.equal(snap().batches[0].lingerMs, 8000);
  const s = shown();
  assert.equal(s.length, 1, 'a copy shows at once, even when done at once');
  assert.equal(s[0].open.run, open);
  advance(DONE_LINGER_MS);
  assert.equal(snap().batches.length, 1);
  advance(8000 - DONE_LINGER_MS);
  assert.equal(snap().batches.length, 0);
});

test('a download done inside the beat leaves quietly and never shows; the default linger applies', async () => {
  await trackOp({ kind: 'download', label: 'a.zip', doneLabel: 'Downloaded a.zip' }, async () => {});
  assert.equal(shown().length, 0);
  advance(DONE_LINGER_MS);
  assert.equal(snap().batches.length, 0);
});

test('doneLabel null removes the row (an export that ends in a print dialog)', async () => {
  await trackOp({ kind: 'export', label: 'Exporting X as PDF…', doneLabel: null }, async () => {});
  assert.equal(snap().items.length, 0);
  assert.equal(snap().batches.length, 0);
});

test('Cancel aborts the signal, removes the row at once, and swallows the abort', async () => {
  let signal;
  const p = trackOp({ kind: 'download', label: 'a.zip', cancellable: true }, (ctx) => {
    signal = ctx.signal;
    return new Promise((_, rej) => ctx.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  });
  assert.equal(typeof row().cancel, 'function');
  row().cancel();
  assert.equal(signal.aborted, true);
  assert.equal(snap().items.length, 0);
  assert.equal(await p, undefined);
  assert.equal(snap().batches.length, 0);
});

test('not cancellable: the item has no cancel', async () => {
  let release;
  const p = trackOp({ kind: 'export', label: 'x' }, () => new Promise((r) => { release = r; }));
  assert.equal(row().cancel, null);
  release();
  await p;
});

test('a failure removes the row and rethrows the caller’s own error', async () => {
  const boom = Object.assign(new Error('nope'), { code: 'export_failed' });
  await assert.rejects(trackOp({ kind: 'export', label: 'x', doneLabel: 'Exported' }, async () => { throw boom; }), (e) => e === boom);
  assert.equal(snap().items.length, 0);
  assert.equal(snap().batches.length, 0);
});

test('no tray mounted: just runs the work, registers nothing', async () => {
  unmount();
  unmount = null;
  assert.equal(opsHaveTray(), false);
  let got;
  const out = await trackOp({ kind: 'download', label: 'a', cancellable: true }, ({ signal, progress }) => { got = [signal.aborted, typeof progress]; progress({ done: 1, total: 2 }); return 7; });
  assert.equal(out, 7);
  assert.deepEqual(got, [false, 'function']);
  assert.equal(snap().batches.length, 0);
  assert.equal(snap().items.length, 0);
  await assert.rejects(trackOp({ kind: 'copy', label: 'c' }, async () => { throw new Error('x'); }), /x/);
});

test('opsHaveTray follows the tray', () => {
  assert.equal(opsHaveTray(), true);
  unmount();
  unmount = null;
  assert.equal(opsHaveTray(), false);
});

test('two calls with one key while it runs share one row and one run', async () => {
  let release; let runs = 0;
  const run = () => { runs++; return new Promise((r) => { release = r; }); };
  const a = trackOp({ kind: 'download', label: 'x.zip', key: 'download:1', doneLabel: 'Done' }, run);
  const b = trackOp({ kind: 'download', label: 'x.zip', key: 'download:1', doneLabel: 'Done' }, run);
  assert.equal(snap().items.length, 1);
  assert.equal(runs, 1);
  release('v');
  assert.deepEqual([await a, await b], ['v', 'v']);
});

test('once a keyed run has settled, the same key starts a new row and runs again', async () => {
  let runs = 0;
  const run = async () => { runs++; return runs; };
  assert.equal(await trackOp({ kind: 'download', label: 'x', key: 'k', doneLabel: 'Done' }, run), 1);
  assert.equal(await trackOp({ kind: 'download', label: 'x', key: 'k', doneLabel: 'Done' }, run), 2);
  assert.equal(snap().items.length, 2);
});

test('a rejected keyed run rejects both callers and frees the key', async () => {
  let release; let runs = 0;
  const bad = () => { runs++; return new Promise((_, rej) => { release = rej; }); };
  const a = trackOp({ kind: 'export', label: 'x', key: 'e' }, bad);
  const b = trackOp({ kind: 'export', label: 'x', key: 'e' }, bad);
  release(new Error('nope'));
  await assert.rejects(a, /nope/);
  await assert.rejects(b, /nope/);
  assert.equal(runs, 1);
  assert.equal(await trackOp({ kind: 'export', label: 'x', key: 'e' }, async () => 'ok'), 'ok');
});

test('the version upload batch carries the cluster name (CanvasSurface versionEnv)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../components/CanvasSurface.jsx', import.meta.url), 'utf8');
  const env = src.slice(src.indexOf('const versionEnv = () =>'));
  assert.match(env.slice(0, 600), /uploadContext\(\{[^}]*boardId: board\?\.id, boardName: board\?\.name/);
});
