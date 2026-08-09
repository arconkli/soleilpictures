// boardStateSync — the room's board_state load/flush.
//
// This module decides what gets written over a user's board, so the tests that
// matter are the ones about NOT losing content: an unreachable database must
// not read as an empty board, and a flush must never be a subset of what is
// already stored.
//
// The load-before-storage ordering these tests rely on is y-partykit's, and it
// is load-bearing: dist/index.js awaits `options.load()` and applies its state
// into the doc, and only then calls `bindState()` to apply DO storage. Both are
// Yjs merges, so the room starts at board_state ∪ DO-storage. `simulateBoot`
// below reproduces exactly that sequence.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  loadBoardState, flushBoardState, boardStateSync, bytesToB64, b64ToBytes,
} from './boardStateSync.js';

const BOARD = '11111111-2222-3333-4444-555555555555';
const KEY = 'service-role-test-key';

const docWithCards = (ids) => {
  const doc = new Y.Doc();
  const cards = doc.getMap('cards');
  doc.transact(() => {
    for (const id of ids) {
      const m = new Y.Map();
      m.set('id', id);
      m.set('kind', 'note');
      m.set('body', `card ${id}`);
      cards.set(id, m);
    }
  });
  return doc;
};

const snapshotOf = (doc) => bytesToB64(Y.encodeStateAsUpdate(doc));
const cardIds = (doc) => [...doc.getMap('cards').keys()].sort();

// A stub PostgREST. Records every write and can be told to fail.
function stubDb({ stored = null, loadStatus = 200, writeStatus = 201 } = {}) {
  const writes = [];
  const db = {
    writes,
    get stored() { return stored; },
    fetchImpl: async (url, init = {}) => {
      if ((init.method || 'GET') === 'GET') {
        if (loadStatus !== 200) return { ok: false, status: loadStatus };
        return { ok: true, status: 200, json: async () => (stored ? [{ doc: stored }] : []) };
      }
      const body = JSON.parse(init.body);
      writes.push(body[0]);
      if (writeStatus >= 300) {
        return { ok: false, status: writeStatus, text: async () => 'nope' };
      }
      stored = body[0].doc;
      return { ok: true, status: writeStatus };
    },
  };
  return db;
}

const opts = (db, extra = {}) => ({
  boardId: BOARD, supabaseUrl: 'http://stub', serviceRoleKey: KEY,
  fetchImpl: db.fetchImpl, seen: new Map(), ...extra,
});

// Reproduce y-partykit's construction order: load() → applyUpdate, then
// bindState() → applyUpdate of DO storage.
async function simulateBoot({ storedB64, doStorageDoc, o }) {
  const doc = new Y.Doc();
  const loaded = await loadBoardState(o);
  if (loaded) Y.applyUpdate(doc, Y.encodeStateAsUpdate(loaded));
  if (doStorageDoc) Y.applyUpdate(doc, Y.encodeStateAsUpdate(doStorageDoc));
  return doc;
}

test('base64 round-trips a document larger than the spread-argument limit', () => {
  const doc = new Y.Doc();
  const cards = doc.getMap('cards');
  // ~1MB of document, well past the ~100KB where String.fromCharCode(...bytes)
  // throws RangeError. This is the size real boards reach.
  doc.transact(() => {
    for (let i = 0; i < 400; i++) {
      const m = new Y.Map();
      m.set('id', `c${i}`);
      m.set('body', 'x'.repeat(2500));
      cards.set(`c${i}`, m);
    }
  });
  const bytes = Y.encodeStateAsUpdate(doc);
  assert.ok(bytes.length > 500_000, `expected a big doc, got ${bytes.length}`);
  assert.deepEqual(b64ToBytes(bytesToB64(bytes)), bytes);
});

test('a room boots with board_state applied before its own storage', async () => {
  const stored = snapshotOf(docWithCards(['a', 'b', 'c']));
  const db = stubDb({ stored });
  const doc = await simulateBoot({ o: opts(db) });
  assert.deepEqual(cardIds(doc), ['a', 'b', 'c']);
});

test('boot merges board_state with whatever DO storage still held', async () => {
  const db = stubDb({ stored: snapshotOf(docWithCards(['a', 'b'])) });
  // The DO kept a doc that has one card the database has not seen yet.
  const doc = await simulateBoot({ doStorageDoc: docWithCards(['b', 'z']), o: opts(db) });
  assert.deepEqual(cardIds(doc), ['a', 'b', 'z'], 'the union, never one or the other');
});

