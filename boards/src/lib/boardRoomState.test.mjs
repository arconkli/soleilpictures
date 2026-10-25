import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import {
  BoardRoomState, readBoardState, writeBoardStateIfUnchanged,
  MERGE_ORIGIN, WRITER_HEADER, WRITER_NAME,
} from './boardRoomState.js';
import { bytesToB64, b64ToBytes } from './boardStateSync.js';

const BOARD = '11111111-2222-3333-4444-555555555555';
const URL0 = 'https://example.supabase.co';

// A board_state table behind just enough of PostgREST: GET by board_id, PATCH
// with an updated_at filter (the compare-and-set), POST with
// ignore-duplicates. `blind()` is any other writer (the old room, a browser).
function fakeTable() {
  const rows = new Map();
  const versions = new Map();   // board_state_version.version
  let clock = Date.parse('2026-10-20T10:00:00.000Z');
  // PostgREST renders timestamptz with an explicit offset, which is exactly the
  // '+' the PATCH filter has to percent-encode.
  const stamp = () => new Date(clock += 1000).toISOString().replace('Z', '+00:00');
  const calls = [];
  let failNext = 0;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    calls.push({ method, url, headers: init.headers || {}, body: init.body });
    if (failNext > 0) { failNext--; return new Response('boom', { status: 503 }); }
    const q = u.searchParams;
    if (method === 'GET' && u.pathname.endsWith('/board_state_version')) {
      const id = q.get('board_id').replace(/^eq\./, '');
      return Response.json(versions.has(id) ? [{ version: versions.get(id) }] : []);
    }
    if (method === 'GET') {
      const id = q.get('board_id').replace(/^eq\./, '');
      const row = rows.get(id);
      const cols = q.get('select').split(',');
      return Response.json(row ? [Object.fromEntries(cols.map((c) => [c, row[c]]))] : []);
    }
    if (method === 'PATCH') {
      const id = q.get('board_id').replace(/^eq\./, '');
      const want = q.get('updated_at').replace(/^eq\./, '');
      const row = rows.get(id);
      if (!row || row.updated_at !== want) return Response.json([]);
      const body = JSON.parse(init.body);
      row.doc = body.doc;
      row.updated_at = stamp();
      return Response.json([{ updated_at: row.updated_at }]);
    }
    if (method === 'POST') {
      const [r] = JSON.parse(init.body);
      if (rows.has(r.board_id)) return Response.json([]);
      rows.set(r.board_id, { doc: r.doc, updated_at: stamp() });
      return Response.json([{ updated_at: rows.get(r.board_id).updated_at }]);
    }
    return new Response('no', { status: 405 });
  };
  return {
    rows, versions, calls, fetchImpl,
    blind(id, doc) { rows.set(id, { doc: bytesToB64(Y.encodeStateAsUpdate(doc)), updated_at: stamp() }); },
    failNext(n = 1) { failNext = n; },
    writes() { return calls.filter((c) => c.method !== 'GET'); },
    bumpVersion(id) { versions.set(id, (versions.get(id) ?? 1) + 1); },
  };
}

function fakeTimers() {
  const pending = new Set();
  return {
    setTimer(fn) { const t = { fn }; pending.add(t); return t; },
    clearTimer(t) { pending.delete(t); },
    async runAll() {
      const due = [...pending];
      pending.clear();
      for (const t of due) await t.fn();
      // let the merge's flush settle
      await new Promise((r) => setTimeout(r, 0));
    },
    get size() { return pending.size; },
  };
}

const docWith = (cards) => {
  const d = new Y.Doc({ gc: false });
  const m = d.getMap('cards');
  for (const [id, title] of Object.entries(cards)) m.set(id, title);
  return d;
};
const cardsOf = (b64) => {
  const d = new Y.Doc({ gc: false });
  Y.applyUpdate(d, b64ToBytes(b64));
  return Object.fromEntries(d.getMap('cards').entries());
};

