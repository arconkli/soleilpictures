import { test } from 'node:test';
import assert from 'node:assert/strict';
import { socketLooksDead, lastHeardFrom, workspaceTick } from './partyKeepalive.js';

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

test('a pong newer than the ping keeps a socket alive, with no binary frame', () => {
  const provider = { wsLastMessageReceived: 500, ws: { _pongAt: 1_000_030 } };
  assert.equal(lastHeardFrom(provider), 1_000_030);
  assert.equal(socketLooksDead(lastHeardFrom(provider), 1_000_000), false);
});

test('neither a pong nor a frame since the ping is dead', () => {
  const provider = { wsLastMessageReceived: 900_000, ws: { _pongAt: 950_000 } };
  assert.equal(socketLooksDead(lastHeardFrom(provider), 1_000_000), true);
  assert.equal(socketLooksDead(lastHeardFrom({}), 1_000_000), true);
});

test('wsLastMessageReceived alone still works', () => {
  const provider = { wsLastMessageReceived: 1_000_040, ws: {} };
  assert.equal(lastHeardFrom(provider), 1_000_040);
  assert.equal(socketLooksDead(lastHeardFrom(provider), 1_000_000), false);
});

test('workspace tick: an older room always gets here', () => {
  assert.equal(workspaceTick({ pings: false, lastSent: 'a', next: 'a' }), 'here');
});

test('workspace tick: a pinging room gets here only when it changed', () => {
  assert.equal(workspaceTick({ pings: true, lastSent: null, next: 'a' }), 'here');
  assert.equal(workspaceTick({ pings: true, lastSent: 'a', next: 'b' }), 'here');
  assert.equal(workspaceTick({ pings: true, lastSent: 'a', next: 'a' }), 'ping');
});
