// "Has the room stored my changes?" A doc's save line (lib/docSaveStatus.js)
// asks its cluster's room over the live socket, and the room
// (party/board.ts) answers with how far it holds that device's changes.
//
// Why an answer proves a change is stored: the room writes every update to its
// own storage the moment it applies it (party/roomLog.ts), and a Durable
// Object holds back every message it sends until the writes before it are
// durable (its output gate). The socket is ordered, so the room has applied
// everything a device sent before it asked: an answer means all of it is
// stored, deletions included. `have` (the room's Yjs clock for the device)
// says the room took the device's insertions too, rather than dropping them.
// A read-only connection's writes are dropped, and `w` says so.
//
// Both sides use this module; the wire is y-partyserver's custom message
// (sendMessage / onCustomMessage), JSON.

import * as Y from 'yjs';

const count = (v) => Number.isSafeInteger(v) && v >= 0;

// What a room that answers says first, on every connection, ahead of its
// sync reply: a device that has synced without hearing it is talking to a
// room from before this (and never gets an answer).
export const ROOM_ANSWERS = JSON.stringify({ t: 'acks' });

export function ackAsk(clientId, n) {
  return JSON.stringify({ t: 'ack?', c: clientId, n });
}

// The room's answer to a question, or null for anything else.
export function answerAck(doc, message, { canWrite }) {
  let m;
  try { m = JSON.parse(message); } catch (_) { return null; }
  if (!m || m.t !== 'ack?' || !count(m.c) || !count(m.n)) return null;
  return JSON.stringify({ t: 'ack', n: m.n, have: Y.getState(doc.store, m.c), w: canWrite === true });
}

// An answer as the device reads it, or null.
export function readAck(text) {
  let m;
  try { m = JSON.parse(text); } catch (_) { return null; }
  if (!m || m.t !== 'ack' || !count(m.n) || !count(m.have) || typeof m.w !== 'boolean') return null;
  return { n: m.n, have: m.have, w: m.w };
}