function room(table, timers, doc, extra = {}) {
  const state = new BoardRoomState({
    boardId: BOARD, supabaseUrl: URL0, serviceRoleKey: 'svc',
    getDoc: () => doc.current, fetchImpl: table.fetchImpl,
    setTimer: timers.setTimer, clearTimer: timers.clearTimer, log: () => {},
    ...extra,
  });
  return state;
}

test('a cold start merges board_state into what the room kept locally', async () => {
  const table = fakeTable();
  table.blind(BOARD, docWith({ a: 'from the database' }));
  const local = docWith({ b: 'kept in the room' });
  const s = room(table, fakeTimers(), { current: local });
  assert.equal(await s.loadInto(local), true);
  assert.deepEqual(Object.fromEntries(local.getMap('cards').entries()), { a: 'from the database', b: 'kept in the room' });
  assert.equal(s.lastSeen, table.rows.get(BOARD).updated_at);
});

test('a flush is a compare-and-set that advances the baseline', async () => {
  const table = fakeTable();
  table.blind(BOARD, docWith({ a: '1' }));
  const doc = { current: new Y.Doc({ gc: false }) };
  const s = room(table, fakeTimers(), doc);
  await s.loadInto(doc.current);
  doc.current.getMap('cards').set('b', '2');
  assert.equal(await s.flush(), true);
  assert.deepEqual(cardsOf(table.rows.get(BOARD).doc), { a: '1', b: '2' });
  assert.equal(s.lastSeen, table.rows.get(BOARD).updated_at);
  const patch = table.writes().at(-1);
  assert.equal(patch.method, 'PATCH');
  // The baseline's '+00:00' must reach PostgREST as %2B, or the filter would
  // never match and every flush would read as a conflict.
  assert.match(patch.url, /updated_at=eq\.[^&]*%2B00%3A00/);
});

test('the same bytes are not written twice', async () => {
  const table = fakeTable();
  const doc = { current: docWith({ a: '1' }) };
  const s = room(table, fakeTimers(), doc);
  await s.loadInto(doc.current);
  assert.equal(await s.flush(), true);
  const n = table.writes().length;
  assert.equal(await s.flush(), false);
  assert.equal(table.writes().length, n);
});

test('another writer is never overwritten: the room waits, merges, then writes the union', async () => {
  const table = fakeTable();
  table.blind(BOARD, docWith({ a: 'shared' }));
  const timers = fakeTimers();
  const doc = { current: new Y.Doc({ gc: false }) };
  const s = room(table, timers, doc);
  await s.loadInto(doc.current);

  // The OLD room (or a browser) writes its own view, which lacks this room's
  // newest card and has one this room never saw.
  const other = docWith({ a: 'shared', old: 'made in the old room' });
  table.blind(BOARD, other);
  doc.current.getMap('cards').set('mine', 'made in the new room');

  assert.equal(await s.flush(), false);                 // conflict: nothing written
  assert.deepEqual(cardsOf(table.rows.get(BOARD).doc), { a: 'shared', old: 'made in the old room' });
  assert.equal(timers.size, 1);                          // merge deferred to the grace window
  assert.equal(await s.flush(), false);                  // and nothing written inside it

  await timers.runAll();
  const stored = cardsOf(table.rows.get(BOARD).doc);
  assert.deepEqual(stored, { a: 'shared', old: 'made in the old room', mine: 'made in the new room' });
  // The other writer's card reached the room's live doc, so its clients see it.
  assert.equal(doc.current.getMap('cards').get('old'), 'made in the old room');
});

