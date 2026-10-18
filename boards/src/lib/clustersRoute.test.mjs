// /api/clusters/* (worker-clusters.js) — the sidebar's writes to clusters that
// aren't open. These run with the service role underneath, so what is pinned
// here is everything that stands in front of it: who may call, which clusters
// they may touch, and the move that refuses rather than half-happens.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { handleClustersRoute, landCards, PATCHABLE } from '../worker-clusters.js';
import { moveCardsBetweenBoards, deleteCardsFromBoard, addCardsToBoard } from './scoutBoard.js';
import { isStillUploading } from './abandonedUploads.js';
import { cardToYMap, readCards } from './yhelpers.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const WS = 'ws-1';

// Fakes that record every call. Boards A and B share a workspace, C does not.
function fakeDeps({ writable = [A, B, C], user = { ok: true, userId: 'u1' }, move, add } = {}) {
  const calls = [];
  const rec = (name, fn) => async (...args) => { calls.push({ name, args }); return fn(...args); };
  const boards = { [A]: WS, [B]: WS, [C]: 'ws-2' };
  const deps = {
    verifyUser: rec('verifyUser', async () => user),
    userSelect: rec('userSelect', async (_env, _t, table, q) => {
      const id = /id=eq\.([0-9a-f-]+)/.exec(q)?.[1];
      return table === 'boards' && boards[id] ? [{ id, workspace_id: boards[id], name: 'x' }] : [];
    }),
    userRpc: rec('userRpc', async (_env, _t, fn, p) => fn === 'can_write_board' && writable.includes(p.p_board_id)),
    moveCardsBetweenBoards: rec('move', move || (async () => ({
      count: 1, pairs: [{ from: 'c1', to: 'c1' }], live: true,
      originals: [{ id: 'c1', x: 1, y: 2, unplaced: false }], kept: [],
    }))),
    addCardsToBoard: rec('add', add || (async (_env, o) => ({ cards: o.buildCards([]), live: true }))),
    updateCardsOnBoard: rec('update', async (_env, o) => o.patches.map(() => ({}))),
    deleteCardsFromBoard: rec('delete', async (_env, o) => o.cardIds.map((id) => ({ id, kind: 'note' }))),
    readBoardCardsChecked: rec('read', async () => ({
      loaded: true,
      cards: [
        { id: 'p1', kind: 'image', src: 'r2:p1', w: 100, h: 80, x: 0, y: 0, groupId: 'g' },
        { id: 'd1', kind: 'doc', title: 'Script', w: 300, h: 400 },
        { id: 'up', kind: 'image', pending: true, w: 10, h: 10 },
      ],
    })),
    scoutPatch: rec('scoutPatch', async () => null),
    repointCardMeta: rec('repointMeta', async () => null),
  };
  return { deps, calls, named: (n) => calls.filter((c) => c.name === n) };
}

function req(path, body, { method = 'POST', token = 'tok' } = {}) {
  const url = new URL(`https://app.test${path}`);
  const request = new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  return [url, request];
}

const call = async (deps, path, body, opts) => {
  const res = await handleClustersRoute(...req(path, body, opts), {}, deps);
  return { status: res.status, body: await res.json() };
};

test('nobody signed out gets past the door, and nothing is written', async () => {
  const { deps, calls } = fakeDeps({ user: { ok: false, status: 401, error: 'missing bearer token' } });
  const r = await call(deps, '/api/clusters/move', { from: A, to: B, cardIds: ['c1'] }, { token: null });
  assert.equal(r.status, 401);
  assert.deepEqual(calls.map((c) => c.name), ['verifyUser']);
});

test('only POST, only the four routes', async () => {
  const { deps } = fakeDeps();
  assert.equal((await call(deps, '/api/clusters/move', null, { method: 'GET' })).status, 405);
  assert.equal((await call(deps, '/api/clusters/nope', {})).status, 404);
});

test('a move asks to WRITE both clusters, as the user, before touching either', async () => {
  const { deps, named } = fakeDeps({ writable: [B] });
  const r = await call(deps, '/api/clusters/move', { from: A, to: B, cardIds: ['c1'] });
  assert.equal(r.status, 403);
  assert.equal(named('move').length, 0);
  const asked = named('userRpc').map((c) => c.args[3].p_board_id).sort();
  assert.deepEqual(asked, [A, B].sort());
});

