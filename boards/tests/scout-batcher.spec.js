// Unit tests for Scout's burst batcher (scout/src/batcher.js). Pure +
// dependency-free, so it runs straight in the Playwright Node process.
//
// Two properties do real work here:
//
//   BATCHING  — one attachment per message means a 12-photo dump is 12 inbound
//               messages. If they don't coalesce, the user gets 12 replies.
//   SERIALIZATION — a flush does uploads + an LLM call + three writes, and can
//               easily outlive the next 20s window. Two flushes racing on one
//               conversation would each load the board, lay out against what
//               they saw, and write back a full board_state — so the slower one
//               clobbers the faster one's cards and photos vanish silently.
//               That's the bug this file exists to prevent regressing.

import { expect, test } from '@playwright/test';
import { makeBatcher } from '../../scout/src/batcher.js';

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const msg = (over = {}) => ({
  platform: 'imessage', threadKey: 't1', handle: '+15550001111',
  service: 'iMessage', space: { id: 't1' }, ...over,
});

test('a burst of messages coalesces into ONE flush', async () => {
  const flushes = [];
  const b = makeBatcher({ waitMs: 60, onFlush: async (burst) => { flushes.push(burst); } });

  for (let i = 0; i < 12; i++) {
    b.add('k', msg({ attachment: { bytes: new Uint8Array([i]), mimeType: 'image/jpeg', name: `${i}.jpg` } }));
    await tick(5);   // messages arrive milliseconds apart, as they really do
  }
  await tick(140);

  expect(flushes).toHaveLength(1);
  expect(flushes[0].attachments).toHaveLength(12);
});

test('text and attachments from one burst arrive together', async () => {
  const flushes = [];
  const b = makeBatcher({ waitMs: 50, onFlush: async (burst) => { flushes.push(burst); } });

  b.add('k', msg({ attachment: { bytes: new Uint8Array([1]), mimeType: 'image/jpeg', name: 'a.jpg' } }));
  b.add('k', msg({ text: 'scene 4 diner' }));
  b.add('k', msg({ attachment: { bytes: new Uint8Array([2]), mimeType: 'image/jpeg', name: 'b.jpg' } }));
  await tick(130);

  expect(flushes).toHaveLength(1);
  expect(flushes[0].texts).toEqual(['scene 4 diner']);
  expect(flushes[0].attachments).toHaveLength(2);
});

test('each new message pushes the deadline out', async () => {
  let fired = 0;
  const b = makeBatcher({ waitMs: 80, onFlush: async () => { fired++; } });

  b.add('k', msg({ text: 'a' }));
  await tick(50);
  expect(fired).toBe(0);            // not yet — still inside the window
  b.add('k', msg({ text: 'b' }));   // resets it
  await tick(50);
  expect(fired).toBe(0);            // still waiting, because 'b' pushed it out
  await tick(80);
  expect(fired).toBe(1);
});

test('the ceiling stops a continuous uploader from never getting a reply', async () => {
  let fired = 0;
  // waitMs would keep receding forever; maxWaitMs is measured from the FIRST
  // message and forces a flush.
  const b = makeBatcher({ waitMs: 60, maxWaitMs: 150, onFlush: async () => { fired++; } });

  const start = Date.now();
  const iv = setInterval(() => b.add('k', msg({ text: 'x' })), 20);
  await tick(260);
  clearInterval(iv);

  expect(fired).toBeGreaterThanOrEqual(1);
  expect(Date.now() - start).toBeLessThan(400);
});

test('two conversations are batched independently', async () => {
  const seen = [];
  const b = makeBatcher({ waitMs: 50, onFlush: async (burst) => { seen.push(burst.threadKey); } });

  b.add('a', msg({ threadKey: 'a', text: '1' }));
  b.add('b', msg({ threadKey: 'b', text: '2' }));
  await tick(130);

  expect(seen.sort()).toEqual(['a', 'b']);
});

test('flushes for ONE conversation never overlap', async () => {
  // The regression guard. A flush that outlives the next debounce window must
  // queue behind its predecessor, not race it onto the same board.
  let active = 0;
  let peak = 0;
  const order = [];
  const b = makeBatcher({
    waitMs: 30,
    onFlush: async (burst) => {
      active++; peak = Math.max(peak, active);
      order.push(`start:${burst.texts[0]}`);
      await tick(120);                 // slower than the debounce window
      order.push(`end:${burst.texts[0]}`);
      active--;
    },
  });

  b.add('k', msg({ text: 'first' }));
  await tick(60);                      // first flush is now running
  b.add('k', msg({ text: 'second' })); // second burst lands mid-flush
  await tick(400);

  expect(peak, 'two flushes ran concurrently on one conversation').toBe(1);
  expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
});

test('a failing flush does not block the next one', async () => {
  const done = [];
  const b = makeBatcher({
    waitMs: 25,
    onFlush: async (burst) => {
      if (burst.texts[0] === 'bad') throw new Error('boom');
      done.push(burst.texts[0]);
    },
  });

  b.add('k', msg({ text: 'bad' }));
  await tick(70);
  b.add('k', msg({ text: 'good' }));
  await tick(120);

  expect(done).toEqual(['good']);
});

test('drain flushes pending work and waits for it', async () => {
  const done = [];
  const b = makeBatcher({
    waitMs: 10_000,                    // would never fire on its own
    onFlush: async (burst) => { await tick(40); done.push(burst.texts[0]); },
  });

  b.add('a', msg({ threadKey: 'a', text: 'one' }));
  b.add('b', msg({ threadKey: 'b', text: 'two' }));
  expect(b.size).toBe(2);

  await b.drain();

  // Awaited, not just triggered — a machine being recycled must not exit with
  // someone's photos half-written.
  expect(done.sort()).toEqual(['one', 'two']);
  expect(b.size).toBe(0);
  expect(b.inFlight).toBe(0);
});
