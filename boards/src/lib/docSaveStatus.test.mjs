// A doc's save line claims only what is proven (lib/docSaveStatus.js): Saved
// once the cluster's room says it holds every change made here, Saving… while
// one is on its way, and, when the room can't be reached, that the changes
// are kept on this device.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { ROOM_ANSWERS, answerAck } from './roomAck.js';
import { createSaveTracker, acquireSaveTracker, saveLine, SAVE_TIMING } from './docSaveStatus.js';

// A clock the test moves by hand.
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
  };
}

// The parts of y-partyserver's YProvider the tracker reads.
class FakeProvider {
  constructor() {
    this.doc = new Y.Doc();
    this.room = new Y.Doc();        // what the room holds
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
  asks() { return this.sent.map((m) => JSON.parse(m)).filter((m) => m.t === 'ack?'); }
  connect({ hello = true } = {}) {
    this.shouldConnect = true;
    this.ws = {};
    this.emit('status', { status: 'connecting' });
    this.wsconnected = true;
    this.emit('status', { status: 'connected' });
    // The room's hello: y-partyserver hands it on, and lib/yPartyKit.js marks
    // the socket with it.
    if (hello) { this.emit('custom-message', ROOM_ANSWERS); this.ws._acks = true; }
  }
  // The room takes everything the device has (the sync handshake), then says so.
  sync() {
    if (this.writable) Y.applyUpdate(this.room, Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(this.room)));
    this.synced = true;
    this.emit('sync', true);
  }
  live(opts) { this.connect(opts); this.sync(); }
  drop() {
    this.ws = null;
    this.wsconnected = false;
    this.synced = false;
    this.emit('sync', false);
    this.emit('status', { status: 'disconnected' });
  }
  park() { this.shouldConnect = false; this.drop(); }
  // The room's reply to the latest question, as party/board.ts gives it; the
  // room first takes what the device sent before it asked (`deliver`).
  answer({ deliver = true } = {}) {
    if (deliver && this.writable) Y.applyUpdate(this.room, Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(this.room)));
    const q = this.sent.filter((m) => JSON.parse(m).t === 'ack?').at(-1);
    this.emit('custom-message', answerAck(this.room, q, { canWrite: this.writable }));
  }
  // A peer's edit, arriving through the room.
  peerEdit() {
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(this.doc));
    peer.getMap('cards').set(`p${Math.random()}`, 1);
    Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(this.doc)), this);
  }
}

const edit = (p, k = `c${Math.random()}`) => p.doc.getMap('cards').set(k, 1);
const text = (tr, online = true, clock) => saveLine(tr.get(), { online, now: clock.now() }).text;
const track = (p, clock) => createSaveTracker({ doc: p.doc, room: p, clock });

test('a change while the room is live is Saving… until the room says it holds it, then Saved', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live();
  const tr = track(p, clock);
  assert.equal(text(tr, true, clock), 'All changes saved');
  edit(p);
  assert.equal(text(tr, true, clock), 'Saving…');
  assert.equal(p.asks().length, 0, 'asks once the burst settles, not per keystroke');
  clock.advance(SAVE_TIMING.askDelayMs);
  assert.deepEqual(p.asks().map((q) => q.c), [p.doc.clientID]);
  p.answer();
  assert.equal(tr.get().pending, false);
  assert.equal(text(tr, true, clock), 'Saved just now');
  clock.advance(42_000);
  assert.equal(text(tr, true, clock), 'Saved 42s ago');
});

test('an answer from before the room has the change is not taken as Saved, and the room is asked again', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live();
  const tr = track(p, clock);
  edit(p);
  clock.advance(SAVE_TIMING.askDelayMs);
  p.answer({ deliver: false });
  assert.equal(tr.get().pending, true);
  clock.advance(SAVE_TIMING.askEveryMs);
  assert.equal(p.asks().length, 2);
  p.answer();
  assert.equal(tr.get().pending, false);
});