test('v1 keeps moves inside one workspace', async () => {
  const { deps, named } = fakeDeps();
  const r = await call(deps, '/api/clusters/move', { from: A, to: C, cardIds: ['c1'] });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'cross_workspace');
  assert.equal(named('move').length, 0);
});

test('a cluster the user cannot see is a 404, not a write', async () => {
  const { deps, named } = fakeDeps();
  const ghost = '44444444-4444-4444-8444-444444444444';
  const r = await call(deps, '/api/clusters/move', { from: A, to: ghost, cardIds: ['c1'] });
  assert.equal(r.status, 404);
  assert.equal(named('move').length, 0);
});

test('bad input is refused before anything runs', async () => {
  const { deps, named } = fakeDeps();
  assert.equal((await call(deps, '/api/clusters/move', { from: 'x', to: B, cardIds: ['c1'] })).status, 400);
  assert.equal((await call(deps, '/api/clusters/move', { from: A, to: A, cardIds: ['c1'] })).status, 400);
  assert.equal((await call(deps, '/api/clusters/move', { from: A, to: B, cardIds: [] })).status, 400);
  const many = Array.from({ length: 501 }, (_, i) => `c${i}`);
  assert.equal((await call(deps, '/api/clusters/move', { from: A, to: B, cardIds: many })).status, 413);
  assert.equal((await call(deps, '/api/clusters/move', { from: A, to: B, cardIds: ['c'], at: { x: 'a', y: 1 } })).status, 400);
  assert.equal(named('move').length, 0);
});

test('a move demands live rooms, keeps uploads back, and takes comments and stars along', async () => {
  const { deps, named } = fakeDeps();
  const r = await call(deps, '/api/clusters/move', { from: A, to: B, cardIds: ['c1'] });
  assert.equal(r.status, 200);
  const [args] = named('move')[0].args.slice(1);
  assert.equal(args.requireLive, true);
  assert.equal(args.keep, isStillUploading);
  assert.equal(args.fromBoardId, A);
  assert.equal(args.toBoardId, B);
  assert.equal(named('repointMeta').length, 1);
  const patched = named('scoutPatch').map((c) => c.args[1]).sort();
  assert.deepEqual(patched, ['comments', 'starred_items']);
  const starPatch = named('scoutPatch').find((c) => c.args[1] === 'starred_items');
  assert.match(starPatch.args[2], new RegExp(`board_id=eq\\.${A}`));
  assert.deepEqual(starPatch.args[3], { board_id: B, card_id: 'c1' });
  assert.deepEqual(r.body.originals, [{ id: 'c1', x: 1, y: 2, unplaced: false }]);
});

test('a move the rooms could not take comes back as try-again, with nothing repointed', async () => {
  const { deps, named } = fakeDeps({
    move: async () => { const e = new Error('nope'); e.code = 'room_unavailable'; throw e; },
  });
  const r = await call(deps, '/api/clusters/move', { from: A, to: B, cardIds: ['c1'] });
  assert.equal(r.status, 503);
  assert.equal(r.body.retry, true);
  assert.equal(named('repointMeta').length, 0);
  assert.equal(named('scoutPatch').length, 0);
});