test('an unreachable database is NOT an empty board', async () => {
  const db = stubDb({ stored: snapshotOf(docWithCards(['a', 'b'])), loadStatus: 500 });
  const loaded = await loadBoardState(opts(db));
  assert.equal(loaded, null,
    'load must return null so y-partykit keeps DO storage — an empty doc here erases the board');
});

test('a board with no stored row loads as null, not as an empty doc', async () => {
  const db = stubDb({ stored: null });
  assert.equal(await loadBoardState(opts(db)), null);
});

test('no service-role key disables the sync entirely rather than writing', async () => {
  const db = stubDb({ stored: snapshotOf(docWithCards(['a'])) });
  const o = opts(db, { serviceRoleKey: undefined });
  assert.equal(await loadBoardState(o), null);
  assert.equal(await flushBoardState(docWithCards(['a']), o), false);
  assert.equal(db.writes.length, 0);
});

test('a flush writes the whole document back', async () => {
  const db = stubDb({ stored: null });
  const o = opts(db);
  const doc = docWithCards(['a', 'b']);
  assert.equal(await flushBoardState(doc, o), true);
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].board_id, BOARD);

  const round = new Y.Doc();
  Y.applyUpdate(round, b64ToBytes(db.writes[0].doc));
  assert.deepEqual(cardIds(round), ['a', 'b']);
});

test('a flush that changes nothing does not write', async () => {
  const stored = snapshotOf(docWithCards(['a', 'b', 'c']));
  const db = stubDb({ stored });
  const o = opts(db);

  // Booting seeds the dedupe cache from what was read.
  const doc = await simulateBoot({ o });
  assert.equal(await flushBoardState(doc, o), false, 'a cold-load sync must not write back');
  assert.equal(db.writes.length, 0);

  // A real edit still writes.
  doc.getMap('cards').set('d', new Y.Map());
  assert.equal(await flushBoardState(doc, o), true);
  assert.equal(db.writes.length, 1);
});

test('a failed write is not remembered, so the next flush retries it', async () => {
  const db = stubDb({ stored: null, writeStatus: 503 });
  const o = opts(db);
  const doc = docWithCards(['a']);
  assert.equal(await flushBoardState(doc, o), false);
  assert.equal(await flushBoardState(doc, o), false);
  assert.equal(db.writes.length, 2, 'the same state must be retried after a failure');
});

test('a deletion survives the merge and lands in the flush', async () => {
  const db = stubDb({ stored: snapshotOf(docWithCards(['a', 'b', 'c'])) });
  const o = opts(db);
  const doc = await simulateBoot({ o });

  doc.getMap('cards').delete('b');
  assert.equal(await flushBoardState(doc, o), true);

  const round = new Y.Doc();
  Y.applyUpdate(round, b64ToBytes(db.writes[0].doc));
  assert.deepEqual(cardIds(round), ['a', 'c'],
    'a Yjs delete is an operation, not an absence — it must not be re-added by the load merge');
});

test('a flushed document re-loads as itself on the next boot', async () => {
  const db = stubDb({ stored: null });
  const o = opts(db);
  const doc = docWithCards(['a', 'b']);
  doc.getMap('cards').delete('a');
  await flushBoardState(doc, o);

  const next = await simulateBoot({ o: opts(db) });
  assert.deepEqual(cardIds(next), ['b']);
});

test('boardStateSync hands y-partykit the option shape it reads', () => {
  const db = stubDb({ stored: null });
  const o = boardStateSync({
    boardId: BOARD, supabaseUrl: 'http://stub', serviceRoleKey: KEY, fetchImpl: db.fetchImpl,
  });
  assert.equal(typeof o.load, 'function');
  assert.equal(typeof o.callback.handler, 'function');
  // lodash.debounce(fn, wait, {maxWait}) — a trailing flush after editing stops
  // and a guaranteed one during a continuous edit.
  assert.ok(o.callback.debounceWait > 0);
  assert.ok(o.callback.debounceMaxWait > o.callback.debounceWait);
});

test('two boards sharing an isolate do not share a dedupe cache', async () => {
  const db = stubDb({ stored: null });
  const a = boardStateSync({ boardId: 'board-a', supabaseUrl: 'http://stub', serviceRoleKey: KEY, fetchImpl: db.fetchImpl });
  const b = boardStateSync({ boardId: 'board-b', supabaseUrl: 'http://stub', serviceRoleKey: KEY, fetchImpl: db.fetchImpl });
  const doc = docWithCards(['same']);
  await a.callback.handler(doc);
  await b.callback.handler(doc);
  assert.deepEqual(db.writes.map((w) => w.board_id), ['board-a', 'board-b'],
    'identical content on a different board is still a write that board needs');
});