test('changes made after the question are not covered by its answer', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live();
  const tr = track(p, clock);
  edit(p);
  clock.advance(SAVE_TIMING.askDelayMs);
  edit(p);                                  // after the question went
  p.answer();                               // its answer speaks for what came before it
  assert.equal(tr.get().pending, true);
  clock.advance(SAVE_TIMING.askEveryMs);
  assert.equal(p.asks().length, 2);
  p.answer();
  assert.equal(tr.get().pending, false);
});

test('a burst of typing is one question, asked once it settles', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live();
  const tr = track(p, clock);
  for (let i = 0; i < 30; i++) { edit(p); clock.advance(100); }
  assert.equal(p.asks().length, 0);
  clock.advance(SAVE_TIMING.askDelayMs);
  assert.equal(p.asks().length, 1);
  p.answer();
  assert.equal(tr.get().pending, false);
});

test('questions are at least a second apart', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live();
  track(p, clock);
  edit(p);
  clock.advance(SAVE_TIMING.askDelayMs);
  p.answer();
  clock.advance(50);
  edit(p);
  clock.advance(SAVE_TIMING.askDelayMs);
  assert.equal(p.asks().length, 1);
  clock.advance(SAVE_TIMING.askEveryMs - SAVE_TIMING.askDelayMs - 50);
  assert.equal(p.asks().length, 2);
});

test('a peer\'s change, arriving through the room, is not ours to save', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live();
  const tr = track(p, clock);
  p.peerEdit();
  clock.advance(5_000);
  assert.equal(tr.get().pending, false);
  assert.equal(p.asks().length, 0);
});

test('a deletion is a change too (it moves no Yjs clock, so the answer\'s order is what proves it)', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live();
  const tr = track(p, clock);
  edit(p, 'a');
  clock.advance(SAVE_TIMING.askDelayMs);
  p.answer();
  assert.equal(tr.get().pending, false);
  const k = Y.getState(p.doc.store, p.doc.clientID);
  p.doc.getMap('cards').delete('a');
  assert.equal(Y.getState(p.doc.store, p.doc.clientID), k);
  assert.equal(tr.get().pending, true);
  clock.advance(SAVE_TIMING.askEveryMs);
  p.answer();
  assert.equal(tr.get().pending, false);
  assert.equal(p.room.getMap('cards').has('a'), false);
});

test('a room from before this (it syncs without saying it answers) leaves Saved to the whole-board save', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live({ hello: false });
  const tr = track(p, clock);
  edit(p);
  clock.advance(10_000);
  assert.equal(p.asks().length, 0, 'never asks a room that never answers');
  assert.equal(text(tr, true, clock), 'Saving…');
  tr.backstop('sent');
  assert.equal(text(tr, true, clock), 'Saved just now');
});

test('a room that answers isn\'t overruled by a whole-board save that wrote nothing', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live();
  const tr = track(p, clock);
  edit(p);
  tr.backstop('sent');
  assert.equal(tr.get().pending, true);
  tr.backstop('saved');                     // a write that covered every change
  assert.equal(tr.get().pending, false);
});

test('a dropped socket voids the question; once the room is back it is asked again', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live();
  const tr = track(p, clock);
  edit(p);
  clock.advance(SAVE_TIMING.askDelayMs);
  p.drop();
  p.answer();                               // a late answer on the dead socket
  assert.equal(tr.get().pending, true);
  clock.advance(10_000);
  assert.equal(p.asks().length, 1, 'nothing is asked while it is down');
  p.live();
  clock.advance(SAVE_TIMING.askDelayMs);
  assert.equal(p.asks().length, 2);
  p.answer();
  assert.equal(tr.get().pending, false);
});

test('no answer in time: still Saving…, and the room is asked again', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live();
  const tr = track(p, clock);
  edit(p);
  clock.advance(SAVE_TIMING.askDelayMs + SAVE_TIMING.askTimeoutMs);
  assert.equal(text(tr, true, clock), 'Saving…');
  clock.advance(SAVE_TIMING.retryMaxMs);
  assert.ok(p.asks().length >= 2);
  p.answer();
  assert.equal(tr.get().pending, false);
});

