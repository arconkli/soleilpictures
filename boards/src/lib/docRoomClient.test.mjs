// lib/docRoomClient.js: a shared doc's room, as a reader's browser holds it.
// What each close means, the custom messages, and the billing rules it keeps
// from the board client (keepalive, parking, a coded close before letting go).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import {
  DOC_ROOM_CLOSE, KEEPALIVE_MS, REASK_AFTER_FAILURES, attachDocRoom, closeAction, parseRoomMessage,
} from './docRoomClient.js';

const ROOM = 'bf59559b-bace-49f5-971c-93cbc348deb9.view.bcc7e3849c35';
const TOKEN = 'e1bdd355-ab8c-4c80-b5f0-7f9a0310dffa';
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// The room's codes (party/doc.ts CLOSE) and the client's are one table.
test('the client reads the room’s close codes', () => {
  const doc = readFileSync(new URL('../../party/doc.ts', import.meta.url), 'utf8');
  const m = /export const CLOSE = \{([^}]+)\}/.exec(doc);
  assert.ok(m);
  const server = Object.fromEntries(m[1].split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
    const [k, v] = p.split(':').map((x) => x.trim());
    return [k, Number(v)];
  }));
  assert.deepEqual(server, { ...DOC_ROOM_CLOSE });
});

test('moved asks the share again; gone, lost, suspended and too big stop; the rest retry', () => {
  assert.equal(closeAction(DOC_ROOM_CLOSE.MOVED), 'reask');
  for (const c of [DOC_ROOM_CLOSE.GONE, DOC_ROOM_CLOSE.LOST, DOC_ROOM_CLOSE.SUSPENDED, DOC_ROOM_CLOSE.TOO_BIG]) {
    assert.equal(closeAction(c), 'stop', String(c));
  }
  for (const c of [DOC_ROOM_CLOSE.UNAVAILABLE, DOC_ROOM_CLOSE.BUSY, DOC_ROOM_CLOSE.SILENT, 1000, 1006, 0]) {
    assert.equal(closeAction(c), 'retry', String(c));
  }
});

test('a custom message is a typed object or nothing', () => {
  assert.deepEqual(parseRoomMessage('{"type":"hello","access":"view"}'), { type: 'hello', access: 'view' });
  assert.equal(parseRoomMessage('{"access":"view"}'), null);
  assert.equal(parseRoomMessage('not json'), null);
  assert.equal(parseRoomMessage(null), null);
});

// A WebSocket stand-in YProvider drives as it would a real one.
class FakeWS {
  static all = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.OPEN = 1;
    this.sent = [];
    this.listeners = {};
    this.closedWith = null;
    FakeWS.all.push(this);
  }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  emit(t, ev) { for (const fn of [...(this.listeners[t] || [])]) fn(ev); }
  send(d) { this.sent.push(d); }
  open() { this.readyState = 1; this.emit('open', {}); }
  close(code, reason) {
    if (this.readyState === 3) return;
    this.closedWith = { code, reason };
    this.readyState = 3;
    this.emit('close', { code: code ?? 1005, reason: reason || '' });
  }
  // The room closes it.
  drop(code) { this.readyState = 3; this.emit('close', { code, reason: '' }); }
  text(s) { this.emit('message', { data: s }); }
}

// The provider's next socket, however long its backoff takes on a busy box.
async function nextSocket(n, timeoutMs = 5000) {
  const t0 = Date.now();
  while (FakeWS.all.length <= n) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`no socket ${n}`);
    await tick(10);
  }
  return FakeWS.all[n];
}

function attach(opts = {}) {
  FakeWS.all = [];
  const seen = { hello: [], refused: [], end: [] };
  const ydoc = new Y.Doc();
  const room = attachDocRoom(ydoc, {
    room: ROOM, token: TOKEN, host: 'party.test', WebSocketPolyfill: FakeWS,
    onHello: (m) => seen.hello.push(m), onRefused: (r) => seen.refused.push(r), onEnd: (e) => seen.end.push(e),
    ...opts,
  });
  return { ydoc, room, seen };
}

test('it opens the doc party’s room with the share token, and the session when there is one', async () => {
  const { room } = attach({ getAccessToken: async () => 'jwt-1' });
  try {
    const url = new URL((await nextSocket(0)).url);
    assert.equal(url.host, 'party.test');
    assert.equal(url.pathname, `/parties/doc/${ROOM}`);
    assert.equal(url.searchParams.get('share'), TOKEN);
    assert.equal(url.searchParams.get('access_token'), 'jwt-1');
  } finally { room.destroy(); }
  const anon = attach();
  try {
    assert.equal(new URL((await nextSocket(0)).url).searchParams.get('access_token'), null, 'signed out sends no token');
  } finally { anon.room.destroy(); }
});

