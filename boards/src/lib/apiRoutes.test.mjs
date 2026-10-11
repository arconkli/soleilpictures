// The /api/v1 routes, driven end to end against a fake PostgREST.
//
// Most of the API's tests read the source or exercise a pure helper. These run
// the real handleApiRoute — authentication, the scope gate, the dispatcher and
// the route body — with `fetch` swapped for a small in-memory Supabase, because
// the bugs they pin down live in how those layers fit together: a gate that is
// right on its own and wrong for the one route it was never meant to see, or a
// response that is assembled correctly from rows that were paired up wrongly.

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { handleApiRoute } from '../worker-api.js';
import { cardToYMap, bytesToB64, b64ToBytes, readCards } from './yhelpers.js';

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
};

// ── the fake ─────────────────────────────────────────────────────────────────
//
// `routes` is consulted first: a list of [predicate, handler]. Anything left
// unmatched answers the way an empty PostgREST does — [] for a select, null for
// an RPC — which is enough for a route to run to completion.

let scopes = ['read', 'write', 'delete'];
let routes = [];
let calls = [];
// board id -> { row, doc (base64 Y update) }. Boards the test has not put here
// do not exist.
let boards = new Map();
// object_identifiers rows: { board_id, object_type, object_id, scope, value }.
let idents = [];
const realFetch = globalThis.fetch;
const realWebSocket = globalThis.WebSocket;

// The live room is unreachable in a test, which is a case the code already
// handles: it falls back to the board_state snapshot, so that is all we fake.
class NoRoom {
  constructor() { setTimeout(() => this._err?.(), 0); }
  addEventListener(type, fn) { if (type === 'error') this._err = fn; }
  close() {}
}

const B1 = '11111111-1111-4111-8111-111111111111';
const B2 = '22222222-2222-4222-8222-222222222222';

function putBoard(id, cards, row = {}) {
  const doc = new Y.Doc();
  const map = doc.getMap('cards');
  for (const c of cards) map.set(c.id, cardToYMap(c));
  boards.set(id, {
    row: { id, name: `Board ${id.slice(0, 4)}`, workspace_id: 'w1', parent_board_id: null,
      view: 'canvas', deleted_at: null, updated_at: '2026-10-01T00:00:00+00:00', ...row },
    doc: bytesToB64(Y.encodeStateAsUpdate(doc)),
  });
}

function cardsOn(id) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, b64ToBytes(boards.get(id).doc));
  return readCards(doc);
}