test('down for a moment says nothing new; down for longer says the changes are kept here', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live();
  const tr = track(p, clock);
  edit(p);
  p.drop();
  p.emit('status', { status: 'connecting' });
  clock.advance(SAVE_TIMING.graceMs - 1);
  assert.equal(text(tr, true, clock), 'Saving…');
  clock.advance(1);
  assert.equal(text(tr, true, clock), 'Reconnecting — changes kept on this device');
  assert.equal(saveLine(tr.get(), { now: clock.now() }).short, 'Reconnecting…');
  assert.equal(text(tr, false, clock), 'Offline — changes kept on this device');
});

test('nothing to save while down says only that it is reconnecting; a room never reached is Connecting', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live();
  const tr = track(p, clock);
  p.drop();
  p.emit('status', { status: 'connecting' });
  clock.advance(SAVE_TIMING.graceMs);
  assert.equal(text(tr, true, clock), 'Reconnecting…');
  const q = new FakeProvider();
  q.emit('status', { status: 'connecting' });
  const tq = track(q, clock);
  clock.advance(SAVE_TIMING.graceMs);
  assert.equal(text(tq, true, clock), 'Connecting…');
  q.live();
  assert.equal(text(tq, true, clock), 'All changes saved');
});

test('a parked socket (let go of on purpose) is quiet, and taking it back starts the wait afresh', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live();
  const tr = track(p, clock);
  p.park();
  clock.advance(10 * 60_000);
  assert.equal(text(tr, true, clock), 'All changes saved');
  edit(p);                                  // input takes the room back
  p.shouldConnect = true;
  p.emit('status', { status: 'connecting' });
  assert.equal(text(tr, true, clock), 'Saving…');
  clock.advance(SAVE_TIMING.graceMs);
  assert.equal(text(tr, true, clock), 'Reconnecting — changes kept on this device');
});

test('a room that keeps this connection read-only: the changes aren\'t saved, and the line says so', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.writable = false;
  p.live();
  const tr = track(p, clock);
  edit(p);
  clock.advance(SAVE_TIMING.askDelayMs);
  p.answer();
  assert.equal(text(tr, true, clock), "View only — changes aren't saved");
  assert.equal(saveLine(tr.get(), { now: clock.now() }).short, 'View only');
});

test('shut out of the cluster: the line says it can\'t save', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live();
  const tr = track(p, clock);
  tr.end();
  assert.equal(text(tr, true, clock), "Can't save — access ended");
});

test('a failed whole-board save matters only when the room isn\'t there to hold the change', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live();
  const tr = track(p, clock);
  edit(p);
  tr.backstop('error');
  assert.equal(text(tr, true, clock), 'Saving…');
  p.drop();
  p.emit('status', { status: 'connecting' });
  clock.advance(SAVE_TIMING.graceMs);
  assert.equal(text(tr, true, clock), "Couldn't save — changes kept on this device");
  p.live();
  clock.advance(SAVE_TIMING.askDelayMs);
  p.answer();
  assert.equal(text(tr, true, clock), 'Saved just now');
});

test('one tracker per doc, however many lines show it; the last one gone takes its listeners', () => {
  const p = new FakeProvider();
  p.live();
  const before = p.listening();
  const a = acquireSaveTracker(p.doc, { room: p });
  const b = acquireSaveTracker(p.doc);
  assert.equal(a.tracker, b.tracker);
  edit(p);
  a.release();
  assert.ok(p.listening() > before);
  assert.equal(b.tracker.get().pending, true, 'the one left still knows what is unsaved');
  b.release();
  assert.equal(p.listening(), before);
  const c = acquireSaveTracker(p.doc, { room: p });
  assert.notEqual(c.tracker, a.tracker);
  c.release();
});

