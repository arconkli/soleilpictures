// Unit tests for the image-tier scheduler policy (lib/imageTierScheduler.js)
// — the module is pure and dependency-injected, so it runs straight in the
// Playwright Node process with a fake clock/timers + fake card handles: no
// page, no DOM, no real images.

import { expect, test } from '@playwright/test';
import { createImageTierScheduler } from '../src/lib/imageTierScheduler.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

function makeHarness(overrides = {}) {
  const h = {
    t: 0,
    timers: [],
    gesture: false,
  };
  h.advance = async (ms) => {
    // Step the fake clock and fire due timers, then let detached async drain
    // chains (Promise.all over handle.run()) settle. Several ticks because a
    // drain awaits its batch then awaits the next batch's gap timer.
    const target = h.t + ms;
    // Fire timers in due order so a batch-gap timer set during this advance
    // also fires if it lands within the window.
    let guard = 0;
    while (guard++ < 10000) {
      const due = h.timers.filter((x) => !x.done && x.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      h.t = Math.max(h.t, due.at);
      due.done = true;
      due.fn();
      await tick(); await tick();
    }
    h.t = target;
    await tick(); await tick();
  };
  h.scheduler = createImageTierScheduler({
    now: () => h.t,
    setTimer: (fn, ms) => { const x = { fn, at: h.t + ms, done: false }; h.timers.push(x); return x; },
    clearTimer: (x) => { if (x) x.done = true; },
    requestIdle: (fn) => { fn(); return 0; },     // synchronous: the delay timer already deferred
    cancelIdle: () => {},
    isGestureActive: () => h.gesture,
    ...overrides,
  });
  return h;
}

// A fake card handle. `kind` + `area` + `inViewport` drive the intent; run()
// records that the swap committed.
function fakeCard({ kind = 'promote', area = 100, inViewport = true } = {}) {
  const c = { evals: 0, runs: 0, kind, area, inViewport };
  c.handle = {
    evaluate: () => {
      c.evals += 1;
      if (!c.kind) return null;
      return { kind: c.kind, area: c.area, inViewport: c.inViewport, run: async () => { c.runs += 1; } };
    },
  };
  return c;
}

test('promote drain commits at most maxConcurrent swaps per batch tick', async () => {
  const h = makeHarness({ maxConcurrent: 3, promoteDelayMs: 150, batchGapMs: 16 });
  const cards = Array.from({ length: 7 }, (_, i) => fakeCard({ area: i }));
  cards.forEach((c, i) => h.scheduler.register(`c${i}`, c.handle));

  h.scheduler.onSettle(0.5);
  await h.advance(150);                       // promote timer fires → first batch
  expect(cards.reduce((n, c) => n + c.runs, 0)).toBe(3);
  await h.advance(16);                        // batch gap → second batch
  expect(cards.reduce((n, c) => n + c.runs, 0)).toBe(6);
  await h.advance(16);                        // last batch
  expect(cards.reduce((n, c) => n + c.runs, 0)).toBe(7);
});

test('promotes are ordered largest on-screen area first', async () => {
  const order = [];
  const h = makeHarness({ maxConcurrent: 1, promoteDelayMs: 150, batchGapMs: 16 });
  const areas = [10, 90, 50];
  areas.forEach((a, i) => {
    const handle = { evaluate: () => ({ kind: 'promote', area: a, inViewport: true, run: async () => { order.push(a); } }) };
    h.scheduler.register(`c${i}`, handle);
  });
  h.scheduler.onSettle(0.5);
  await h.advance(150);
  await h.advance(16);
  await h.advance(16);
  expect(order).toEqual([90, 50, 10]);
});

test('a promote whose rect is outside the viewport is never committed', async () => {
  const h = makeHarness();
  const onscreen = fakeCard({ inViewport: true });
  const offscreen = fakeCard({ inViewport: false });
  h.scheduler.register('on', onscreen.handle);
  h.scheduler.register('off', offscreen.handle);
  h.scheduler.onSettle(0.5);
  await h.advance(150);
  await h.advance(32);
  expect(onscreen.runs).toBe(1);
  expect(offscreen.runs).toBe(0);   // gated out — no wasted decode for a card the cull will drop
});

test('a pan-only settle (scale unchanged) re-measures nothing', async () => {
  const h = makeHarness();
  const card = fakeCard();
  h.scheduler.register('c', card.handle);

  h.scheduler.onSettle(0.5);
  await h.advance(200);
  expect(card.evals).toBe(1);
  expect(card.runs).toBe(1);

  // Same scale → within epsilon → skipped entirely (no evaluate, no gBCR).
  h.scheduler.onSettle(0.5);
  await h.advance(200);
  expect(card.evals).toBe(1);
});

test('demote drain waits for the idle window; a fresh settle defers it', async () => {
  const h = makeHarness({ demoteIdleMs: 1500, promoteDelayMs: 150 });
  const card = fakeCard({ kind: 'demote' });
  h.scheduler.register('c', card.handle);

  h.scheduler.onSettle(0.5);
  await h.advance(150);                  // promote drain runs, finds no promote
  expect(card.runs).toBe(0);
  await h.advance(1000);                 // still inside the 1500ms idle window
  expect(card.runs).toBe(0);

  // A settle at t≈1150 pushes the demote clock out by another 1500ms.
  h.scheduler.onSettle(0.9);
  await h.advance(1000);                 // 1000ms after the new settle — not yet
  expect(card.runs).toBe(0);
  await h.advance(600);                  // now >1500ms since the last settle
  expect(card.runs).toBe(1);
});

test('a card registered after the promote drain still demotes at idle', async () => {
  // Cards that remount during a zoom-out and finish loading after the promote
  // drain must not be stranded on a too-large tier: the demote drain
  // re-evaluates fresh at idle rather than replaying a promote-time snapshot.
  const h = makeHarness({ demoteIdleMs: 1500, promoteDelayMs: 150 });
  h.scheduler.onSettle(0.5);
  await h.advance(150);                  // promote drain runs with NO cards yet
  const card = fakeCard({ kind: 'demote' });
  h.scheduler.register('late', card.handle);   // registers AFTER the promote drain
  await h.advance(1400);                 // reach the 1500ms idle window
  expect(card.runs).toBe(1);
});

test('a resumed gesture aborts pending drains', async () => {
  const h = makeHarness({ promoteDelayMs: 150 });
  const card = fakeCard();
  h.scheduler.register('c', card.handle);

  h.scheduler.onSettle(0.5);
  h.scheduler.onGesture();               // gesture restarts before the promote timer fires
  await h.advance(400);
  expect(card.runs).toBe(0);             // aborted; the gesture's own settle will reschedule

  h.scheduler.onSettle(0.9);             // (different scale so epsilon doesn't skip)
  await h.advance(200);
  expect(card.runs).toBe(1);
});

test('gesture active at drain time blocks the swap', async () => {
  const h = makeHarness({ promoteDelayMs: 150 });
  const card = fakeCard();
  h.scheduler.register('c', card.handle);
  h.scheduler.onSettle(0.5);
  h.gesture = true;                      // gesture still active when the timer fires
  await h.advance(200);
  expect(card.runs).toBe(0);
});

test('an unregistered card mid-drain is not run', async () => {
  const h = makeHarness({ maxConcurrent: 1, promoteDelayMs: 150, batchGapMs: 16 });
  const a = fakeCard({ area: 100 });
  const b = fakeCard({ area: 10 });
  const unregB = h.scheduler.register('b', b.handle);
  h.scheduler.register('a', a.handle);

  h.scheduler.onSettle(0.5);
  await h.advance(150);                  // a (larger area) runs first
  expect(a.runs).toBe(1);
  unregB();                              // b unmounts before its batch
  await h.advance(16);
  expect(b.runs).toBe(0);
});

test('dispose cancels pending work', async () => {
  const h = makeHarness();
  const card = fakeCard();
  h.scheduler.register('c', card.handle);
  h.scheduler.onSettle(0.5);
  h.scheduler.dispose();
  await h.advance(2000);
  expect(card.runs).toBe(0);
});
