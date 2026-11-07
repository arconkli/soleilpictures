// POST /boards/:id/import, end to end: the real handleApiRoute against a fake
// PostgREST (object_identifiers with the real unique index, object_props, boards),
// rooms that answer like y-partyserver (the fake docWriteRoute.test.mjs drives),
// an in-memory R2 and a remote picture host.
//
// What they pin: a picture whose source_url stamp already sits on a card of
// ANOTHER cluster (a live one, or a deleted one whose document still holds it)
// is imported here as a copy rather than refusing the whole manifest with a 409;
// the stamp stays with the first card; a re-run finds the copy by its address;
// and the leniency is the import's own stamp only: any other identifier, and a
// source_url sent straight to POST /boards/:id/cards, still 409.
//
// Run: node --test src/lib/importRoute.test.mjs

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { handleApiRoute } from '../worker-api.js';
import { cardToYMap, readCards } from './yhelpers.js';

const ENV_BASE = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  PARTY_HOST: 'party.test',
};
const W1 = '99999999-9999-4999-8999-999999999999';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B1 = '11111111-1111-4111-8111-111111111111';
const B2 = '22222222-2222-4222-8222-222222222222';
const P1 = 'https://pics.example/one.png';
const P2 = 'https://pics.example/two.png';
const SRC = 'soleil.source_url';

// A 1x1 PNG.
const PNG = Uint8Array.from(atob(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
(c) => c.charCodeAt(0));

let hidden = new Set();   // board ids whose identifier rows the caller's reads cannot see (RLS)
let db;       // { boards, identifiers, props } in table order
let rooms;    // board id -> Y.Doc
let r2;       // key -> bytes
let env;
const realFetch = globalThis.fetch;
const RealWS = globalThis.WebSocket;

const reply = (body, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

// ── rooms ────────────────────────────────────────────────────────────────────

class FakeRoomSocket {
  constructor(url) {
    this.l = {};
    this.doc = rooms.get(decodeURIComponent(/\/parties\/main\/([^?]+)/.exec(url)[1]));
    setTimeout(() => {
      if (!this.doc) { this.emit('error'); return; }
      this.open = true;
      this.emit('open');
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      syncProtocol.writeSyncStep1(enc, this.doc);
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
      if (step === 0) syncProtocol.readSyncStep1(dec, enc, this.doc);
      else if (step === 1) syncProtocol.readSyncStep2(dec, this.doc, 'peer');
      else if (step === 2) syncProtocol.readUpdate(dec, this.doc, 'peer');
      if (encoding.length(enc) > 1) this.deliver(encoding.toUint8Array(enc));
    }, 0);
  }
  close() { if (!this.open) return; this.open = false; setTimeout(() => this.emit('close'), 0); }
}

const settle = () => new Promise((r) => setTimeout(r, 20));
const cardsOn = (id) => readCards(rooms.get(id));

// ── PostgREST ────────────────────────────────────────────────────────────────

function readValue(s, i, stops) {
  if (s[i] === '"') {
    let j = i + 1;
    let out = '';
    while (s[j] !== '"') { if (s[j] === '\\') j += 1; out += s[j]; j += 1; }
    return [out, j + 1];
  }
  let j = i;
  while (j < s.length && !stops.includes(s[j])) j += 1;
  return [s.slice(i, j), j];
}
function listOf(v) {
  const inner = v.slice(1, -1);
  const out = [];
  for (let i = 0; i < inner.length;) {
    const [val, next] = readValue(inner, i, [',']);
    out.push(val);
    i = next + 1;
  }
  return out;
}
function matchesQuery(row, q) {
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    const dot = v.indexOf('.');
    const op = v.slice(0, dot);
    const val = v.slice(dot + 1);
    const have = row[k] == null ? null : String(row[k]);
    if (op === 'eq') { if (have !== val) return false; } else if (op === 'in') { if (!listOf(val).includes(have)) return false; } else if (op === 'is') {
      if (val !== 'null') throw new Error(`the fake doesn't know is.${val}`);
      if (have !== null) return false;
    } else throw new Error(`the fake doesn't know ${k}=${op}.`);
  }
  return true;
}
function page(rows, q) {
  const order = q.get('order');
  if (order) {
    const [col, dir] = order.split('.');
    rows = [...rows].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (dir === 'desc' ? -1 : 1));
  }
  const offset = Number(q.get('offset') || 0);
  const limit = q.has('limit') ? Number(q.get('limit')) : Infinity;
  return rows.slice(offset, offset + limit);
}