test('a copy only needs to write the destination, and copies only what a snapshot can carry', async () => {
  const { deps, named } = fakeDeps({ writable: [B] });
  const r = await call(deps, '/api/clusters/move', { from: A, to: B, cardIds: ['p1', 'd1', 'up'], mode: 'copy' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.copied, 1);
  assert.deepEqual(r.body.skipped.sort(), ['d1', 'up']);
  const built = named('add')[0].args[1].buildCards([]);
  assert.equal(built.length, 1);
  assert.notEqual(built[0].id, 'p1', 'a copy is a new card');
  assert.deepEqual(built[0].sourceRef, { boardId: A, cardId: 'p1' });
  assert.equal(built[0].src, 'r2:p1', 'the same stored file');
  assert.equal(built[0].groupId, undefined, 'place fields stay behind');
  assert.equal(built[0].unplaced, true, 'dropped on a cluster, so stored off the board');
});

test('a copy past the card cap is a 402', async () => {
  const { deps } = fakeDeps({ add: async () => { const e = new Error('cap'); e.isCapHit = true; throw e; } });
  const r = await call(deps, '/api/clusters/move', { from: A, to: B, cardIds: ['p1'], mode: 'copy' });
  assert.equal(r.status, 402);
  assert.equal(r.body.error, 'limit_reached');
});

test('append keeps an upload\'s own ids and stores loose cards off the board', async () => {
  const { deps, named } = fakeDeps();
  const r = await call(deps, '/api/clusters/append', {
    boardId: B,
    cards: [
      { id: 'up-1', kind: 'image', pending: true, w: 120, h: 90 },
      { id: 'back', kind: 'note', html: '<p>hi</p>', x: 5, y: 6, w: 100, h: 100 },
      { kind: 'file', fileName: 'a.zip', w: 200, h: 120 },
    ],
  });
  assert.equal(r.status, 200);
  const built = named('add')[0].args[1].buildCards([]);
  const byId = Object.fromEntries(built.map((c) => [c.id, c]));
  assert.equal(byId['up-1'].unplaced, true);
  assert.equal(byId.back.x, 5, 'a restored card keeps its place');
  assert.equal(built.length, 3);
  assert.ok(built.every((c) => typeof c.id === 'string' && c.id.length > 0), 'every card has an id');
});

test('append refuses clusters-as-cards and oversized batches', async () => {
  const { deps } = fakeDeps();
  assert.equal((await call(deps, '/api/clusters/append', { boardId: B, cards: [{ kind: 'board' }] })).status, 400);
  const many = Array.from({ length: 201 }, () => ({ kind: 'note' }));
  assert.equal((await call(deps, '/api/clusters/append', { boardId: B, cards: many })).status, 413);
});

test('patch writes only an upload\'s own fields', async () => {
  const { deps, named } = fakeDeps();
  const r = await call(deps, '/api/clusters/patch', {
    boardId: B, patches: [{ id: 'up-1', fields: { src: 'r2:k', pending: false, x: 9, kind: 'note', id: 'evil' } }],
  });
  assert.equal(r.status, 200);
  const [{ cardId, patch }] = named('update')[0].args[1].patches;
  assert.equal(cardId, 'up-1');
  assert.deepEqual(patch, { src: 'r2:k', pending: false });
  for (const k of Object.keys(patch)) assert.ok(PATCHABLE.has(k));
});

test('remove hands back the whole cards, for the undo', async () => {
  const { deps } = fakeDeps();
  const r = await call(deps, '/api/clusters/remove', { boardId: B, cardIds: ['n1'] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.removed, [{ id: 'n1', kind: 'note' }]);
});

test('remove, append, patch and copy all demand a live room; append skips what is already there', async () => {
  const { deps, named } = fakeDeps();
  await call(deps, '/api/clusters/remove', { boardId: B, cardIds: ['n1'] });
  await call(deps, '/api/clusters/append', { boardId: B, cards: [{ id: 'a', kind: 'note' }] });
  await call(deps, '/api/clusters/patch', { boardId: B, patches: [{ id: 'a', fields: { src: 'r2:x' } }] });
  await call(deps, '/api/clusters/move', { from: A, to: B, cardIds: ['p1'], mode: 'copy' });
  assert.equal(named('delete')[0].args[1].requireLive, true);
  assert.equal(named('update')[0].args[1].requireLive, true);
  const [append, copy] = named('add').map((c) => c.args[1]);
  assert.equal(append.requireLive, true);
  assert.equal(append.skipExisting, true);
  assert.equal(copy.requireLive, true);
});

test('append refuses ids that are not short strings', async () => {
  const { deps, named } = fakeDeps();
  assert.equal((await call(deps, '/api/clusters/append', { boardId: B, cards: [{ id: 7, kind: 'note' }] })).status, 400);
  assert.equal((await call(deps, '/api/clusters/append', { boardId: B, cards: [{ id: 'x'.repeat(201), kind: 'note' }] })).status, 400);
  assert.equal(named('add').length, 0);
});

test('a move that landed but could not leave the source says so, with the pairs, and repoints nothing yet', async () => {
  const { deps, named } = fakeDeps({
    move: async () => ({ partial: true, count: 1, pairs: [{ from: 'c1', to: 'c1' }], originals: [], kept: [] }),
  });
  const r = await call(deps, '/api/clusters/move', { from: A, to: B, cardIds: ['c1'] });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'partial');
  assert.equal(r.body.retry, true);
  assert.deepEqual(r.body.pairs, [{ from: 'c1', to: 'c1' }]);
  assert.equal(named('repointMeta').length, 0);
  assert.equal(named('scoutPatch').length, 0);
});

test('landing: undo puts cards back exactly, a drop point places them, a cluster stores them', () => {
  const existing = [{ id: 'e', kind: 'image', x: 0, y: 0, w: 100, h: 100 }];
  const cards = [
    { id: 'p', kind: 'image', x: 0, y: 0, w: 100, h: 80 },
    { id: 'd', kind: 'doc', x: 0, y: 0, w: 300, h: 400 },
  ];
  const back = landCards(existing, cards, { restore: [{ id: 'p', x: 40, y: 50, unplaced: true }, { id: 'd', x: 7, y: 8, unplaced: true }] });
  const byId = Object.fromEntries(back.map((c) => [c.id, c]));
  assert.deepEqual([byId.p.x, byId.p.y, byId.p.unplaced], [40, 50, true]);
  assert.equal(byId.d.unplaced, false, 'a doc can never be stored off the board');

  const dropped = landCards(existing, cards, { at: { x: 500, y: 500 } });
  assert.ok(dropped.every((c) => c.unplaced === false));

  const stored = landCards(existing, cards);
  const s = Object.fromEntries(stored.map((c) => [c.id, c]));
  assert.equal(s.p.unplaced, true);
  assert.equal(s.d.unplaced, false);
  assert.ok(s.p.y >= 100, 'below what is already there');
});

// ── The fail-closed move, for real ──────────────────────────────────────────
// No room answers (the WebSocket errors), so both boards come back not-live.
// With requireLive the move must refuse BEFORE its first write: no version
// row, no board_state, no card_index — only the reads that found that out.
test('requireLive refuses before the first write when a room is unreachable', async (t) => {
  const seen = [];
  const realFetch = globalThis.fetch;
  const RealWS = globalThis.WebSocket;
  t.after(() => { globalThis.fetch = realFetch; globalThis.WebSocket = RealWS; });
  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    seen.push({ method, url: String(url) });
    if (method === 'GET' && String(url).includes('/rest/v1/boards?')) {
      return new Response(JSON.stringify([{ id: A, workspace_id: WS }, { id: B, workspace_id: WS }]), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  };
  globalThis.WebSocket = class {
    constructor() { this.l = {}; setTimeout(() => (this.l.error || []).forEach((f) => f()), 0); }
    addEventListener(type, fn) { (this.l[type] ||= []).push(fn); }
    close() {}
  };
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', PARTY_HOST: 'party.test' };

  await assert.rejects(
    moveCardsBetweenBoards(env, {
      fromBoardId: A, toBoardId: B, workspaceId: WS, userId: 'u1', accessToken: 'tok',
      cardIds: ['c1'], requireLive: true, layout: async (_e, m) => m,
    }),
    (e) => e.code === 'room_unavailable',
  );
  const writes = seen.filter((s) => s.method !== 'GET');
  assert.deepEqual(writes, [], 'not one write left the worker');
});

// ── A room that answers like y-partyserver ──────────────────────────────────
// Sends its state vector on connect, answers a syncStep1 with a syncStep2 and
// applies updates — except on a read-only connection, where it drops them
// without a word, exactly as y-partyserver does. `readOnly(n)` decides per
// connection (n counts from 0 per room). board_state reads come back empty, so
// each room is the whole truth; every REST write is recorded.
function fakeRooms(t, spec) {
  const rooms = {};
  for (const [id, s] of Object.entries(spec)) {
    const doc = new Y.Doc();
    doc.transact(() => { const m = doc.getMap('cards'); for (const c of s.cards || []) m.set(c.id, cardToYMap(c)); });
    rooms[id] = { doc, s, n: 0 };
  }
  const writes = [];
  const realFetch = globalThis.fetch;
  const RealWS = globalThis.WebSocket;
  t.after(() => { globalThis.fetch = realFetch; globalThis.WebSocket = RealWS; });
  globalThis.fetch = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const u = String(url);
    if (method === 'GET' && u.includes('/rest/v1/boards?')) {
      return new Response(JSON.stringify(Object.keys(spec).map((id) => ({ id, workspace_id: WS }))), { status: 200 });
    }
    if (method !== 'GET') writes.push({ method, table: /\/rest\/v1\/([a-z_]+)/.exec(u)?.[1], url: u });
    return new Response('[]', { status: 200 });
  };
  globalThis.WebSocket = class {
    constructor(url) {
      this.l = {};
      this.room = rooms[decodeURIComponent(/\/parties\/main\/([^?]+)/.exec(url)[1])];
      setTimeout(() => {
        if (!this.room || this.room.s.down) { this.emit('error'); return; }
        this.ro = !!this.room.s.readOnly?.(this.room.n++);
        this.open = true;
        this.emit('open');
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0);
        syncProtocol.writeSyncStep1(enc, this.room.doc);
        this.deliver(encoding.toUint8Array(enc));
      }, 0);
    }
    emit(type, evt = {}) { for (const f of [...(this.l[type] || [])]) f(evt); }
    deliver(b) {
      setTimeout(() => { if (this.open) this.emit('message', { data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }); }, 0);
    }
    addEventListener(type, fn) { (this.l[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this.l[type] = (this.l[type] || []).filter((f) => f !== fn); }
    send(data) {
      const bytes = new Uint8Array(data);
      setTimeout(() => {
        if (!this.open) return;
        const dec = decoding.createDecoder(bytes);
        if (decoding.readVarUint(dec) !== 0) return;
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 0);
        const step = decoding.readVarUint(dec);
        if (step === 0) syncProtocol.readSyncStep1(dec, enc, this.room.doc);
        else if (step === 1) { if (!this.ro) syncProtocol.readSyncStep2(dec, this.room.doc, 'peer'); }
        else if (step === 2) { if (!this.ro) syncProtocol.readUpdate(dec, this.room.doc, 'peer'); }
        if (encoding.length(enc) > 1) this.deliver(encoding.toUint8Array(enc));
      }, 0);
    }
    close() { if (!this.open) return; this.open = false; setTimeout(() => this.emit('close'), 0); }
  };
  const ids = (id) => readCards(rooms[id].doc).map((c) => String(c.id)).sort();
  const card = (id, cardId) => readCards(rooms[id].doc).find((c) => String(c.id) === cardId);
  const wrote = (table) => writes.filter((w) => w.table === table);
  return { rooms, writes, ids, card, wrote };
}

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'svc', PARTY_HOST: 'party.test' };
const note = (id) => ({ id, kind: 'note', html: `<p>${id}</p>`, x: 0, y: 0, w: 100, h: 100 });
const moveOne = (extra = {}) => moveCardsBetweenBoards(ENV, {
  fromBoardId: A, toBoardId: B, workspaceId: WS, userId: 'u1', accessToken: 'tok',
  cardIds: ['c1'], requireLive: true, layout: async (_e, m) => m, ...extra,
});

