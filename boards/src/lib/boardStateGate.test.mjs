// The board_state backstop must never pile up. On 2026-10-17 one tab editing a
// doc on a 1.1 MB board sent 168 full-document upserts of that row in five
// minutes: each 250ms tick of typing was "due" while an earlier write was still
// on the wire, and a write that timed out never confirmed, so the retries kept
// coming until every other writer on the database timed out with them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStateWriteGate, STATE_BACKSTOP_MS, STATE_RETRY_MS } from './boardStateGate.js';

const BACKSTOP = { backstop: true };
const ALWAYS = { backstop: false };

test('a backstop is due once, then not again for a minute after it confirms', () => {
  const gate = createStateWriteGate();
  const t0 = 1_000_000;
  assert.equal(gate.due('b', BACKSTOP, t0), true);
  gate.start('b');
  gate.settle('b', { ok: true, startedAt: t0 }, t0 + 120);
  assert.equal(gate.due('b', BACKSTOP, t0 + 250), false);
  assert.equal(gate.due('b', BACKSTOP, t0 + STATE_BACKSTOP_MS - 1), false);
  assert.equal(gate.due('b', BACKSTOP, t0 + STATE_BACKSTOP_MS), true);
});

test('typing while a slow write is on the wire starts no second write of that board', () => {
  const gate = createStateWriteGate();
  const t0 = 1_000_000;
  let started = 0;
  // Eight seconds of 250ms persist ticks against a write that takes 8s to fail.
  for (let t = t0; t < t0 + 8_000; t += 250) {
    if (gate.due('b', BACKSTOP, t)) { gate.start('b'); started += 1; }
  }
  assert.equal(started, 1);
});

test('a failed write holds the next backstop back for the retry window, not a minute', () => {
  const gate = createStateWriteGate();
  const t0 = 1_000_000;
  gate.start('b');
  gate.settle('b', { ok: false, startedAt: t0 }, t0 + 8_000);
  assert.equal(gate.due('b', BACKSTOP, t0 + 8_000 + STATE_RETRY_MS - 1), false);
  assert.equal(gate.due('b', BACKSTOP, t0 + 8_000 + STATE_RETRY_MS), true);
});

test('every other write is due regardless: pagehide, flushNow, destroy, detached docs', () => {
  const gate = createStateWriteGate();
  const t0 = 1_000_000;
  gate.start('b');
  assert.equal(gate.due('b', ALWAYS, t0), true);
  gate.settle('b', { ok: false, startedAt: t0 }, t0 + 10);
  assert.equal(gate.due('b', ALWAYS, t0 + 20), true);
});

test('a confirmed write of any kind resets the backstop minute', () => {
  const gate = createStateWriteGate();
  const t0 = 1_000_000;
  gate.start('b');
  gate.settle('b', { ok: true, startedAt: t0 }, t0 + 50);
  assert.equal(gate.due('b', BACKSTOP, t0 + 1_000), false);
});

test('in-flight writes are counted per board', () => {
  const gate = createStateWriteGate();
  const t0 = 1_000_000;
  gate.start('a');
  gate.start('a');
  assert.equal(gate.due('b', BACKSTOP, t0), true);
  gate.settle('a', { ok: true, startedAt: t0 - STATE_BACKSTOP_MS }, t0);
  assert.equal(gate.due('a', BACKSTOP, t0), false, 'one write of a is still on the wire');
  gate.settle('a', { ok: true, startedAt: t0 - STATE_BACKSTOP_MS }, t0);
  assert.equal(gate.due('a', BACKSTOP, t0), true);
});
