// castAwareness.test.mjs — the synthetic cast, and the wall around it.
//
// One guarantee matters above all the others and it is asserted directly rather
// than reasoned about: A SYNTHETIC PEER NEVER REACHES THE NETWORK. The cast
// exists only in the value getStates() returns. If one ever leaked into the
// real awareness's local state it would be broadcast to actual collaborators,
// who would see a colleague who does not exist moving around their board.
//
// The "real" awareness below is a local minimum, not presenceQa.js's
// makeFakeAwareness — importing that reaches perf.js → errorReporting.js →
// import.meta.env, which does not exist under `node --test`. It implements the
// SAME four things CanvasPresence touches (getStates, meta.get, on/off
// 'change'), so keep it in step with presenceQa's if that contract moves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCastAwareness } from './castAwareness.js';
import { makeCast, advanceCast } from './syntheticPeers.js';

const BOARD = 'board-1';

function realWithPeer() {
  const states = new Map();
  const meta = new Map();
  const listeners = new Set();
  const aw = {
    clientID: 7,
    getStates: () => states,
    meta,
    on: (ev, fn) => { if (ev === 'change') listeners.add(fn); },
    off: (ev, fn) => { if (ev === 'change') listeners.delete(fn); },
    _emit: () => { for (const fn of [...listeners]) fn(); },
    // The broadcast path. Recorded so a leak is visible rather than inferred.
    localWrites: [],
    setLocalStateField: (k, v) => { aw.localWrites.push([k, v]); },
  };
  states.set(42, {
    user: { id: 'real-user', name: 'Real Person', color: '#fff' },
    canvasCursor: { boardId: BOARD, x: 10, y: 10 },
  });
  meta.set(42, { lastUpdated: 1 });
  return aw;
}

const castStates = (cast, t = 0) => () => advanceCast(cast, t, BOARD);

// ── The wall ───────────────────────────────────────────────────────────────

test('synthetic peers never reach the real awareness', () => {
  const real = realWithPeer();
  const cast = makeCast(3, { seed: 1, bounds: { x: 0, y: 0, w: 1000, h: 800 } });
  const proxy = makeCastAwareness(real, castStates(cast));

  // Read everything, repeatedly, the way the presence layer does.
  for (let i = 0; i < 5; i++) proxy.getStates();
  proxy.meta.get(42);

  assert.equal(real.getStates().size, 1, 'a synthetic peer was written into the real awareness');
  assert.deepEqual(real.localWrites, [], 'the proxy wrote to the broadcast path');
});

test('setLocalStateField is forwarded unchanged — the app still broadcasts you', () => {
  const real = realWithPeer();
  const proxy = makeCastAwareness(real, () => []);
  proxy.setLocalStateField('canvasCursor', { boardId: BOARD, x: 1, y: 2 });
  assert.deepEqual(real.localWrites, [['canvasCursor', { boardId: BOARD, x: 1, y: 2 }]]);
});

// ── The merge ──────────────────────────────────────────────────────────────

test('getStates returns the real peers union the cast', () => {
  const real = realWithPeer();
  const cast = makeCast(3, { seed: 2, bounds: { x: 0, y: 0, w: 500, h: 500 } });
  const proxy = makeCastAwareness(real, castStates(cast));

  const states = proxy.getStates();
  assert.equal(states.size, 4, 'expected 1 real + 3 synthetic');
  assert.equal(states.get(42).user.id, 'real-user');
  for (const p of cast) assert.ok(states.has(p.clientId), `cast member ${p.clientId} missing`);
});

test('a real peer always wins a clientId collision', () => {
  const real = realWithPeer();
  const collide = [{ clientId: 42, state: { user: { id: 'imposter', name: 'Fake' } } }];
  const proxy = makeCastAwareness(real, () => collide);
  assert.equal(proxy.getStates().get(42).user.id, 'real-user');
});

test('synthetic clientIds cannot collide with a real y-awareness id by accident', () => {
  const cast = makeCast(8, { seed: 7 });
  // y-awareness clientIDs are random 32-bit ints; the cast lives above 9e8 so
  // the space is disjoint in practice and the merge order handles the rest.
  for (const p of cast) assert.ok(p.clientId >= 900000000, `${p.clientId} is in the real range`);
  assert.equal(new Set(cast.map(p => p.clientId)).size, 8, 'duplicate clientIds within one cast');
});