test('hello and refused reach the caller', async () => {
  const { room, seen } = attach();
  try {
    const ws = await nextSocket(0);
    ws.open();
    ws.text('__YPS:{"type":"hello","me":{"name":"Viewer"},"readOnly":true}');
    ws.text('__YPS:{"type":"refused","reason":"doc_full"}');
    ws.text('soleil-board-reset');
    assert.equal(seen.hello.length, 1);
    assert.equal(seen.hello[0].me.name, 'Viewer');
    assert.deepEqual(seen.refused, ['doc_full']);
  } finally { room.destroy(); }
});

test('a final close stops for good; moved asks again; neither reconnects', async () => {
  for (const [code, action] of [[DOC_ROOM_CLOSE.GONE, 'stop'], [DOC_ROOM_CLOSE.LOST, 'stop'], [DOC_ROOM_CLOSE.MOVED, 'reask']]) {
    const { room, seen } = attach();
    try {
      (await nextSocket(0)).open();
      FakeWS.all[0].drop(code);
      await tick(300);
      assert.deepEqual(seen.end, [{ action, code }], String(code));
      assert.equal(FakeWS.all.length, 1, `${code}: no new socket`);
    } finally { room.destroy(); }
  }
});

test('a retryable close reconnects, keeping the doc', async () => {
  const { room, seen, ydoc } = attach();
  try {
    (await nextSocket(0)).open();
    ydoc.getMap('m').set('k', 1);
    FakeWS.all[0].drop(DOC_ROOM_CLOSE.UNAVAILABLE);
    await nextSocket(1);
    assert.deepEqual(seen.end, []);
    assert.equal(ydoc.getMap('m').get('k'), 1);
  } finally { room.destroy(); }
});

test('a socket refused before it opens, again and again, asks the share again', async () => {
  const { room, seen } = attach();
  try {
    for (let i = 0; i < REASK_AFTER_FAILURES; i++) {
      (await nextSocket(i)).drop(1006);
      if (i < REASK_AFTER_FAILURES - 1) assert.deepEqual(seen.end, [], `not after ${i + 1}`);
    }
    assert.deepEqual(seen.end, [{ action: 'reask', code: 1006 }]);
    const n = FakeWS.all.length;
    await tick(900);
    assert.equal(FakeWS.all.length, n, 'and stops trying the old room');
  } finally { room.destroy(); }
});

test('a socket that opened resets the count', async () => {
  const { room, seen } = attach();
  try {
    (await nextSocket(0)).drop(1006);
    (await nextSocket(1)).drop(1006);
    const third = await nextSocket(2);
    third.open();
    third.drop(1006);
    (await nextSocket(3)).drop(1006);
    assert.deepEqual(seen.end, [], 'two failures since it last opened');
  } finally { room.destroy(); }
});

test('it lets go with a status code: the room does not answer an empty close', async () => {
  const { room } = attach();
  let ws;
  try {
    ws = await nextSocket(0);
    ws.open();
  } finally { room.destroy(); }
  assert.deepEqual(ws.closedWith, { code: 1000, reason: 'left' });
});

test('the billing rules of the board client, by source', () => {
  const src = readFileSync(new URL('./docRoomClient.js', import.meta.url), 'utf8');
  assert.equal(KEEPALIVE_MS, 15_000);
  assert.match(src, /new YProvider\(host, room, ydoc, \{\s*party: 'doc',/);
  assert.match(src, /if \(socketLooksDead\(provider\.wsLastMessageReceived, lastPingAt\)\) \{/);
  assert.match(src, /provider\.ws\.send\(encoding\.toUint8Array\(enc\)\);\n      lastPingAt = Date\.now\(\);/);
  assert.match(src, /parkWhileHidden\(\{ park: parkFor\('tab hidden'\), unpark: unparkFor\('tab hidden'\), isBusy: pageBusy \}\)/);
  assert.match(src, /parkWhileIdle\(\{ park: parkFor\('idle'\), unpark: unparkFor\('idle'\), isBusy: pageBusy \}\)/);
  assert.match(src, /closeSocket\('parked'\);\s*try \{ provider\.disconnect\(\); \}/);
  assert.match(src, /closeSocket\('left'\);\s*try \{ provider\.destroy\(\); \}/);
  assert.match(src, /clearInterval\(keepalive\);/);
  assert.doesNotMatch(src, /from '\.\/supabase\.js'/, 'a signed-out page loads it without the auth client');
});
