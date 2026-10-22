import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FRAME_BUCKETS, createFrameStats, noteFrame, noteLongTask, snapshotFrameStats, frameStatsSince,
} from './frameStats.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('a frame goes under the first bound it fits, and past the last into gt350', () => {
  const st = createFrameStats();
  for (const gap of [8.3, 16.7, 20, 20.1, 33, 49, 99, 349, 351, 2000]) noteFrame(st, gap);
  assert.deepEqual(frameStatsSince(st, null).frames, { le20: 3, le34: 2, le50: 1, le100: 1, le350: 1, gt350: 2 });
  assert.equal(frameStatsSince(st, null).frame_ms, Math.round(8.3 + 16.7 + 20 + 20.1 + 33 + 49 + 99 + 349 + 351 + 2000));
  assert.deepEqual(FRAME_BUCKETS, [20, 34, 50, 100, 350]);
});

test('nothing that is not a positive number is counted', () => {
  const st = createFrameStats();
  for (const bad of [0, -5, NaN, Infinity, null, undefined, '16']) { noteFrame(st, bad); noteLongTask(st, bad); }
  assert.equal(frameStatsSince(st, null), null, 'nothing happened, nothing to say');
  assert.doesNotThrow(() => { noteFrame(null, 16); noteLongTask(undefined, 60); });
});

test('a session counts only what happened after it began', () => {
  const st = createFrameStats();
  noteFrame(st, 16); noteFrame(st, 400); noteLongTask(st, 120);
  const base = snapshotFrameStats(st);
  noteFrame(st, 16); noteFrame(st, 16); noteFrame(st, 60);
  noteLongTask(st, 80);
  assert.deepEqual(frameStatsSince(st, base), {
    frames: { le20: 2, le34: 0, le50: 0, le100: 1, le350: 0, gt350: 0 }, frame_ms: 92, lt_n: 1, lt_ms: 80,
  });
  assert.equal(frameStatsSince(snapshotFrameStats(st), snapshotFrameStats(st)), null);
  // The snapshot is a copy: later frames don't move it.
  noteFrame(st, 16);
  assert.equal(base.f[0], 1);
});

test('long tasks alone still say something, and a bad base reads as none', () => {
  const st = createFrameStats();
  noteLongTask(st, 300.4);
  assert.deepEqual(frameStatsSince(st, { f: 'nope' }), {
    frames: { le20: 0, le34: 0, le50: 0, le100: 0, le350: 0, gt350: 0 }, frame_ms: 0, lt_n: 1, lt_ms: 300,
  });
  assert.equal(frameStatsSince(null, null), null);
});

test('perfReport feeds it from the sampler it already runs, and the summary folds it in', () => {
  const perf = read('./perfReport.js');
  assert.match(perf, /if \(interactingAtGapStart && gap < FRAME_GAP_DISCARD_MS\) noteFrame\(frameStats, gap\);/);
  assert.match(perf, /for \(const e of list\.getEntries\(\)\) \{\s*noteLongTask\(frameStats, e\.duration\);/);
  assert.match(perf, /export function perfTotals\(\) \{/);
  // No second rAF loop: the only one is the interaction-gated sampler's.
  assert.equal((perf.match(/requestAnimationFrame\(/g) || []).length, 2);
  const analytics = read('./analytics.js');
  assert.match(analytics, /const perf = frameStatsSince\(perfTotals\(\), summaryPerfBase\);/);
  assert.match(analytics, /summaryAcc = createSummary\(next, undefined, currentView\(\)\);\s*summaryPerfBase = perfTotals\(\);/);
});

test('app_open says how long the app took, on a page load\'s first mount only', () => {
  const app = read('../App.jsx');
  assert.match(app, /^let appOpenTimed = false;$/m);
  const open = app.slice(app.indexOf('let bootMs = null;'), app.indexOf('logEvent(EV.APP_OPEN, {'));
  // Not after the app opened in place from the checkout success page
  // (boot:enter): that mount came long after the load.
  assert.match(open, /if \(!appOpenTimed\) \{\s*appOpenTimed = true;\s*if \(bootAt\('enter'\) == null\) \{\s*const t = performance\.now\(\);\s*if \(Number\.isFinite\(t\) && t > 0 && t < 600_000\) bootMs = Math\.round\(t\);/);
  assert.match(app, /landed_cards: Number\.isFinite\(landedCards\) \? landedCards : null, boot_ms: bootMs,/);
});
