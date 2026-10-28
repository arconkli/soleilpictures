// "Has the room stored my changes?": the question a doc's save line asks its
// cluster's room, and the room's answer (lib/roomAck.js, party/board.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { ROOM_ANSWERS, ackAsk, answerAck, readAck } from './roomAck.js';

const room = () => new Y.Doc();
const device = () => new Y.Doc();
const send = (from, to) => Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
const ask = (doc, n) => ackAsk(doc.clientID, n);

test('the room answers with how far it holds the asking device\'s changes', () => {
  const r = room();
  const d = device();
  d.getMap('cards').set('a', 1);
  d.getMap('cards').set('b', 2);
  send(d, r);
  const reply = readAck(answerAck(r, ask(d, 7), { canWrite: true }));
  assert.deepEqual(reply, { n: 7, have: Y.getState(d.store, d.clientID), w: true });
  assert.ok(reply.have >= 2);
});

test('a change the room has not got is not covered', () => {
  const r = room();
  const d = device();
  d.getMap('cards').set('a', 1);
  send(d, r);
  d.getMap('cards').set('b', 2);         // still only on the device
  const k = Y.getState(d.store, d.clientID);
  const reply = readAck(answerAck(r, ackAsk(d.clientID, 1), { canWrite: true }));
  assert.ok(reply.have < k);
});

test('a device the room has never heard from has nothing stored', () => {
  const reply = readAck(answerAck(room(), ackAsk(123456, 2), { canWrite: true }));
  assert.equal(reply.have, 0);
});

test('a read-only connection is told so: the room drops its writes', () => {
  const reply = readAck(answerAck(room(), ackAsk(1, 3), { canWrite: false }));
  assert.equal(reply.w, false);
});

test('anything that is not a well-formed question gets no answer', () => {
  const r = room();
  for (const m of ['', 'nope', '{', 'null', '[]', '{"t":"hello"}', '{"t":"ack?"}',
    '{"t":"ack?","c":-1,"n":1}', '{"t":"ack?","c":1.5,"n":1}', '{"t":"ack?","c":"1","n":1}',
    '{"t":"ack?","c":1,"n":-1}', '{"t":"ack?","c":1,"n":"1"}', `{"t":"ack?","c":${2 ** 53},"n":1}`]) {
    assert.equal(answerAck(r, m, { canWrite: true }), null, m);
  }
});

test('an answer that is not the room\'s reads as nothing', () => {
  for (const m of [null, '', 'x', '{"t":"ack?","n":1,"have":1,"w":true}', '{"t":"ack","n":1,"have":-1,"w":true}',
    '{"t":"ack","n":1,"have":1}', '{"t":"ack","n":"1","have":1,"w":true}', '{"t":"ack","n":1,"have":1.5,"w":true}']) {
    assert.equal(readAck(m), null, String(m));
  }
  assert.deepEqual(readAck('{"t":"ack","n":1,"have":0,"w":false}'), { n: 1, have: 0, w: false });
});

test('the board room answers through answerAck, and never while it is resetting or its own copy is failing', () => {
  const board = readFileSync(new URL('../../party/board.ts', import.meta.url), 'utf8');
  const at = board.indexOf('onCustomMessage(conn: Connection, message: string)');
  assert.ok(at > 0, 'BoardParty answers custom messages');
  const body = board.slice(at, board.indexOf('\n  }\n', at));
  const order = ['if (this.resetting || this.unlogged) return;', 'answerAck(this.document, message, { canWrite: !this.isReadOnly(conn) })', 'this.sendCustomMessage(conn, reply)'];
  let last = -1;
  for (const needle of order) {
    const i = body.indexOf(needle);
    assert.ok(i > last, `${needle} comes in order`);
    last = i;
  }
  // It says so first on every connection, ahead of its sync reply (YServer's
  // onConnect sends its sync step 1 and returns; the reply to the device's
  // step 1 can only come from a later message).
  const onConnect = board.slice(board.indexOf('async onConnect('), board.indexOf('onMessage(conn: Connection'));
  assert.match(onConnect, /super\.onConnect\(conn, ctx\);\s*(?:\/\/[^\n]*\n\s*)*this\.sendCustomMessage\(conn, ROOM_ANSWERS\);/);
  assert.equal(ROOM_ANSWERS, '{"t":"acks"}');
  // Its own copy failing to take an update means the answer would prove
  // nothing: both writers set the flag on failure and the compaction clears it.
  assert.match(board, /this\.unlogged = true;[\s\S]*?this\.problem\("local log append", e\);/);
  assert.match(board, /this\.local\.compact\(Y\.encodeStateAsUpdate\(this\.document\)\);\s*this\.unlogged = false;/);
  assert.match(board, /this\.unlogged = true;\s*console\.error\(`\[board \$\{this\.name\}\] local compaction failed`, e\);/);
});
