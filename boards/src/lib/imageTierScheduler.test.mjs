// imageTierScheduler.js — the paint-wave trigger, the worker pool, 'step'
// climbs and nearest-first promotes. The factory is pure and takes its clock,
// timers and idle callback, so this drives it with fakes (the same harness as
// tests/image-tier-scheduler.spec.js): no page, no DOM, no images.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createImageTierScheduler } from './imageTierScheduler.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

function makeHarness(overrides = {}) {
  const h = { t: 0, timers: [], gesture: false };
  h.advance = async (ms) => {
    const target = h.t + ms;
    let guard = 0;
    while (guard++ < 10000) {
      const due = h.timers.filter((x) => !x.done && x.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      h.t = Math.max(h.t, due.at);
      due.done = true;
      due.fn();
      await flush(3);
    }
    h.t = target;
    await flush(3);
  };
  h.scheduler = createImageTierScheduler({
    now: () => h.t,
    setTimer: (fn, ms) => { const x = { fn, at: h.t + ms, done: false }; h.timers.push(x); return x; },
    clearTimer: (x) => { if (x) x.done = true; },
    requestIdle: (fn) => { fn(); return 0; },
    cancelIdle: () => {},
    isGestureActive: () => h.gesture,
    ...overrides,
  });
  return h;
}

// A card whose run() resolves when the test says so.
function deferredCard({ kind = 'promote', dist = 0, area = 100, result = true } = {}) {
  const c = { evals: 0, started: 0, finished: 0, pending: [], kind, dist, area, result };
  c.handle = {
    evaluate: () => {
      c.evals += 1;
      if (!c.kind) return null;
      return {
        kind: c.kind, dist: c.dist, area: c.area, inViewport: true,
        run: () => new Promise((resolve) => {
          c.started += 1;
          c.pending.push(() => { c.finished += 1; resolve(c.result); });
        }),
      };
    },
  };
  c.finish = () => { const f = c.pending.shift(); if (f) f(); };
  return c;
}

function instantCard({ kind = 'promote', dist, area = 100, result = true, order = null, name = '' } = {}) {
  const c = { evals: 0, runs: 0, kind, dist, area, result };
  c.handle = {
    evaluate: () => {
      c.evals += 1;
      if (!c.kind) return null;
      return {
        kind: c.kind, dist: c.dist, area: c.area, inViewport: true,
        run: async () => { c.runs += 1; if (order) order.push(name); return typeof c.result === 'function' ? c.result() : c.result; },
      };
    },
  };
  return c;
}

test('a paint wave climbs after 300 ms of quiet', async () => {
  const h = makeHarness();
  const card = instantCard();
  h.scheduler.register('c', card.handle);
  h.scheduler.notePaint(0.5);
  await h.advance(299);
  assert.equal(card.runs, 0);
  await h.advance(1);
  assert.equal(card.runs, 1);
});

test('each paint re-arms the quiet timer', async () => {
  const h = makeHarness();
  const card = instantCard();
  h.scheduler.register('c', card.handle);
  h.scheduler.notePaint(0.5);
  await h.advance(200);
  h.scheduler.notePaint(0.5);
  await h.advance(200);
  assert.equal(card.runs, 0, '400 ms in, but only 200 ms since the last paint');
  await h.advance(100);
  assert.equal(card.runs, 1);
});

test('continuous paints still climb 1.5 s after the wave began', async () => {
  const h = makeHarness();
  const card = instantCard();
  h.scheduler.register('c', card.handle);
  for (let t = 0; t < 1500; t += 100) {
    h.scheduler.notePaint(0.5);
    await h.advance(100);
    if (h.t < 1500) assert.equal(card.runs, 0, `still quiet-waiting at ${h.t} ms`);
  }
  assert.equal(card.runs, 1, 'the cap fired at 1500 ms');
});

test('a wave does not move the settle clock: a demote drain still runs', async () => {
  const h = makeHarness({ demoteIdleMs: 1500 });
  const card = instantCard({ kind: 'demote' });
  h.scheduler.register('c', card.handle);
  h.scheduler.onSettle(0.5);                 // settle at t=0
  await h.advance(1000);
  h.scheduler.notePaint(0.5);                // wave at t=1000; fires at 1300
  await h.advance(300);
  assert.equal(card.runs, 0);
  // The wave's demote drain is due at 1300 + 1500 = 2800 and finds the settle
  // 2800 ms old (a wave that moved lastSettleAt would make it 1500 ms old
  // only by then, and a later wave would starve it forever).
  h.scheduler.notePaint(0.5);                // t=1300 — another wave
  await h.advance(300);                      // t=1600: wave fires, demote due at 3100
  await h.advance(1500);
  assert.equal(card.runs, 1);
});

test('the pool keeps at most maxConcurrent in flight and starts the next as one finishes', async () => {
  const h = makeHarness({ maxConcurrent: 2, batchGapMs: 16 });
  const cards = Array.from({ length: 5 }, (_, i) => deferredCard({ dist: i }));
  cards.forEach((c, i) => h.scheduler.register(`c${i}`, c.handle));
  h.scheduler.onSettle(0.5);
  await h.advance(150);
  const inFlight = () => cards.reduce((n, c) => n + c.started - c.finished, 0);
  const started = () => cards.reduce((n, c) => n + c.started, 0);
  assert.equal(started(), 2);
  assert.equal(inFlight(), 2);

  cards[1].finish();                         // the second finishes first
  await flush();
  assert.equal(started(), 2, 'its slot is held one frame after a committed swap');
  await h.advance(16);
  assert.equal(started(), 3, 'the next one starts without waiting for card 0');
  assert.equal(cards[2].started, 1);
  assert.equal(inFlight(), 2);

  cards[0].finish(); cards[2].finish();
  await flush();
  await h.advance(16);
  assert.equal(started(), 5);
  assert.ok(inFlight() <= 2);
  cards[3].finish(); cards[4].finish();
  await h.advance(16);
  assert.equal(inFlight(), 0);
});

test('maxConcurrent may be a function, read when a drain starts', async () => {
  let max = 1;
  const h = makeHarness({ maxConcurrent: () => max });
  const cards = Array.from({ length: 3 }, (_, i) => deferredCard({ dist: i }));
  cards.forEach((c, i) => h.scheduler.register(`c${i}`, c.handle));
  max = 3;
  h.scheduler.onSettle(0.5);
  await h.advance(150);
  assert.equal(cards.reduce((n, c) => n + c.started, 0), 3);
});

test('a running card is not collected again by a new drain', async () => {
  const h = makeHarness();
  const card = deferredCard();
  h.scheduler.register('c', card.handle);
  h.scheduler.onSettle(0.5);
  await h.advance(150);
  assert.equal(card.started, 1);
  const evals = card.evals;
  h.scheduler.onSettle(0.9);                 // new drain while it is still running
  await h.advance(150);
  assert.equal(card.evals, evals, 'not even measured while mid-swap');
  assert.equal(card.started, 1);
  card.finish();
  await h.advance(16);
});

test('a swap that lands under a superseded drain rejoins the current one', async () => {
  const h = makeHarness();
  const card = deferredCard();
  h.scheduler.register('c', card.handle);
  h.scheduler.onSettle(0.5);
  await h.advance(150);
  h.scheduler.onSettle(2);                   // zoomed further while it ran
  await h.advance(150);                      // new drain skipped it (running)
  card.finish();                             // committed at the old scale
  await h.advance(16);
  await h.advance(16);
  assert.equal(card.started, 2, 'measured again and climbed for the new scale');
  card.finish();
  await h.advance(16);
});

test("'step' re-queues the card in the same drain", async () => {
  const h = makeHarness({ maxConcurrent: 1 });
  const order = [];
  let steps = 0;
  // Two steps (xs → sm → lg), then the final swap commits.
  const ladder = instantCard({ dist: 0, result: () => (++steps < 3 ? 'step' : true), order, name: 'a' });
  const other = instantCard({ dist: 50, order, name: 'b' });
  h.scheduler.register('a', ladder.handle);
  h.scheduler.register('b', other.handle);
  h.scheduler.onSettle(0.5);
  await h.advance(150);
  for (let i = 0; i < 6; i++) await h.advance(16);
  assert.deepEqual(order, ['a', 'a', 'a', 'b'], 'the climb finishes before the next card');
  assert.equal(ladder.evals, 3, 'measured once by the drain and once after each step');

  h.scheduler.onSettle(0.5);                 // committed: epsilon-skipped now
  await h.advance(200);
  assert.equal(ladder.runs, 3);
});

test('a step whose next intent is null settles the card', async () => {
  const h = makeHarness();
  const card = instantCard({ result: 'step' });
  const handle = card.handle;
  let calls = 0;
  const wrapped = { evaluate: () => (++calls === 1 ? handle.evaluate() : null) };
  h.scheduler.register('c', wrapped);
  h.scheduler.onSettle(0.5);
  await h.advance(200);
  assert.equal(card.runs, 1);
  h.scheduler.onSettle(0.5);
  await h.advance(200);
  assert.equal(calls, 2, 'settled at this scale after the step');
});

test('promotes go nearest the viewport centre first', async () => {
  const h = makeHarness({ maxConcurrent: 1 });
  const order = [];
  [['far', 900], ['near', 10], ['mid', 300]].forEach(([name, dist]) => {
    h.scheduler.register(name, instantCard({ dist, order, name }).handle);
  });
  h.scheduler.onSettle(0.5);
  await h.advance(150);
  for (let i = 0; i < 4; i++) await h.advance(16);
  assert.deepEqual(order, ['near', 'mid', 'far']);
});

test('promotes without a distance fall back to largest area, after those with one', async () => {
  const h = makeHarness({ maxConcurrent: 1 });
  const order = [];
  h.scheduler.register('small', instantCard({ area: 10, order, name: 'small' }).handle);
  h.scheduler.register('big', instantCard({ area: 90, order, name: 'big' }).handle);
  h.scheduler.register('d', instantCard({ dist: 500, area: 1, order, name: 'd' }).handle);
  h.scheduler.onSettle(0.5);
  await h.advance(150);
  for (let i = 0; i < 4; i++) await h.advance(16);
  assert.deepEqual(order, ['d', 'big', 'small']);
});

test('a settle does not cancel a wave that is still arriving', async () => {
  const h = makeHarness();
  const card = instantCard();
  h.scheduler.register('c', card.handle);
  h.scheduler.notePaint(0.5);
  h.scheduler.onSettle(0.5);                 // its promote drain runs at 150
  await h.advance(150);
  assert.equal(card.runs, 1);
  card.kind = 'promote';
  await h.advance(150);                      // the wave still fires at 300 (epsilon-skips the card)
  assert.equal(card.runs, 1);
});

test('dispose clears the quiet timer', async () => {
  const h = makeHarness();
  const card = instantCard();
  h.scheduler.register('c', card.handle);
  h.scheduler.notePaint(0.5);
  h.scheduler.dispose();
  await h.advance(2000);
  assert.equal(card.runs, 0);
  assert.ok(h.timers.every((x) => x.done), 'no live timer is left behind');
});

test('a gesture aborts a drain between items', async () => {
  const h = makeHarness({ maxConcurrent: 1 });
  const a = deferredCard({ dist: 0 });
  const b = deferredCard({ dist: 1 });
  h.scheduler.register('a', a.handle);
  h.scheduler.register('b', b.handle);
  h.scheduler.onSettle(0.5);
  await h.advance(150);
  assert.equal(a.started, 1);
  h.gesture = true;
  a.finish();
  await h.advance(16);
  assert.equal(b.started, 0);
});

test('nudge opens a paint wave: a promote drain runs after the quiet time', async () => {
  const h = makeHarness();
  const card = instantCard();
  h.scheduler.register('c', card.handle);
  h.scheduler.nudge();
  await h.advance(299);
  assert.equal(card.runs, 0);
  await h.advance(1);
  assert.equal(card.runs, 1);
});

test('nudges coalesce like paints, and leave the canvas scale alone', async () => {
  const h = makeHarness();
  const card = instantCard();
  h.scheduler.register('c', card.handle);
  h.scheduler.onSettle(2);                   // measured and swapped at scale 2
  await h.advance(150);
  assert.equal(card.runs, 1);
  h.scheduler.nudge();
  await h.advance(200);
  h.scheduler.nudge();                       // re-arms the same quiet timer
  await h.advance(200);
  await h.advance(100);
  assert.equal(card.runs, 1, 'scale is still 2, so the committed card is epsilon-skipped');
});

test('touch makes an epsilon-skipped card evaluate again', async () => {
  const h = makeHarness();
  const card = instantCard();
  h.scheduler.register('c', card.handle);
  h.scheduler.onSettle(0.5);
  await h.advance(150);
  assert.equal(card.runs, 1);
  h.scheduler.onSettle(0.5);                 // same scale: skipped, not even measured
  await h.advance(150);
  assert.equal(card.runs, 1);
  assert.equal(card.evals, 1);
  h.scheduler.touch('c');                    // its box changed at the same scale
  await h.advance(300);
  assert.equal(card.evals, 2);
  assert.equal(card.runs, 2);
});

test('touch on an unknown card or after dispose does nothing', async () => {
  const h = makeHarness();
  const card = instantCard();
  h.scheduler.register('c', card.handle);
  h.scheduler.touch('nobody');
  assert.equal(h.timers.length, 0, 'no wave opened for an unknown id');
  h.scheduler.dispose();
  h.scheduler.touch('c');
  h.scheduler.nudge();
  await h.advance(2000);
  assert.equal(card.runs, 0);
  assert.equal(card.evals, 0);
});

test('a promote drain that bailed on a gesture runs once it ends, with no new settle', async () => {
  const h = makeHarness();
  const card = instantCard();
  h.scheduler.register('c', card.handle);
  h.gesture = true;
  h.scheduler.onSettle(0.5);                 // drain due at 150 finds the gesture deadline still running
  await h.advance(150);
  assert.equal(card.runs, 0);
  await h.advance(450);                      // re-armed again and again while it lasts
  assert.equal(card.runs, 0);
  h.gesture = false;
  await h.advance(150);
  assert.equal(card.runs, 1, 'the re-armed drain picked the card up');
});

test('a demote drain that bailed on a gesture runs once it ends, with no new settle', async () => {
  const h = makeHarness({ demoteIdleMs: 1500 });
  const card = instantCard({ kind: 'demote' });
  h.scheduler.register('c', card.handle);
  h.gesture = true;
  h.scheduler.onSettle(0.5);
  await h.advance(1500);                     // demote due: the gesture is still on
  assert.equal(card.runs, 0);
  h.gesture = false;
  await h.advance(1500);
  assert.equal(card.runs, 1);
});

test('a drain interrupted mid-queue by a gesture deadline picks the rest up after it', async () => {
  const h = makeHarness({ maxConcurrent: 1 });
  const a = deferredCard({ dist: 0 });
  const b = deferredCard({ dist: 1 });
  h.scheduler.register('a', a.handle);
  h.scheduler.register('b', b.handle);
  h.scheduler.onSettle(0.5);
  await h.advance(150);
  assert.equal(a.started, 1);
  h.gesture = true;                          // a deadline, with no onGesture to bump the generation
  a.finish();
  await h.advance(16);
  assert.equal(b.started, 0);
  h.gesture = false;
  await h.advance(150);
  assert.equal(b.started, 1, 'the re-armed drain collected the card that was left waiting');
  b.finish();
  await h.advance(16);
});

test('re-arming stops when the generation moves on', async () => {
  const h = makeHarness();
  const card = instantCard();
  h.scheduler.register('c', card.handle);
  h.gesture = true;
  h.scheduler.onSettle(0.5);
  await h.advance(150);                      // bailed and re-armed
  assert.ok(h.timers.some((x) => !x.done), 'a re-arm timer is pending');
  h.scheduler.onGesture();                   // gen bump clears it
  assert.ok(h.timers.every((x) => x.done), 'nothing left to re-arm');
  h.gesture = false;
  await h.advance(2000);
  assert.equal(card.runs, 0, 'the gesture owns the next settle; nothing runs on its own');
});

test('re-arming stops after dispose', async () => {
  const h = makeHarness();
  const card = instantCard();
  h.scheduler.register('c', card.handle);
  h.gesture = true;
  h.scheduler.onSettle(0.5);
  await h.advance(150);
  h.scheduler.dispose();
  assert.ok(h.timers.every((x) => x.done));
  h.gesture = false;
  await h.advance(2000);
  assert.equal(card.runs, 0);
});