test('a throwing state source degrades to the real peers rather than blanking', () => {
  const real = realWithPeer();
  const proxy = makeCastAwareness(real, () => { throw new Error('boom'); });
  const states = proxy.getStates();
  assert.equal(states.size, 1);
  assert.equal(states.get(42).user.id, 'real-user');
});

test('meta falls through for real peers and is always fresh for the cast', () => {
  const real = realWithPeer();
  const cast = makeCast(1, { seed: 3 });
  const proxy = makeCastAwareness(real, castStates(cast));
  assert.ok(proxy.meta.get(42), 'the real peer lost its meta');
  // A cast member must never age out of the presence grace window.
  assert.ok(proxy.meta.get(cast[0].clientId).lastUpdated > 0);
});

// ── Subscription ───────────────────────────────────────────────────────────

test('change listeners are attached to BOTH sides and detached from both', () => {
  const real = realWithPeer();
  const proxy = makeCastAwareness(real, () => []);
  let hits = 0;
  const fn = () => { hits++; };

  proxy.on('change', fn);
  real._emit();
  assert.equal(hits, 1, 'a real awareness change did not reach the subscriber');

  proxy.off('change', fn);
  real._emit();
  assert.equal(hits, 1, 'off() left the real subscription attached');
  proxy.destroy();
});

test('destroy stops the ticker so capture can end mid-session', () => {
  const real = realWithPeer();
  const proxy = makeCastAwareness(real, () => []);
  proxy.on('change', () => {});
  proxy.destroy();
  // Nothing to assert beyond "it does not throw and the timer is released" —
  // a leaked interval would keep the whole board re-rendering forever.
  assert.ok(true);
});

test('the cast renders with no real awareness at all', () => {
  // The room may not have connected yet, and the offline harness never has one.
  // A shot must not depend on a socket being up.
  const cast = makeCast(2, { seed: 21 });
  const proxy = makeCastAwareness(null, castStates(cast));
  const states = proxy.getStates();
  assert.equal(states.size, 2);
  assert.ok(proxy.meta.get(cast[0].clientId).lastUpdated > 0);
  assert.doesNotThrow(() => {
    proxy.on('change', () => {});
    proxy.setLocalStateField('canvasCursor', {});
    proxy.getLocalState();
    proxy.off('change', () => {});
    proxy.destroy();
  });
});

// ── The cast itself ────────────────────────────────────────────────────────

test('advanceCast is pure and deterministic', () => {
  const cast = makeCast(3, { seed: 5, bounds: { x: 0, y: 0, w: 900, h: 600 } });
  const a = advanceCast(cast, 1234, BOARD);
  const b = advanceCast(cast, 1234, BOARD);
  assert.deepEqual(a, b);
});

test('cast cursors stay inside the board they were given', () => {
  const bounds = { x: 100, y: 200, w: 800, h: 600 };
  const cast = makeCast(5, { seed: 9, bounds });
  for (let t = 0; t < 20000; t += 137) {
    for (const { state } of advanceCast(cast, t, BOARD)) {
      const { x, y } = state.canvasCursor;
      assert.ok(Number.isFinite(x) && Number.isFinite(y), `NaN at t=${t}`);
      assert.ok(x >= bounds.x && x <= bounds.x + bounds.w, `x ${x} escaped at t=${t}`);
      assert.ok(y >= bounds.y && y <= bounds.y + bounds.h, `y ${y} escaped at t=${t}`);
    }
  }
});

test('cursors never teleport — LiveCursor must never have to bridge a jump', () => {
  const cast = makeCast(4, { seed: 11, bounds: { x: 0, y: 0, w: 1000, h: 800 } });
  const STEP = 100;                 // the proxy's own tick
  const MAX_JUMP = 120;             // board units per tick
  let prev = advanceCast(cast, 0, BOARD);
  for (let t = STEP; t < 30000; t += STEP) {
    const now = advanceCast(cast, t, BOARD);
    for (let i = 0; i < now.length; i++) {
      const a = prev[i].state.canvasCursor;
      const b = now[i].state.canvasCursor;
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      assert.ok(d < MAX_JUMP, `peer ${i} jumped ${Math.round(d)} units at t=${t}`);
    }
    prev = now;
  }
});

test('every cast member is a distinct person', () => {
  const cast = makeCast(6, { seed: 13 });
  assert.equal(new Set(cast.map(p => p.user.id)).size, 6);
  assert.equal(new Set(cast.map(p => p.user.name)).size, 6, 'two peers share a name');
  for (const p of cast) {
    assert.ok(p.user.name && p.user.color, 'a cast member has no identity to render');
  }
});