test('a confirmed move: the card is in the destination room and gone from the source room', async (t) => {
  const f = fakeRooms(t, { [A]: { cards: [note('c1'), note('c2')] }, [B]: { cards: [note('b1')] } });
  const r = await moveOne();
  assert.equal(r.partial, undefined);
  assert.deepEqual(r.pairs, [{ from: 'c1', to: 'c1' }]);
  assert.deepEqual(f.ids(A), ['c2']);
  assert.deepEqual(f.ids(B), ['b1', 'c1']);
  assert.equal(f.card(B, 'c1').movedFrom, A, 'stamped, so a retry knows it landed');
  assert.equal(f.wrote('board_state').length, 2);
  assert.equal(f.wrote('card_index').length, 1);
});

test('a destination that drops the update is nothing moved: no state, no index, the source untouched', async (t) => {
  const f = fakeRooms(t, { [A]: { cards: [note('c1')] }, [B]: { cards: [], readOnly: () => true } });
  await assert.rejects(moveOne(), (e) => e.code === 'room_unavailable');
  assert.deepEqual(f.ids(A), ['c1']);
  assert.deepEqual(f.ids(B), []);
  assert.equal(f.wrote('board_state').length, 0);
  assert.equal(f.wrote('card_index').length, 0);
});

test('a source that drops the first removal gets one more try on a fresh connection', async (t) => {
  const f = fakeRooms(t, { [A]: { cards: [note('c1')], readOnly: (n) => n === 0 }, [B]: { cards: [] } });
  const r = await moveOne();
  assert.equal(r.partial, undefined);
  assert.deepEqual(f.ids(A), []);
  assert.deepEqual(f.ids(B), ['c1']);
});

