// A stand-in for a cluster's live room in the doc QA harness (?docqa=1&room=1):
// the parts of y-partyserver's YProvider a doc's save line reads
// (lib/docSaveStatus.js), with the room's answers as party/board.ts gives
// them. A spec drives it through window.__soleilDocTest.room (docs-status.spec).
//
// DEV-only, like the harness that imports it.

import * as Y from 'yjs';
import { ROOM_ANSWERS, answerAck } from '../lib/roomAck.js';

export function createQaRoom(doc) {
  const held = new Y.Doc();       // what the room holds
  const handlers = new Map();
  const emit = (ev, ...args) => { for (const fn of [...(handlers.get(ev) || [])]) fn(...args); };
  let writable = true;
  let holding = false;
  let waiting = [];
  let asked = 0;
  // The room takes what the device has sent it: everything, over a live socket.
  const take = () => {
    if (writable) Y.applyUpdate(held, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(held)));
  };
  const room = {
    doc,
    ws: null,
    wsconnected: false,
    synced: false,
    shouldConnect: true,
    on(ev, fn) { if (!handlers.has(ev)) handlers.set(ev, new Set()); handlers.get(ev).add(fn); },
    off(ev, fn) { handlers.get(ev)?.delete(fn); },
    sendMessage(message) {
      const ws = room.ws;
      if (!ws) return;
      asked++;
      const reply = () => {
        if (room.ws !== ws) return;          // that socket is gone, and its question with it
        take();
        const answer = answerAck(held, message, { canWrite: writable });
        if (answer) emit('custom-message', answer);
      };
      if (holding) waiting.push(reply);
      else setTimeout(reply, 30);
    },
  };
  const controls = {
    // Connects and syncs, saying first that it answers (as yPartyKit marks it).
    live() {
      room.shouldConnect = true;
      room.ws = {};
      emit('status', { status: 'connecting' });
      room.wsconnected = true;
      emit('status', { status: 'connected' });
      emit('custom-message', ROOM_ANSWERS);
      room.ws._acks = true;
      take();
      room.synced = true;
      emit('sync', true);
    },
    // The socket drops; the provider keeps trying unless `park`.
    drop({ park = false } = {}) {
      if (park) room.shouldConnect = false;
      room.ws = null;
      room.wsconnected = false;
      room.synced = false;
      emit('sync', false);
      emit('status', { status: 'disconnected' });
      if (!park) emit('status', { status: 'connecting' });
    },
    // Answers wait until release().
    hold() { holding = true; },
    release() { holding = false; const w = waiting; waiting = []; w.forEach((f) => f()); },
    readOnly(on = true) { writable = !on; },
    asked: () => asked,
  };
  return { room, controls };
}