// The unique index of object_identifiers: one holder per (workspace, type, scope, value).
const idKey = (r) => [r.workspace_id, r.object_type, r.scope, r.value].join('\u0000');

function serve(path, method, u, body) {
  const q = u.searchParams;
  if (path === 'boards' && method === 'GET') {
    return reply(db.boards.filter((r) => matchesQuery(r, q)));
  }
  if (path === 'object_identifiers' || path === 'object_props') {
    const table = path === 'object_identifiers' ? db.identifiers : db.props;
    if (method === 'GET') {
      // A guest's reads go through RLS (can_read_board); writes still meet the unique index.
      const seen = table.filter((r) => !hidden.has(r.board_id));
      return reply(page(seen.filter((r) => matchesQuery(r, q)), q));
    }
    if (method === 'DELETE') {
      for (let i = table.length - 1; i >= 0; i -= 1) if (matchesQuery(table[i], q)) table.splice(i, 1);
      return reply(undefined, 204);
    }
    if (method === 'POST' && path === 'object_identifiers') {
      const taken = new Set(table.map(idKey));
      for (const r of body) {
        if (taken.has(idKey(r))) {
          return reply({ code: '23505', message: 'duplicate key value violates unique constraint "object_identifiers_unique"' }, 409);
        }
        taken.add(idKey(r));
      }
      table.push(...body.map((r) => ({ ...r })));
      return reply(undefined, 201);
    }
    if (method === 'POST') {   // object_props: upsert on (object_type, object_id, board_id)
      for (const r of body) {
        const at = table.findIndex((x) => x.object_type === r.object_type && x.object_id === r.object_id && x.board_id === r.board_id);
        if (at >= 0) table[at] = { ...r }; else table.push({ ...r });
      }
      return reply(undefined, 201);
    }
  }
  return null;
}