test('a reset inside the grace window stops the merge, so a restore is never undone', async () => {
  const table = fakeTable();
  table.blind(BOARD, docWith({ a: '1', b: '2' }));
  const timers = fakeTimers();
  const doc = { current: new Y.Doc({ gc: false }) };
  const s = room(table, timers, doc);
  await s.loadInto(doc.current);
  doc.current.getMap('cards').set('c', '3');

  // bulletproofRestore writes an OLDER version of the board...
  const restored = docWith({ a: '1' });
  table.blind(BOARD, restored);
  const restoredB64 = table.rows.get(BOARD).doc;
  // ...the room's flush lands in the gap before the /reset...
  assert.equal(await s.flush(), false);
  // ...and the /reset arrives.
  s.stop();
  await timers.runAll();
  assert.equal(table.rows.get(BOARD).doc, restoredB64);
  assert.equal(await s.flush({ force: true }), false);
  assert.equal(table.rows.get(BOARD).doc, restoredB64);
});

test('a failed load is not an empty board: the first flush reads before it writes', async () => {
  const table = fakeTable();
  table.blind(BOARD, docWith({ a: 'precious' }));
  const timers = fakeTimers();
  const doc = { current: new Y.Doc({ gc: false }) };
  const s = room(table, timers, doc);
  table.failNext(1);
  assert.equal(await s.loadInto(doc.current), false);
  assert.equal(s.lastSeen, undefined);

  // A client syncs in a little and the debounce fires.
  doc.current.getMap('cards').set('b', 'new');
  assert.equal(await s.flush(), false);
  assert.equal(table.writes().length, 0);               // nothing blind-written
  await timers.runAll();
  assert.deepEqual(cardsOf(table.rows.get(BOARD).doc), { a: 'precious', b: 'new' });
});

test('a failed read during the merge writes nothing', async () => {
  const table = fakeTable();
  table.blind(BOARD, docWith({ a: '1' }));
  const timers = fakeTimers();
  const doc = { current: new Y.Doc({ gc: false }) };
  const s = room(table, timers, doc);
  await s.loadInto(doc.current);
  table.blind(BOARD, docWith({ a: '1', z: 'foreign' }));
  doc.current.getMap('cards').set('b', '2');
  await s.flush();
  const before = table.rows.get(BOARD).doc;
  table.failNext(1);
  await timers.runAll();
  assert.equal(table.rows.get(BOARD).doc, before);
  assert.equal(s.lastSeen, undefined);
  // The next attempt reads again and merges.
  await s.retryIfDirty();
  await timers.runAll();
  assert.deepEqual(cardsOf(table.rows.get(BOARD).doc), { a: '1', z: 'foreign', b: '2' });
});

test('no row yet: the first flush inserts, and a racing insert is merged rather than replaced', async () => {
  const table = fakeTable();
  const timers = fakeTimers();
  const doc = { current: new Y.Doc({ gc: false }) };
  const s = room(table, timers, doc);
  await s.loadInto(doc.current);
  assert.equal(s.lastSeen, null);
  doc.current.getMap('cards').set('a', '1');
  // Someone else creates the row first.
  table.blind(BOARD, docWith({ x: 'theirs' }));
  assert.equal(await s.flush(), false);
  await timers.runAll();
  assert.deepEqual(cardsOf(table.rows.get(BOARD).doc), { a: '1', x: 'theirs' });

  const t2 = fakeTable();
  const d2 = { current: new Y.Doc({ gc: false }) };
  const s2 = room(t2, fakeTimers(), d2);
  await s2.loadInto(d2.current);
  d2.current.getMap('cards').set('a', '1');
  assert.equal(await s2.flush(), true);
  assert.equal(t2.writes()[0].method, 'POST');
});

test('the alarm probe finds a write made while nobody typed, and merges it', async () => {
  const table = fakeTable();
  table.blind(BOARD, docWith({ a: '1' }));
  const timers = fakeTimers();
  const doc = { current: new Y.Doc({ gc: false }) };
  const s = room(table, timers, doc);
  await s.loadInto(doc.current);
  await s.checkForeign();
  assert.equal(timers.size, 0);                          // unchanged: nothing to do
  table.blind(BOARD, docWith({ a: '1', api: 'added by /api/v1' }));
  await s.checkForeign();
  assert.equal(timers.size, 1);
  await timers.runAll();
  assert.equal(doc.current.getMap('cards').get('api'), 'added by /api/v1');
});

