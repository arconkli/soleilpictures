import { test } from 'node:test';
import assert from 'node:assert/strict';
import { socketLooksDead } from './partyKeepalive.js';

test('a socket that answered its last ping is alive, however long ago that was', () => {
  // A hidden tab throttled to one tick a minute: ping at t, echo at t+40 ms,
  // next tick at t+60 s.
  assert.equal(socketLooksDead(1_000_040, 1_000_000), false);
  assert.equal(socketLooksDead(1_000_000, 1_000_000), false);   // same millisecond
});

test('a socket that never answered its last ping is dead', () => {
  assert.equal(socketLooksDead(999_000, 1_000_000), true);
  assert.equal(socketLooksDead(undefined, 1_000_000), true);
});

test('no ping yet, or a fresh socket, is never judged', () => {
  assert.equal(socketLooksDead(0, 0), false);
  assert.equal(socketLooksDead(5, 0), false);
});