test('a source that will not let go is partial — and the same move again finishes it, with no second copy', async (t) => {
  let stuck = true;
  const f = fakeRooms(t, { [A]: { cards: [note('c1')], readOnly: () => stuck }, [B]: { cards: [] } });
  const first = await moveOne();
  assert.equal(first.partial, true);
  assert.deepEqual(first.pairs, [{ from: 'c1', to: 'c1' }]);
  assert.deepEqual(f.ids(A), ['c1'], 'still on the source');
  assert.deepEqual(f.ids(B), ['c1'], 'already on the destination');

  stuck = false;
  const again = await moveOne();
  assert.equal(again.partial, undefined);
  assert.equal(again.moved.length, 0, 'nothing landed twice');
  assert.deepEqual(again.pairs, [{ from: 'c1', to: 'c1' }]);
  assert.deepEqual(f.ids(A), []);
  assert.deepEqual(f.ids(B), ['c1']);
});

test('the same id on the destination that this move did not put there is renamed, not taken as landed', async (t) => {
  const f = fakeRooms(t, { [A]: { cards: [note('c1')] }, [B]: { cards: [note('c1')] } });
  const r = await moveOne();
  assert.equal(r.pairs.length, 1);
  assert.notEqual(r.pairs[0].to, 'c1');
  assert.equal(f.ids(B).length, 2, 'the cluster\'s own c1 is untouched, the moved one sits beside it');
  assert.deepEqual(f.ids(A), []);
});

