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
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  scopes = ['read', 'write', 'delete'];
  routes = [];
  calls = [];
  boards = new Map();
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
    if (path === 'board_state' && method === 'GET') {
      const [bid] = idFromQuery(call.query, 'board_id');
      return reply(boards.has(bid) ? [{ doc: boards.get(bid).doc }] : []);
    }
    if (path === 'board_state' && method === 'POST') {
      for (const r of body) if (boards.has(r.board_id)) boards.get(r.board_id).doc = r.doc;
      return reply(undefined, 201);
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