test('the cast size is bounded and survives junk', () => {
  assert.equal(makeCast(0).length, 0);
  assert.equal(makeCast(-3).length, 0);
  assert.equal(makeCast(NaN).length, 0);
  assert.ok(makeCast(500).length <= 8, 'an unbounded cast would flood the cursor cap');
});

test('cast members select real cards, and often nothing at all', () => {
  const ids = ['c1', 'c2', 'c3'];
  const cast = makeCast(3, { seed: 17, cardIds: ids });
  let held = 0, empty = 0;
  for (let t = 0; t < 60000; t += 500) {
    for (const { state } of advanceCast(cast, t, BOARD)) {
      const sel = state.canvasSelection.cardIds;
      assert.ok(sel.length <= 1);
      if (sel.length) { assert.ok(ids.includes(sel[0])); held++; } else empty++;
    }
  }
  // People spend a lot of their time not having selected anything. A cast that
  // ALWAYS has something ringed reads as staged.
  assert.ok(held > 0, 'nobody ever selected anything');
  assert.ok(empty > 0, 'somebody always had a selection — nothing alive does that');
});

test('with no cards on the board, nobody selects anything', () => {
  for (const { state } of advanceCast(makeCast(2, { seed: 17 }), 0, BOARD)) {
    assert.deepEqual(state.canvasSelection.cardIds, []);
  }
});

// ── The realism properties ─────────────────────────────────────────────────
// The first version shared one leg duration, one dwell duration and one GLOBAL
// selection clock across the whole cast, so three cursors did the identical
// dance a beat apart and all changed selection on the same tick. These are the
// assertions that would have caught it.

test('no two peers move on the same rhythm', () => {
  const cast = makeCast(5, { seed: 23, bounds: { x: 0, y: 0, w: 1000, h: 800 } });
  const cycles = cast.map(p => Math.round(p.cycleMs));
  assert.equal(new Set(cycles).size, cycles.length,
    `two peers share a route length: ${cycles.join(', ')}`);
  const routes = cast.map(p => p.waypoints.length);
  assert.ok(new Set(routes).size > 1, 'every peer walks the same number of stops');
});

test('dwell varies stop to stop, not just peer to peer', () => {
  // A constant dwell is the tell — a person lingers on the thing they care
  // about and glances past the rest.
  for (const p of makeCast(4, { seed: 29 })) {
    const dwells = p.segs.map(g => Math.round(g.dwell));
    assert.ok(new Set(dwells).size > 1, `a peer dwells identically at every stop: ${dwells}`);
  }
});

test('selections do not change in unison', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const cast = makeCast(4, { seed: 31, cardIds: ids });
  const key = () => advanceCast(cast, T, BOARD).map(s => s.state.canvasSelection.cardIds.join());
  let T = 0;
  let prev = key();
  let simultaneous = 0, anyChange = 0;
  for (T = 250; T < 90000; T += 250) {
    const now = key();
    const changed = now.filter((v, i) => v !== prev[i]).length;
    if (changed > 0) anyChange++;
    if (changed === now.length) simultaneous++;
    prev = now;
  }
  assert.ok(anyChange > 10, 'selections never changed at all');
  assert.equal(simultaneous, 0,
    'the whole cast changed selection on the same tick — that is the global-clock bug');
});

test('a resting cursor still drifts, so it is never a frozen sprite', () => {
  const cast = makeCast(1, { seed: 37, bounds: { x: 0, y: 0, w: 900, h: 700 } });
  const xs = new Set();
  // Sample densely over one cycle; even the stationary stretches must vary.
  for (let t = 0; t < 4000; t += 60) {
    xs.add(Math.round(advanceCast(cast, t, BOARD)[0].state.canvasCursor.x * 10));
  }
  assert.ok(xs.size > 20, `a cursor sat perfectly still (${xs.size} distinct positions)`);
});

test('peers are not at the same point in their routes at t=0', () => {
  const cast = makeCast(4, { seed: 41, bounds: { x: 0, y: 0, w: 1000, h: 800 } });
  const at0 = advanceCast(cast, 0, BOARD).map(s =>
    `${Math.round(s.state.canvasCursor.x)},${Math.round(s.state.canvasCursor.y)}`);
  assert.equal(new Set(at0).size, at0.length, 'two peers start in the same place');
});