test('remove on a room that drops it removes nothing: no state, no index rows deleted', async (t) => {
  const f = fakeRooms(t, { [B]: { cards: [note('n1')], readOnly: () => true } });
  await assert.rejects(
    deleteCardsFromBoard(ENV, { boardId: B, accessToken: 'tok', cardIds: ['n1'], requireLive: true }),
    (e) => e.code === 'room_unavailable',
  );
  assert.deepEqual(f.ids(B), ['n1']);
  assert.equal(f.wrote('board_state').length, 0);
  assert.equal(f.wrote('card_index').length, 0);
});

test('remove on a room that is down refuses before writing anything', async (t) => {
  const f = fakeRooms(t, { [B]: { cards: [note('n1')], down: true } });
  await assert.rejects(
    deleteCardsFromBoard(ENV, { boardId: B, accessToken: 'tok', cardIds: ['n1'], requireLive: true }),
    (e) => e.code === 'room_unavailable',
  );
  assert.deepEqual(f.writes, []);
});

test('append skips what the cluster already holds, and an append the room drops takes its index rows back', async (t) => {
  let ro = false;
  const f = fakeRooms(t, { [B]: { cards: [note('x1')], readOnly: () => ro } });
  const r = await addCardsToBoard(ENV, {
    boardId: B, workspaceId: WS, userId: 'u1', accessToken: 'tok', requireLive: true, skipExisting: true,
    buildCards: () => [note('x1'), note('x2')],
  });
  assert.deepEqual(r.cards.map((c) => c.id), ['x2']);
  assert.deepEqual(r.existing, ['x1']);
  assert.deepEqual(f.ids(B), ['x1', 'x2']);

  ro = true;
  const before = f.writes.length;
  await assert.rejects(addCardsToBoard(ENV, {
    boardId: B, workspaceId: WS, userId: 'u1', accessToken: 'tok', requireLive: true, skipExisting: true,
    buildCards: () => [note('x3')],
  }), (e) => e.code === 'room_unavailable');
  const after = f.writes.slice(before);
  assert.deepEqual(after.map((w) => `${w.method} ${w.table}`), ['POST card_index', 'DELETE card_index']);
  assert.deepEqual(f.ids(B), ['x1', 'x2']);
});