const idFromQuery = (q, key = 'id') => {
  const v = q.get(key) || '';
  if (v.startsWith('eq.')) return [v.slice(3)];
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((x) => x.replace(/"/g, ''));
  return null;
};

function reply(body, status = 200) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  scopes = ['read', 'write', 'delete'];
  routes = [];
  calls = [];
  boards = new Map();
  idents = [];
  globalThis.WebSocket = NoRoom;
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    const path = u.pathname.replace(/^\/rest\/v1\//, '');
    const call = { method, path, query: u.searchParams, body, headers: init.headers || {} };
    calls.push(call);
    for (const [match, handle] of routes) {
      if (match(call)) return handle(call);
    }
    if (path === 'rpc/api_token_resolve') {
      return reply([{ user_id: 'u1', token_id: 't1', scopes, req_limit: 1000, req_count: 1 }]);
    }
    if (path === 'rpc/api_session_begin') return reply([{ access_token: 'user-jwt' }]);
    if (path === 'rpc/can_write_board') return reply(boards.has(body.p_board_id));
    if (path === 'boards' && method === 'GET') {
      const ids = idFromQuery(call.query);
      return reply([...boards.values()].map((b) => b.row).filter((r) => !ids || ids.includes(r.id)));
    }
    if (path === 'boards' && method === 'POST') {
      // The real column grants: INSERT on id/workspace_id, UPDATE only on
      // name/view/parent_board_id. ON CONFLICT DO UPDATE sets every column.
      if (call.headers.prefer?.includes('merge-duplicates')) {
        return reply({ code: '42501', message: 'permission denied for table boards' }, 403);
      }
      for (const r of body) boards.set(r.id, { row: { deleted_at: null, ...r }, doc: null });
      return reply(undefined, 201);
    }
    if (path === 'boards' && method === 'PATCH') {
      const [bid] = idFromQuery(call.query);
      const b = boards.get(bid);
      if (!b || b.readOnly) return reply([]);
      Object.assign(b.row, body);
      return reply([b.row]);
    }
    if (path === 'board_state' && method === 'GET') {
      const [bid] = idFromQuery(call.query, 'board_id');
      return reply(boards.has(bid) ? [{ doc: boards.get(bid).doc }] : []);
    }
    if (path === 'board_state' && method === 'POST') {
      for (const r of body) if (boards.has(r.board_id)) boards.get(r.board_id).doc = r.doc;
      return reply(undefined, 201);
    }
    if (path === 'object_identifiers') {
      const keep = (r) => {
        for (const [k, v] of call.query) {
          if (k === 'select' || k === 'order') continue;
          const vals = idFromQuery(call.query, k);
          if (vals && !vals.includes(String(r[k]))) return false;
        }
        return true;
      };
      if (method === 'GET') return reply(idents.filter(keep));
      if (method === 'DELETE') { idents = idents.filter((r) => !keep(r)); return reply(undefined, 204); }
      if (method === 'POST') {
        for (const r of body) {
          if (idents.some((x) => x.scope === r.scope && x.value === r.value && x.object_type === r.object_type)) {
            return reply({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
          }
        }
        idents.push(...body);
        return reply(undefined, 201);
      }
      if (method === 'PATCH') {
        for (const r of idents) if (keep(r)) Object.assign(r, body);
        return reply([]);
      }
    }
    if (path.startsWith('rpc/')) return reply(null);
    return reply(method === 'GET' ? [] : null);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.WebSocket = realWebSocket;
});

const on = (method, path, handle) => routes.push([
  (c) => c.method === method && (typeof path === 'string' ? c.path === path : path.test(c.path)),
  handle,
]);

async function api(method, path, body, headers = {}) {
  const url = new URL(`https://clusters.test/api/v1${path}`);
  const req = new Request(url, {
    method,
    headers: {
      authorization: 'Bearer sk_live_test',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await handleApiRoute(url, req, ENV, null);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

const mcp = (method, params = {}, id = 1) => api('POST', '/mcp', { jsonrpc: '2.0', id, method, params });

// ── API-01: a read-only token can use the hosted MCP server ──────────────────

test('a read-only token can initialize, list tools and run a read tool over /mcp', async () => {
  scopes = ['read'];
  const init = await mcp('initialize', { protocolVersion: '2025-06-18' });
  assert.equal(init.status, 200, JSON.stringify(init.body));
  assert.ok(init.body.result.serverInfo);

  const list = await mcp('tools/list');
  assert.equal(list.status, 200);
  assert.ok(list.body.result.tools.length > 0);

  const read = await mcp('tools/call', { name: 'list_boards', arguments: {} });
  assert.equal(read.status, 200);
  assert.notEqual(read.body.result.isError, true, JSON.stringify(read.body.result));
});

test('a read-only token still cannot WRITE through an MCP tool', async () => {
  scopes = ['read'];
  const add = await mcp('tools/call', {
    name: 'add_cards', arguments: { board_id: 'b1', cards: [{ kind: 'note', body: 'x' }] },
  });
  assert.equal(add.status, 200);
  assert.equal(add.body.result.isError, true);
  assert.match(add.body.result.content[0].text, /cannot write/);
});

test('a read-only token is still refused a REST write', async () => {
  scopes = ['read'];
  const r = await api('POST', '/boards', { name: 'x' });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, 'insufficient_scope');
});

// ── API-07: a move repoints each card's metadata to THAT card ────────────────

const repoints = () => calls
  .filter((c) => c.method === 'PATCH' && c.path === 'object_identifiers')
  .map((c) => ({ from: idFromQuery(c.query, 'object_id')[0], to: c.body.object_id, board: c.body.board_id }));

test('moving cards in a different order than the board keeps each card\'s identifiers', async () => {
  putBoard(B1, [{ id: 'X', kind: 'note', x: 0, y: 0 }, { id: 'Y', kind: 'note', x: 300, y: 0 }]);
  putBoard(B2, []);
  const r = await api('POST', `/boards/${B1}/cards/move`, { to_board_id: B2, card_ids: ['Y', 'X'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.moved, 2);
  const moves = repoints();
  assert.equal(moves.length, 2);
  for (const m of moves) {
    assert.equal(m.from, m.to, `metadata of ${m.from} must stay with ${m.from}, not move to ${m.to}`);
    assert.equal(m.board, B2);
  }
});

test('a missing card id does not shift metadata onto its neighbour', async () => {
  putBoard(B1, [{ id: 'X', kind: 'note', x: 0, y: 0 }, { id: 'Y', kind: 'note', x: 300, y: 0 }]);
  putBoard(B2, []);
  const r = await api('POST', `/boards/${B1}/cards/move`, { to_board_id: B2, card_ids: ['gone', 'Y'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(repoints().map((m) => [m.from, m.to]), [['Y', 'Y']]);
});

test('a card re-ided for a collision takes its metadata to the new id', async () => {
  putBoard(B1, [{ id: 'X', kind: 'note', x: 0, y: 0 }]);
  putBoard(B2, [{ id: 'X', kind: 'note', x: 0, y: 0 }]);
  const r = await api('POST', `/boards/${B1}/cards/move`, { to_board_id: B2, card_ids: ['X'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [m] = repoints();
  assert.equal(m.from, 'X');
  assert.match(m.to, /^X-/);
  assert.equal(r.body.cards[0].id, m.to);
  assert.equal(cardsOn(B2).length, 2);
});

// ── API-02: a re-run upsert survives a card deleted in the app ───────────────

const ident = (board, card, value) => ({
  workspace_id: 'w1', board_id: board, object_type: 'card', object_id: card, scope: 'src', value,
});
const holderOf = (value) => idents.find((r) => r.value === value)?.object_id;

test('re-running an upsert after a matched card was deleted in the app re-creates it, and nobody else\'s identifiers move', async () => {
  // C1 was deleted in the app; its identifier row stayed behind.
  putBoard(B1, [{ id: 'C2', kind: 'note', body: 'two' }, { id: 'C3', kind: 'note', body: 'three' }]);
  idents = [ident(B1, 'C1', 'u1'), ident(B1, 'C2', 'u2'), ident(B1, 'C3', 'u3')];
  const r = await api('POST', `/boards/${B1}/cards`, {
    on_conflict: 'identifier',
    cards: ['u1', 'u2', 'u3'].map((v) => ({ kind: 'note', body: v, identifiers: [{ scope: 'src', value: v }] })),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.updated, 2);
  assert.equal(r.body.created, 1);
  assert.equal(holderOf('u2'), 'C2');
  assert.equal(holderOf('u3'), 'C3');
  const fresh = holderOf('u1');
  assert.ok(fresh && fresh !== 'C1', 'u1 now names the re-created card');
  assert.ok(cardsOn(B1).some((c) => c.id === fresh));
  assert.deepEqual(r.body.cards.map((c) => c.id), [fresh, 'C2', 'C3']);
});

test('an identifier left behind on another board by a deleted card no longer blocks the item', async () => {
  putBoard(B1, []);
  putBoard(B2, [{ id: 'live', kind: 'note' }]);
  idents = [ident(B2, 'Z', 'u9')];
  const r = await api('POST', `/boards/${B1}/cards`, {
    on_conflict: 'identifier',
    cards: [{ kind: 'note', body: 'nine', identifiers: [{ scope: 'src', value: 'u9' }] }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.created, 1);
  const row = idents.find((x) => x.value === 'u9');
  assert.equal(row.board_id, B1);
});

test('a LIVE card on another board still refuses the item, naming where it is', async () => {
  putBoard(B1, []);
  putBoard(B2, [{ id: 'Z', kind: 'note' }]);
  idents = [ident(B2, 'Z', 'u9')];
  const r = await api('POST', `/boards/${B1}/cards`, {
    on_conflict: 'identifier',
    cards: [{ kind: 'note', body: 'nine', identifiers: [{ scope: 'src', value: 'u9' }] }],
  });
  assert.equal(r.status, 409);
  assert.match(r.body.error, new RegExp(B2));
});

// ── API-03: a bulk board upsert that matches existing boards ─────────────────

const W1 = '33333333-3333-4333-8333-333333333333';
const P1 = '44444444-4444-4444-8444-444444444444';
const boardIdent = (board, value) => ({
  workspace_id: W1, board_id: board, object_type: 'board', object_id: board, scope: 'sg', value,
});

test('a bulk upsert renames matched boards and creates the rest, with identifiers on both', async () => {
  putBoard(B1, [], { name: 'Shot 1 (old)', workspace_id: W1, parent_board_id: P1 });
  idents = [boardIdent(B1, '1')];
  const moves = [];
  on('POST', 'rpc/move_boards_under', (c) => { moves.push(c.body); return reply({ moved: c.body.p_child_ids, skipped: [] }); });
  const r = await api('POST', '/boards', {
    on_conflict: 'identifier', workspace_id: W1,
    boards: [
      { name: 'Shot 1', identifiers: [{ scope: 'sg', value: '1' }] },
      { name: 'Shot 2', identifiers: [{ scope: 'sg', value: '2' }] },
    ],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.updated, 1);
  assert.equal(r.body.created, 1);
  assert.equal(boards.get(B1).row.name, 'Shot 1');
  // Leaving parent_board_id out leaves the board where it is.
  assert.equal(boards.get(B1).row.parent_board_id, P1);
  assert.equal(r.body.boards[0].parent_board_id, P1);
  assert.equal(moves.length, 0);
  const fresh = r.body.boards[1].id;
  assert.ok(idents.some((x) => x.value === '2' && x.object_id === fresh));
});

test('a named parent on a matched board goes through move_boards_under', async () => {
  putBoard(B1, [], { workspace_id: W1, parent_board_id: null });
  idents = [boardIdent(B1, '1')];
  const moves = [];
  on('POST', 'rpc/move_boards_under', (c) => { moves.push(c.body); return reply({ moved: c.body.p_child_ids, skipped: [] }); });
  const r = await api('POST', '/boards', {
    on_conflict: 'identifier', workspace_id: W1,
    boards: [{ name: 'Shot 1', parent_board_id: P1, identifiers: [{ scope: 'sg', value: '1' }] }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(moves, [{ p_child_ids: [B1], p_target_id: P1 }]);
});

test('new boards keep their identifiers even when a matched board refuses the rename', async () => {
  putBoard(B1, [], { workspace_id: W1 });
  boards.get(B1).readOnly = true;
  idents = [boardIdent(B1, '1')];
  const r = await api('POST', '/boards', {
    on_conflict: 'identifier', workspace_id: W1,
    boards: [
      { name: 'Shot 1', identifiers: [{ scope: 'sg', value: '1' }] },
      { name: 'Shot 2', identifiers: [{ scope: 'sg', value: '2' }] },
    ],
  });
  assert.equal(r.status, 403);
  assert.ok(idents.some((x) => x.value === '2'), 'the created board can be matched by the next run');
});