test('a deletion carried by the other writer survives the merge, and nothing else is lost', async () => {
  const table = fakeTable();
  const base = docWith({ a: '1', b: '2' });
  table.blind(BOARD, base);
  const timers = fakeTimers();
  const doc = { current: new Y.Doc({ gc: false }) };
  const s = room(table, timers, doc);
  await s.loadInto(doc.current);
  // The other writer started from the same base and deleted b.
  const other = new Y.Doc({ gc: false });
  Y.applyUpdate(other, Y.encodeStateAsUpdate(base));
  other.getMap('cards').delete('b');
  table.blind(BOARD, other);
  doc.current.getMap('cards').set('c', '3');
  await s.flush();
  await timers.runAll();
  assert.deepEqual(cardsOf(table.rows.get(BOARD).doc), { a: '1', c: '3' });
});

test('merges are tagged with the origin opLog skips', async () => {
  // The skip list lives in party/opLog.ts, which node cannot import; read it.
  const opLog = readFileSync(new URL('../../party/opLog.ts', import.meta.url), 'utf8');
  const skip = opLog.match(/const SKIP_ORIGINS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(skip, 'party/opLog.ts no longer declares SKIP_ORIGINS');
  assert.ok(skip[1].includes(JSON.stringify(MERGE_ORIGIN)), `opLog does not skip ${MERGE_ORIGIN}`);

  const table = fakeTable();
  table.blind(BOARD, docWith({ a: '1' }));
  const doc = new Y.Doc({ gc: false });
  const origins = [];
  doc.on('update', (_u, origin) => origins.push(origin));
  const s = room(table, fakeTimers(), { current: doc });
  await s.loadInto(doc);
  assert.deepEqual(origins, [MERGE_ORIGIN]);
});

test('every request names this writer', async () => {
  const table = fakeTable();
  const doc = { current: docWith({ a: '1' }) };
  const s = room(table, fakeTimers(), doc);
  await s.loadInto(doc.current);
  await s.flush();
  assert.ok(table.calls.length >= 2);
  for (const c of table.calls) assert.equal(c.headers[WRITER_HEADER], WRITER_NAME);
});

test('the low-level helpers report failure, never emptiness', async () => {
  const table = fakeTable();
  table.failNext(1);
  const r = await readBoardState({ boardId: BOARD, supabaseUrl: URL0, serviceRoleKey: 'svc', fetchImpl: table.fetchImpl });
  assert.equal(r.ok, false);
  const w = await writeBoardStateIfUnchanged({
    boardId: BOARD, b64: 'AAA=', expected: 'x', supabaseUrl: URL0, serviceRoleKey: 'svc',
    fetchImpl: async () => { throw new Error('network'); },
  });
  assert.deepEqual([w.ok, w.conflict], [false, false]);
  const none = await readBoardState({ boardId: BOARD, supabaseUrl: URL0, serviceRoleKey: '', fetchImpl: table.fetchImpl });
  assert.equal(none.ok, false);
});

test('a restore is recognised by its marker and resets the room instead of merging', async () => {
  const table = fakeTable();
  table.versions.set(BOARD, 3);
  table.blind(BOARD, docWith({ a: '1', b: '2' }));
  const timers = fakeTimers();
  const doc = { current: new Y.Doc({ gc: false }) };
  let resets = 0;
  const s = room(table, timers, doc, { onRestore: () => { resets++; } });
  await s.loadInto(doc.current);
  assert.equal(s.versionBaseline, 3);
  doc.current.getMap('cards').set('c', '3');

  // bulletproofRestore: write the older version, then advance the marker. Its
  // /reset never arrives.
  table.blind(BOARD, docWith({ a: '1' }));
  const restored = table.rows.get(BOARD).doc;
  table.bumpVersion(BOARD);
  await s.flush();
  await timers.runAll();
  assert.equal(resets, 1);
  assert.equal(table.rows.get(BOARD).doc, restored);       // neither merged nor overwritten
  assert.equal(await s.flush({ force: true }), false);      // and the room has stopped writing
  assert.equal(table.rows.get(BOARD).doc, restored);
});

test('a marker that cannot be read is never taken for a restore', async () => {
  const table = fakeTable();
  table.versions.set(BOARD, 3);
  table.blind(BOARD, docWith({ a: '1' }));
  const timers = fakeTimers();
  const doc = { current: new Y.Doc({ gc: false }) };
  let resets = 0;
  const s = room(table, timers, doc, { onRestore: () => { resets++; } });
  // The version read fails at load (the board_state read succeeds).
  const realFetch = table.fetchImpl;
  s.cfg.fetchImpl = async (url, init) => (String(url).includes('board_state_version') ? new Response('x', { status: 500 }) : realFetch(url, init));
  await s.loadInto(doc.current);
  assert.equal(s.versionBaseline, undefined);
  s.cfg.fetchImpl = realFetch;
  table.bumpVersion(BOARD);
  table.blind(BOARD, docWith({ a: '1', z: 'foreign' }));
  doc.current.getMap('cards').set('b', '2');
  await s.flush();
  await timers.runAll();
  assert.equal(resets, 0);
  assert.deepEqual(cardsOf(table.rows.get(BOARD).doc), { a: '1', z: 'foreign', b: '2' });
});

test('inside the fence after a reset, a stale echo is overwritten, not merged', async () => {
  const table = fakeTable();
  table.blind(BOARD, docWith({ a: 'restored' }));
  const timers = fakeTimers();
  let t = 1_000_000;
  const doc = { current: new Y.Doc({ gc: false }) };
  const s = room(table, timers, doc, { fenceUntil: t + 30_000, clock: () => t });
  await s.loadInto(doc.current);
  // The frozen old room's pending debounced flush lands with the board as it
  // was BEFORE the restore.
  table.blind(BOARD, docWith({ a: 'restored', gone: 'removed by the restore' }));
  doc.current.getMap('cards').set('after', 'typed after the restore');
  await s.flush();
  await timers.runAll();
  assert.deepEqual(cardsOf(table.rows.get(BOARD).doc), { a: 'restored', after: 'typed after the restore' });
  assert.equal(doc.current.getMap('cards').has('gone'), false);

  // After the fence, foreign writes merge again.
  t += 31_000;
  table.blind(BOARD, docWith({ a: 'restored', later: 'a real edit from elsewhere' }));
  await s.checkForeign();
  await timers.runAll();
  assert.equal(doc.current.getMap('cards').get('later'), 'a real edit from elsewhere');
});

test('a browser saving exactly the room\'s document costs one read and no write', async () => {
  const table = fakeTable();
  const timers = fakeTimers();
  const doc = { current: docWith({ a: '1' }) };
  const s = room(table, timers, doc);
  await s.loadInto(doc.current);
  await s.flush();
  // A connected browser's backstop: the same doc, re-encoded on its side.
  const browser = new Y.Doc({ gc: false });
  Y.applyUpdate(browser, Y.encodeStateAsUpdate(doc.current));
  table.blind(BOARD, browser);
  const before = table.writes().length;
  await s.checkForeign();
  await timers.runAll();
  assert.equal(table.writes().length, before);
  assert.equal(s.lastSeen, table.rows.get(BOARD).updated_at);
  // ...and the next real edit goes through on the first try.
  doc.current.getMap('cards').set('b', '2');
  assert.equal(await s.flush(), true);
});

// ── What the room reports (party/report.ts records it) ──────────────────────

const reports = () => {
  const seen = [];
  return { seen, report: (kind, info) => seen.push({ kind, ...info }) };
};

test('saves that keep failing are reported once, at the third, and a save ends the streak', async () => {
  const table = fakeTable();
  table.blind(BOARD, docWith({ a: '1' }));
  const doc = { current: new Y.Doc({ gc: false }) };
  const r = reports();
  const s = room(table, fakeTimers(), doc, { report: r.report });
  await s.loadInto(doc.current);
  doc.current.getMap('cards').set('b', '2');
  table.failNext(3);
  for (let i = 0; i < 3; i++) assert.equal(await s.flush(), false);
  assert.equal(r.seen.length, 1);
  // The browser's kind: 0581's saves rule counts it, the board for the person.
  assert.equal(r.seen[0].kind, 'save');
  assert.equal(r.seen[0].op, 'room_flush');
  assert.equal(r.seen[0].boardId, BOARD);
  assert.equal(r.seen[0].attempt, 3);
  // What serverErrors.js reads: the call, its status, the body for its code.
  assert.match(r.seen[0].error.message, /^write board_state 503: /);
  table.failNext(1);
  assert.equal(await s.flush(), false);
  assert.equal(r.seen.length, 1, 'one report per streak');
  assert.equal(await s.flush(), true);
  doc.current.getMap('cards').set('c', '3');
  table.failNext(3);
  for (let i = 0; i < 3; i++) await s.flush();
  assert.equal(r.seen.length, 2, 'a new streak is reported again');
});

test('a board left unsaved past two minutes is reported once, from the alarm', async () => {
  let t = Date.parse('2026-10-24T10:00:00.000Z');
  const table = fakeTable();
  table.blind(BOARD, docWith({ a: '1' }));
  const doc = { current: new Y.Doc({ gc: false }) };
  const r = reports();
  const s = room(table, fakeTimers(), doc, { report: r.report, clock: () => t });
  await s.loadInto(doc.current);
  doc.current.getMap('cards').set('b', '2');
  const unsaved = () => r.seen.filter((x) => x.what === 'board unsaved');
  table.failNext(1);
  await s.flush();
  t += 60_000; table.failNext(1); await s.retryIfDirty();
  assert.equal(unsaved().length, 0);
  t += 61_000; table.failNext(1); await s.retryIfDirty();
  assert.equal(unsaved().length, 1);
  assert.equal(unsaved()[0].kind, 'save');
  assert.equal(unsaved()[0].op, 'room_flush');
  assert.ok(unsaved()[0].ms >= 120_000);
  t += 60_000; table.failNext(1); await s.retryIfDirty();
  assert.equal(unsaved().length, 1, 'once per streak');
  // Saved at last: the next streak starts its own clock.
  await s.retryIfDirty();
  assert.equal(s.dirty, false);
  assert.equal(s.dirtySince, null);
});

test('a board that cannot be read when its room starts is reported, and a reporter that throws stops nothing', async () => {
  const table = fakeTable();
  table.blind(BOARD, docWith({ a: '1' }));
  const doc = { current: new Y.Doc({ gc: false }) };
  const r = reports();
  const s = room(table, fakeTimers(), doc, { report: r.report });
  table.failNext(1);
  assert.equal(await s.loadInto(doc.current), false);
  assert.equal(r.seen.length, 1);
  assert.equal(r.seen[0].kind, 'room_load');
  assert.match(r.seen[0].error.message, /^read board_state 503: /);

  const t2 = fakeTable();
  t2.blind(BOARD, docWith({ a: '1' }));
  const d2 = { current: new Y.Doc({ gc: false }) };
  const s2 = room(t2, fakeTimers(), d2, { report: () => { throw new Error('the reporter broke'); } });
  await s2.loadInto(d2.current);
  d2.current.getMap('cards').set('b', '2');
  t2.failNext(3);
  for (let i = 0; i < 3; i++) assert.equal(await s2.flush(), false);
  assert.equal(await s2.flush(), true);
});
