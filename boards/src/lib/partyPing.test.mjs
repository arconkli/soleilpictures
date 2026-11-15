import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { PING, PONG, WAKE, WAKE_QUIET_MS, shouldWake } from './partyPing.js';
import { answerAck } from './roomAck.js';

const now = 1_000_000;

test('a tab wakes the room only when it may be napping, at most once per quiet spell', () => {
  assert.equal(shouldWake({ pings: false, now, lastReceived: 0, lastWakeAt: 0 }), false, 'an older room has no nap');
  assert.equal(shouldWake({ pings: true, now, lastReceived: now - 20_000, lastWakeAt: now - 20_000 }), true);
  assert.equal(shouldWake({ pings: true, now, lastReceived: now - 3_000, lastWakeAt: 0 }), false, 'heard from it lately');
  assert.equal(shouldWake({ pings: true, now, lastReceived: now - 20_000, lastWakeAt: now - 3_000 }), false, 'woke it lately');
  assert.equal(shouldWake({ pings: true, now, lastReceived: 0, lastWakeAt: 0 }), true);
  assert.equal(shouldWake({ pings: true, now, lastReceived: undefined, lastWakeAt: undefined }), true);
  assert.equal(shouldWake({ pings: true, now, lastReceived: now - WAKE_QUIET_MS, lastWakeAt: now - WAKE_QUIET_MS }), true, 'the boundary counts');
});

test('the wake pacing outlasts how long a room stays up', () => {
  assert.equal(WAKE_QUIET_MS, 12_000);
});

test('WAKE is a custom message the room ignores, and PING/PONG are not JSON', () => {
  assert.deepEqual(JSON.parse(WAKE), { t: 'wake' });
  assert.equal(answerAck(new Y.Doc(), WAKE, { canWrite: true }), null);
  for (const f of [PING, PONG]) assert.throws(() => JSON.parse(f));
});
