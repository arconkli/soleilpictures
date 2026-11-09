// The canvas's view of the connection (lib/canvasConnection.js): the doc
// footer's save tracker boiled down to live / offline / reconnecting / error,
// with `saved` for 3 s after a recovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { ROOM_ANSWERS, answerAck } from './roomAck.js';
import { createSaveTracker, SAVE_TIMING } from './docSaveStatus.js';
import { watchCanvasConnection, RECOVERED_MS } from './canvasConnection.js';

function fakeClock(start = 1_000_000) {
  let t = start;
  let seq = 0;
  const due = new Map();
  return {
    now: () => t,
    set(fn, ms) { const id = ++seq; due.set(id, { at: t + ms, fn }); return id; },
    clear(id) { due.delete(id); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, d] of due) if (d.at <= end && (!next || d.at < next[1].at)) next = [id, d];
        if (!next) break;
        due.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
    },
    timers: () => due.size,
  };
}

// The parts of y-partyserver's YProvider the tracker reads (as in docSaveStatus.test.mjs).
class FakeProvider {
  constructor() {
    this.doc = new Y.Doc();
    this.room = new Y.Doc();
    this.handlers = new Map();
    this.sent = [];
    this.ws = null;
    this.wsconnected = false;
    this.synced = false;
    this.shouldConnect = true;
    this.writable = true;
  }
  on(ev, fn) { if (!this.handlers.has(ev)) this.handlers.set(ev, new Set()); this.handlers.get(ev).add(fn); }
  off(ev, fn) { this.handlers.get(ev)?.delete(fn); }
  emit(ev, ...args) { for (const fn of [...(this.handlers.get(ev) || [])]) fn(...args); }
  listening() { let n = 0; for (const s of this.handlers.values()) n += s.size; return n; }
  sendMessage(m) { this.sent.push(m); }
  live() {
    this.shouldConnect = true;
    this.ws = {};
    this.emit('status', { status: 'connecting' });
    this.wsconnected = true;
    this.emit('status', { status: 'connected' });
    this.emit('custom-message', ROOM_ANSWERS);
    this.ws._acks = true;
    if (this.writable) Y.applyUpdate(this.room, Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(this.room)));
    this.synced = true;
    this.emit('sync', true);
  }
  drop() {
    this.ws = null;
    this.wsconnected = false;
    this.synced = false;
    this.emit('sync', false);
    this.emit('status', { status: 'disconnected' });
  }
  answer() {
    if (this.writable) Y.applyUpdate(this.room, Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(this.room)));
    const q = this.sent.filter((m) => JSON.parse(m).t === 'ack?').at(-1);
    this.emit('custom-message', answerAck(this.room, q, { canWrite: this.writable }));
  }
}

const edit = (p) => p.doc.getMap('cards').set(`c${Math.random()}`, 1);

function setup({ room = true, online = true } = {}) {
  const clock = fakeClock();
  const p = new FakeProvider();
  const ydoc = p.doc;
  if (room) ydoc._soleilRoom = p;
  const win = new EventTarget();
  const net = { online };
  const seen = [];
  let released = 0;
  let tracker = null;
  const acquire = (doc) => {
    tracker = createSaveTracker({ doc, boardId: 'b1', clock });
    return { tracker, release: () => { released++; tracker.dispose(); } };
  };
  const w = watchCanvasConnection({
    ydoc, boardId: 'b1', clock, win, acquire, isOnline: () => net.online, onChange: (o) => seen.push(o),
  });
  return {
    clock, p, ydoc, win, net, seen, w, tracker: () => tracker, released: () => released,
    offline() { net.online = false; win.dispatchEvent(new Event('offline')); },
    online() { net.online = true; win.dispatchEvent(new Event('online')); },
  };
}

test('live: a synced room is live, with the time it became live', () => {
  const s = setup();
  assert.equal(s.w.get().state, 'live');
  assert.equal(s.w.get().live, false);
  assert.equal(s.w.get().liveSince, null);
  s.p.live();
  const at = s.clock.now();
  assert.deepEqual(s.w.get(), { state: 'live', pending: false, kept: true, live: true, liveSince: at, everLive: true });
  s.clock.advance(7000);
  assert.equal(s.w.get().liveSince, at, 'stays the moment it became live');
  s.p.drop();
  assert.equal(s.w.get().live, false);
  assert.equal(s.w.get().liveSince, null);
  assert.equal(s.w.get().everLive, true, 'stays true after a drop');
});

test('everLive is false until the room has been live once', () => {
  const s = setup();
  assert.equal(s.w.get().everLive, false);
  s.p.live();
  assert.equal(s.w.get().everLive, true);
});

test('a slow first connect is not a recovery: reconnecting, then live, never saved', () => {
  const s = setup();
  s.clock.advance(SAVE_TIMING.graceMs);
  assert.equal(s.w.get().state, 'reconnecting');
  assert.equal(s.w.get().everLive, false);
  s.p.live();
  assert.equal(s.w.get().state, 'live');
  s.clock.advance(RECOVERED_MS);
  assert.ok(!s.seen.some((o) => o.state === 'saved'), 'never saved');
});