beforeEach(() => {
  db = { boards: [], identifiers: [], props: [] };
  hidden = new Set();
  rooms = new Map();
  r2 = new Map();
  env = {
    ...ENV_BASE,
    IMAGES: {
      put: async (key, bytes) => { r2.set(key, bytes); },
      get: async (key) => (r2.has(key) ? { body: r2.get(key) } : null),
      head: async (key) => (r2.has(key) ? { size: r2.get(key).length } : null),
    },
  };
  globalThis.WebSocket = FakeRoomSocket;
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    if (u.hostname === 'pics.example') {
      return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
    const path = u.pathname.replace(/^\/rest\/v1\//, '');
    if (path === 'rpc/api_token_resolve') {
      return reply([{ user_id: U1, token_id: 't1', scopes: ['read', 'write', 'delete'], req_limit: 1000, req_count: 1 }]);
    }
    if (path === 'rpc/api_session_begin') return reply([{ access_token: 'user-jwt' }]);
    if (path === 'rpc/can_write_board') return reply(true);
    if (path === 'rpc/record_upload_intent') return reply(true);
    if (path === 'rpc/authorize_image_upload') return reply([{ allow: true }]);
    const served = serve(path, method, u, body);
    if (served) return served;
    if (path.startsWith('rpc/')) return reply(null);
    return method === 'GET' ? reply([]) : reply(undefined, 201);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.WebSocket = RealWS;
});

async function api(method, path, body) {
  const url = new URL(`https://clusters.test/api/v1${path}`);
  const req = new Request(url, {
    method,
    headers: {
      authorization: 'Bearer sk_live_test',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await handleApiRoute(url, req, env, null);
  const text = await res.text();
  await settle();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// ── world ────────────────────────────────────────────────────────────────────

const board = (id, extra = {}) => ({
  id, name: `Cluster ${id.slice(0, 2)}`, workspace_id: W1, parent_board_id: null, view: 'canvas',
  created_at: '2026-10-01T00:00:00Z', updated_at: null, deleted_at: null, ...extra,
});

function room(id, cards = []) {
  const doc = new Y.Doc();
  doc.transact(() => {
    for (const c of cards) doc.getMap('cards').set(c.id, cardToYMap(c));
  });
  rooms.set(id, doc);
}

const ident = (boardId, objectId, scope, value) => ({
  workspace_id: W1, board_id: boardId, object_type: 'card', object_id: objectId, scope, value,
});

// A card on `boardId` that an import stamped with `url`.
function stampedCard(boardId, cardId, url, { stamp = true } = {}) {
  const doc = rooms.get(boardId);
  doc.transact(() => {
    doc.getMap('cards').set(cardId, cardToYMap({
      id: cardId, kind: 'image', src: `r2:${W1}/earlier.png`, x: 0, y: 0, w: 100, h: 100,
    }));
  });
  if (stamp) db.identifiers.push(ident(boardId, cardId, 'source_url', url));
  db.props.push({
    workspace_id: W1, board_id: boardId, object_type: 'card', object_id: cardId,
    props: { [SRC]: url }, updated_at: '2026-10-01T00:00:00.000Z',
  });
}

const holder = (scope, value) => db.identifiers.filter((r) => r.scope === scope && r.value === value);
const importInto = (boardId, urls) => api('POST', `/boards/${boardId}/import`, { items: urls.map((url) => ({ url })) });

const NEXT = 'Re-running this manifest updates the same cards rather than duplicating them — '
  + 'each carries a "source_url" identifier you can also look up with GET /resolve.';
const COPY_NOTE = 'already on another cluster, which keeps its source_url identifier; re-running this import updates this copy';

function twoBoards({ deletedFirst = false } = {}) {
  db.boards.push(board(B1, deletedFirst ? { deleted_at: '2026-10-05T00:00:00Z' } : {}), board(B2));
  room(B1);
  room(B2);
  stampedCard(B1, 'c-b1', P1);
}

// ── the cases ────────────────────────────────────────────────────────────────

test('a picture stamped on another cluster is imported here as a copy', async () => {
  twoBoards();
  const r = await importInto(B2, [P1]);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.imported, 1);
  assert.equal(r.body.updated, 0);
  assert.equal(r.body.failed, 0);

  const here = cardsOn(B2);
  assert.equal(here.length, 1, 'the card landed on the second cluster');
  assert.equal(cardsOn(B1).length, 1);
  assert.deepEqual(holder('source_url', P1), [ident(B1, 'c-b1', 'source_url', P1)], 'the stamp stays with the first card');

  const props = db.props.find((p) => p.board_id === B2 && p.object_id === String(here[0].id));
  assert.equal(props?.props[SRC], P1, 'the copy records where it came from');

  const [item] = r.body.items;
  assert.equal(item.ok, true);
  assert.equal(item.card_id, String(here[0].id));
  assert.equal(item.note, COPY_NOTE);
  assert.equal(r.body.next, `${NEXT} One of them was already on another cluster, which keeps that identifier; a re-run finds the copy here by its address.`);
});

test('running it again updates the copy rather than adding another', async () => {
  twoBoards();
  const first = await importInto(B2, [P1]);
  const again = await importInto(B2, [P1]);
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(again.body.imported, 0);
  assert.equal(again.body.updated, 1);
  assert.equal(cardsOn(B2).length, 1);
  assert.equal(again.body.items[0].card_id, first.body.items[0].card_id);
  assert.deepEqual(holder('source_url', P1).map((r) => r.board_id), [B1]);
});

test('a cluster deleted since (still restorable) keeps its stamp, and the picture is imported anyway', async () => {
  twoBoards({ deletedFirst: true });
  const r = await importInto(B2, [P1]);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.imported, 1);
  assert.equal(cardsOn(B2).length, 1);
  assert.deepEqual(holder('source_url', P1), [ident(B1, 'c-b1', 'source_url', P1)]);
  assert.equal(r.body.items[0].note, COPY_NOTE);
});

test('a mixed manifest lands whole: the copy, and the new picture with its own stamp', async () => {
  twoBoards();
  const r = await importInto(B2, [P1, P2]);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.imported, 2);
  assert.equal(cardsOn(B2).length, 2);
  assert.deepEqual(holder('source_url', P2).map((h) => h.board_id), [B2], 'the new picture carries its own source_url');
  assert.deepEqual(holder('source_url', P1).map((h) => h.board_id), [B1]);
  assert.equal(r.body.items[0].note, COPY_NOTE);
  assert.equal(r.body.items[1].note, undefined, 'only the copy says so');

  const again = await importInto(B2, [P1, P2]);
  assert.equal(again.body.imported, 0);
  assert.equal(again.body.updated, 2);
  assert.equal(cardsOn(B2).length, 2, 'no duplicates');
});

test('an identifier of the caller\'s own that is on another cluster still refuses', async () => {
  twoBoards();
  db.identifiers.push(ident(B1, 'c-b1', 'shotgrid', 'Shot:1'));
  const r = await api('POST', `/boards/${B2}/import`, {
    items: [{ url: P1, identifiers: [{ scope: 'shotgrid', value: 'Shot:1' }] }],
  });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, 'identifier_conflict');
  assert.equal(cardsOn(B2).length, 0);
});

test('a source_url sent straight to POST /cards is still refused: the leniency is the import\'s', async () => {
  twoBoards();
  const r = await api('POST', `/boards/${B2}/cards`, {
    cards: [{ kind: 'link', url: 'https://example.com/x', title: 'x', identifiers: [{ scope: 'source_url', value: P1 }] }],
    on_conflict: 'identifier',
  });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, 'identifier_conflict');
  assert.equal(cardsOn(B2).length, 0);
});

test('when the first card is gone from its cluster, a re-run keeps the copy and takes the freed stamp', async () => {
  twoBoards();
  const first = await importInto(B2, [P1]);
  const copyId = first.body.items[0].card_id;
  rooms.get(B1).getMap('cards').delete('c-b1');   // deleted in the app: its identifier row stays behind

  const again = await importInto(B2, [P1]);
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(again.body.imported, 0);
  assert.equal(again.body.updated, 1);
  assert.equal(cardsOn(B2).length, 1);
  assert.equal(again.body.items[0].card_id, copyId);
  assert.deepEqual(holder('source_url', P1).map((h) => [h.board_id, h.object_id]), [[B2, copyId]],
    'the freed stamp is now the copy\'s');
  assert.equal(again.body.items[0].note, undefined, 'no longer a copy');
  assert.equal(again.body.next, NEXT);
});

test('a plain first import behaves as it always did', async () => {
  db.boards.push(board(B2));
  room(B2);
  const r = await importInto(B2, [P1, P2]);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.imported, 2);
  assert.equal(r.body.updated, 0);
  assert.equal(r.body.next, NEXT);
  assert.ok(r.body.items.every((i) => i.ok && i.note === undefined));
  assert.equal('copies' in r.body, false);
  assert.deepEqual([P1, P2].map((p) => holder('source_url', p).map((h) => h.board_id)), [[B2], [B2]]);
  assert.equal(db.props.filter((p) => p.board_id === B2).length, 2);

  // A caller reaching the cards route itself never sees an import's bookkeeping.
  const direct = await api('POST', `/boards/${B2}/cards`, {
    cards: [{ kind: 'link', url: 'https://example.com/y', title: 'y', identifiers: [{ scope: 'shotgrid', value: 'S:2' }] }],
    on_conflict: 'identifier',
  });
  assert.equal(direct.status, 201, JSON.stringify(direct.body));
  assert.equal('copies' in direct.body, false);
});

test('a guest who cannot see the other cluster still gets the picture, without the stamp, and no word of it', async () => {
  twoBoards();
  hidden.add(B1);   // the caller can open B2 only: reads of B1's rows come back empty
  const r = await importInto(B2, [P1]);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.imported, 1);
  assert.equal(cardsOn(B2).length, 1, 'exactly one card');
  assert.equal('copies' in r.body, false);
  assert.equal(r.body.items[0].note, undefined, 'nothing says which cluster held it');
  assert.equal(r.body.next, NEXT);

  const here = cardsOn(B2)[0];
  const props = db.props.find((p) => p.board_id === B2 && p.object_id === String(here.id));
  assert.equal(props?.props[SRC], P1);
  assert.deepEqual(db.identifiers.filter((x) => x.board_id === B2 && x.scope === 'source_url'), []);
  assert.deepEqual(holder('source_url', P1), [ident(B1, 'c-b1', 'source_url', P1)], 'the first stamp is untouched');

  const again = await importInto(B2, [P1]);
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(again.body.imported, 0);
  assert.equal(again.body.updated, 1);
  assert.equal(cardsOn(B2).length, 1, 'updated, not duplicated');
});
