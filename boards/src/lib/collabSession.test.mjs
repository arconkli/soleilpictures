// collabSession.test.mjs — one event per real overlap, and none per blip.
//
//   node --test src/lib/collabSession.test.mjs
//
// Presence streams are messy: sockets reconnect, tabs wake for a second, people
// hop between boards. Each case below is a way this could over- or under-count
// collaboration, which is the signal the whole invite funnel is judged on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollabTracker, MIN_OVERLAP_MS } from './collabSession.js';

function clocked(start = 1_000_000) {
  let t = start;
  const tracker = createCollabTracker({ now: () => t });
  return { tracker, advance: (ms) => { t += ms; }, at: () => t };
}

test('being alone on a board emits nothing', () => {
  const { tracker, advance } = clocked();
  assert.equal(tracker.update('b1', 0), null);
  advance(60_000);
  assert.equal(tracker.update('b1', 0), null);
  assert.equal(tracker.end(), null);
});

test('a sustained overlap emits once, when it ends', () => {
  const { tracker, advance } = clocked();
  assert.equal(tracker.update('b1', 1), null, 'nothing is emitted while it is still happening');
  advance(30_000);
  assert.equal(tracker.update('b1', 1), null);
  advance(30_000);

  const out = tracker.update('b1', 0);
  assert.ok(out, 'the peer leaving closes the overlap');
  assert.equal(out.board_id, 'b1');
  assert.equal(out.peak_peers, 1);
  assert.equal(out.ms, 60_000);
});

test('peak_peers records the busiest moment, not the last one', () => {
  const { tracker, advance } = clocked();
  tracker.update('b1', 1);
  advance(10_000);
  tracker.update('b1', 4);
  advance(10_000);
  tracker.update('b1', 2);
  advance(10_000);
  const out = tracker.update('b1', 0);
  assert.equal(out.peak_peers, 4, 'a board that briefly held five people should say so');
});

test('a socket blip is discarded rather than logged as collaboration', () => {
  const { tracker, advance } = clocked();
  tracker.update('b1', 1);
  advance(MIN_OVERLAP_MS - 1);
  assert.equal(tracker.update('b1', 0), null, 'under the floor, this is a reconnect not a session');
});

test('the floor is inclusive', () => {
  const { tracker, advance } = clocked();
  tracker.update('b1', 1);
  advance(MIN_OVERLAP_MS);
  const out = tracker.update('b1', 0);
  assert.ok(out, 'exactly the floor counts');
  assert.equal(out.ms, MIN_OVERLAP_MS);
});

test('navigating to another board closes one overlap and opens the next', () => {
  const { tracker, advance } = clocked();
  tracker.update('b1', 2);
  advance(20_000);

  const out = tracker.update('b2', 1);
  assert.ok(out, 'the first board emits on the way out');
  assert.equal(out.board_id, 'b1');
  assert.equal(out.peak_peers, 2);
  assert.equal(out.ms, 20_000);

  advance(20_000);
  const out2 = tracker.end();
  assert.equal(out2.board_id, 'b2', 'and the second is tracked independently');
  assert.equal(out2.ms, 20_000);
});

test('end() banks an overlap that is still open when the tab closes', () => {
  const { tracker, advance } = clocked();
  tracker.update('b1', 3);
  advance(45_000);
  const out = tracker.end();
  assert.ok(out, 'closing the tab must not silently discard the session');
  assert.equal(out.peak_peers, 3);
  assert.equal(out.ms, 45_000);
});

test('end() is idempotent — no duplicate event', () => {
  const { tracker, advance } = clocked();
  tracker.update('b1', 1);
  advance(30_000);
  assert.ok(tracker.end());
  assert.equal(tracker.end(), null, 'a second end must not double-count');
});

test('losing the board id closes the overlap', () => {
  const { tracker, advance } = clocked();
  tracker.update('b1', 1);
  advance(30_000);
  const out = tracker.update(null, 2);
  assert.ok(out, 'navigating away from any board ends it');
  assert.equal(out.board_id, 'b1');
});

test('repeated identical updates do not restart the clock', () => {
  const { tracker, advance } = clocked();
  tracker.update('b1', 1);
  for (let i = 0; i < 10; i++) { advance(5_000); tracker.update('b1', 1); }
  const out = tracker.end();
  assert.equal(out.ms, 50_000, 'a 5s presence heartbeat must not keep resetting the start');
});

test('an overlap that resumes after a gap is a NEW session', () => {
  const { tracker, advance } = clocked();
  tracker.update('b1', 1);
  advance(30_000);
  const first = tracker.update('b1', 0);
  assert.equal(first.ms, 30_000);

  advance(600_000);              // ten minutes alone
  tracker.update('b1', 1);
  advance(10_000);
  const second = tracker.end();
  assert.equal(second.ms, 10_000, 'the idle gap is not counted as time together');
});

test('peek exposes the open overlap without closing it', () => {
  const { tracker, advance } = clocked();
  tracker.update('b1', 2);
  advance(1000);
  assert.equal(tracker.peek().boardId, 'b1');
  assert.equal(tracker.peek().peak, 2);
  advance(30_000);
  assert.ok(tracker.end(), 'peek did not consume it');
});