test('a drop after being live is a recovery: saved for RECOVERED_MS', () => {
  const s = setup();
  s.p.live();
  s.p.drop();
  s.clock.advance(SAVE_TIMING.graceMs);
  assert.deepEqual([s.w.get().state, s.w.get().everLive], ['reconnecting', true]);
  s.p.live();
  assert.equal(s.w.get().state, 'saved');
  s.clock.advance(RECOVERED_MS);
  assert.equal(s.w.get().state, 'live');
});

test('saving a change is still live, and pending says so', () => {
  const s = setup();
  s.p.live();
  edit(s.p);
  assert.equal(s.w.get().state, 'live');
  assert.equal(s.w.get().pending, true);
  s.clock.advance(SAVE_TIMING.askDelayMs);
  s.p.answer();
  assert.equal(s.w.get().pending, false);
  assert.equal(s.w.get().state, 'live', 'nothing was wrong: no recovery banner');
});

test('offline: the browser being offline, then back to saved for 3 s, then live', () => {
  const s = setup();
  s.p.live();
  const from = s.seen.length;
  s.offline();
  assert.equal(s.w.get().state, 'offline');
  s.online();
  assert.equal(s.w.get().state, 'saved');
  s.clock.advance(RECOVERED_MS - 1);
  assert.equal(s.w.get().state, 'saved');
  s.clock.advance(1);
  assert.equal(s.w.get().state, 'live');
  assert.deepEqual(s.seen.slice(from).map((o) => o.state), ['offline', 'saved', 'live']);
});

test('reconnecting: a room that stays down past the grace, then saved for 3 s, then live', () => {
  const s = setup();
  s.p.live();
  s.p.drop();
  s.clock.advance(SAVE_TIMING.graceMs - 1);
  assert.equal(s.w.get().state, 'live', 'a blip is not reported');
  s.clock.advance(1);
  assert.equal(s.w.get().state, 'reconnecting');
  s.p.live();
  assert.equal(s.w.get().state, 'saved');
  s.clock.advance(RECOVERED_MS);
  assert.equal(s.w.get().state, 'live');
});

test('error: changes that could not be saved, until the room holds them', () => {
  const s = setup();
  s.p.live();
  edit(s.p);
  s.p.drop();
  s.tracker().backstop('error');
  s.clock.advance(SAVE_TIMING.graceMs);
  assert.equal(s.w.get().state, 'error');
  assert.equal(s.w.get().pending, true);
  s.p.live();
  assert.equal(s.w.get().state, 'live', 'back, but still saving: not yet recovered');
  s.clock.advance(SAVE_TIMING.askDelayMs);
  s.p.answer();
  assert.equal(s.w.get().state, 'saved');
  s.clock.advance(RECOVERED_MS);
  assert.equal(s.w.get().state, 'live');
});

test('going bad again inside the 3 s ends the recovery', () => {
  const s = setup();
  s.p.live();
  s.offline();
  s.online();
  s.clock.advance(1000);
  s.offline();
  assert.equal(s.w.get().state, 'offline');
  s.online();
  s.clock.advance(2999);
  assert.equal(s.w.get().state, 'saved', 'a fresh 3 s from the second recovery');
  s.clock.advance(1);
  assert.equal(s.w.get().state, 'live');
});

test('onChange fires only on change', () => {
  const s = setup();
  s.p.live();
  const n = s.seen.length;
  s.clock.advance(10_000);
  s.offline();
  s.offline();
  assert.equal(s.seen.length, n + 1);
  s.online();
  s.online();
  assert.equal(s.seen.length, n + 2);
});

test('a room that appears late is picked up, and one that is replaced', () => {
  const s = setup({ room: false });
  assert.equal(s.w.get().live, false);
  s.p.live();
  s.ydoc._soleilRoom = s.p;
  s.clock.advance(500);
  assert.equal(s.w.get().live, true);
  // A remount: a new provider for the same doc.
  const q = new FakeProvider();
  q.doc = s.ydoc;
  s.p.drop();
  s.ydoc._soleilRoom = q;
  s.clock.advance(500);
  assert.equal(s.w.get().live, false);
  assert.equal(s.p.listening(), 0, 'let go of the old room');
  q.live();
  assert.equal(s.w.get().live, true);
});

test('viewonly and ended map to live', () => {
  const s = setup();
  s.p.writable = false;
  s.p.live();
  edit(s.p);
  s.clock.advance(SAVE_TIMING.askDelayMs);
  s.p.answer();
  assert.equal(s.tracker().get().viewOnly, true);
  assert.equal(s.w.get().state, 'live');
  s.tracker().end();
  assert.equal(s.tracker().get().ended, true);
  assert.equal(s.w.get().state, 'live');
});

test('dispose releases the tracker and stops listening', () => {
  const s = setup();
  s.p.live();
  s.offline();
  const n = s.seen.length;
  s.w.dispose();
  s.w.dispose();
  assert.equal(s.released(), 1);
  assert.equal(s.p.listening(), 0);
  assert.equal(s.clock.timers(), 0);
  s.online();
  s.clock.advance(10_000);
  assert.equal(s.seen.length, n);
});