test('changes made before the room is known stay unsaved until it answers for them', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  const tr = createSaveTracker({ doc: p.doc, boardId: 'b1', clock });   // the cluster still opening: no room yet
  edit(p);
  assert.equal(text(tr, true, clock), 'Saving…');
  tr.backstop('sent');                                    // a whole-board save that wasn't due
  assert.equal(text(tr, true, clock), 'Saving…');
  tr.setRoom(p);
  p.live();
  clock.advance(SAVE_TIMING.askDelayMs);
  assert.equal(p.asks().length, 1);
  p.answer();
  assert.equal(text(tr, true, clock), 'Saved just now');
});

test('with no live room (no realtime here) Saved is a whole-board save that held every change', () => {
  const clock = fakeClock();
  const doc = new Y.Doc();
  const tr = createSaveTracker({ doc, boardId: 'b1', clock });
  assert.equal(text(tr, true, clock), 'All changes saved');
  doc.getMap('cards').set('a', 1);
  assert.equal(text(tr, true, clock), 'Saving…');
  tr.backstop('error');
  assert.equal(text(tr, true, clock), "Couldn't save — changes kept on this device");
  tr.backstop('saved');
  assert.equal(text(tr, true, clock), 'Saved just now');
  doc.getMap('cards').set('b', 1);
  tr.backstop('sent');                      // one that wasn't due stored nothing
  assert.equal(text(tr, true, clock), 'Saving…');
  assert.equal(text(tr, false, clock), 'Offline — changes kept on this device');
  // Without the doc (a line that came before it), the save events alone.
  const bare = createSaveTracker({ clock });
  bare.backstop('saving');
  assert.equal(text(bare, true, clock), 'Saving…');
  bare.backstop('saved');
  assert.equal(text(bare, true, clock), 'Saved just now');
  // And with neither a board's saves nor a room, nothing can say a change was
  // stored, so the line doesn't wait on one (a doc on no cluster: QA harnesses).
  const lone = new Y.Doc();
  const none = createSaveTracker({ doc: lone, clock });
  lone.getMap('cards').set('a', 1);
  assert.equal(text(none, true, clock), 'All changes saved');
});

test('when this device couldn\'t keep a draft, the line says to keep the tab open instead', () => {
  const clock = fakeClock();
  const p = new FakeProvider();
  p.live();
  const tr = track(p, clock);
  edit(p);
  p.drop();
  p.emit('status', { status: 'connecting' });
  clock.advance(SAVE_TIMING.graceMs);
  const line = (opts) => saveLine(tr.get(), { now: clock.now(), kept: false, ...opts }).text;
  assert.equal(line(), 'Reconnecting — keep this tab open');
  assert.equal(line({ online: false }), 'Offline — keep this tab open');
  tr.backstop('error');
  assert.equal(line(), "Couldn't save — keep this tab open");
});

test('the live room marks the socket whose room answers, and hangs itself on the doc while attached', () => {
  const src = readFileSync(new URL('./yPartyKit.js', import.meta.url), 'utf8');
  assert.ok(src.includes(`if (e.data === '__YPS:${ROOM_ANSWERS}') { e.target._acks = true; return; }`),
    'the hello, as y-partyserver frames a custom message');
  assert.match(src, /ydoc\._soleilRoom = provider;\s*(?:\/\/[^\n]*\n\s*)*return \{\n\s*awareness,/);
  assert.match(src, /destroy\(\) \{[\s\S]*?if \(ydoc\._soleilRoom === provider\) ydoc\._soleilRoom = null;/);
});

test('how long ago it saved', () => {
  const now = 10_000_000;
  const at = (ago) => saveLine({ mode: 'none', pending: false, savedAt: now - ago }, { now }).text;
  assert.equal(at(4_000), 'Saved just now');
  assert.equal(at(59_000), 'Saved 59s ago');
  assert.equal(at(2 * 60_000), 'Saved 2m ago');
  assert.equal(at(3 * 3600_000), 'Saved 3h ago');
  assert.equal(saveLine({ mode: 'none', pending: false, savedAt: null }, { now }).text, 'All changes saved');
});
