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
    name: 'add_cards', arguments: { board_id: B1, cards: [{ kind: 'note', body: 'x' }] },
  });
  assert.equal(add.status, 200);
  assert.equal(add.body.result.isError, true);
  assert.match(add.body.result.content[0].text, /cannot write/);
  // and is told what it may do and how to get more, as the npm server says it
  assert.match(add.body.result.content[0].text, /This connection may: read\..*\[insufficient_scope\]$/s);
});

// A tool reaches the database through the same dispatcher a REST call does,
// but used to skip the curation on the way back: a card-index refusal reached
// the model as scoutDb's own string, table name and envelope included.
test('a database refusal inside an MCP tool reaches the model curated, never raw', async () => {
  putBoard(B1, []);
  on('POST', 'card_index', () => reply({
    code: 'P0001', message: 'Demo accounts are limited to 50 cards — upgrade for more', details: null, hint: null,
  }, 400));
  const add = await mcp('tools/call', {
    name: 'add_cards', arguments: { board_id: B1, cards: [{ kind: 'note', body: 'x' }] },
  });
  assert.equal(add.body.result.isError, true);
  const text = add.body.result.content[0].text;
  assert.match(text, /limited to 50 cards.*\[limit_reached\]$/);
  assert.doesNotMatch(text, /card_index|P0001|"code"/);
});

test('an unexpected database failure inside a tool says nothing about the database', async () => {
  putBoard(B1, []);
  on('POST', 'card_index', () => reply({
    code: '42P01', message: 'relation "public.card_index_v2" does not exist',
  }, 404));
  const add = await mcp('tools/call', {
    name: 'add_cards', arguments: { board_id: B1, cards: [{ kind: 'note', body: 'x' }] },
  });
  assert.equal(add.body.result.isError, true);
  assert.doesNotMatch(add.body.result.content[0].text, /card_index|relation|42P01/);
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

test('a foreign board whose document did not load keeps its identifiers', async () => {
  // Neither board_state nor the room answered for B2, so its doc reads empty.
  // That is not proof its cards are gone: the match stands and refuses.
  putBoard(B1, []);
  idents = [ident(B2, 'Z', 'u9')];
  on('GET', 'board_state', (c) => (c.query.get('board_id') === `eq.${B2}`
    ? reply({ message: 'upstream timeout' }, 504)
    : reply(boards.has(B1) ? [{ doc: boards.get(B1).doc }] : [])));
  const r = await api('POST', `/boards/${B1}/cards`, {
    on_conflict: 'identifier',
    cards: [{ kind: 'note', body: 'nine', identifiers: [{ scope: 'src', value: 'u9' }] }],
  });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(holderOf('u9'), 'Z', 'the identifier was not purged');
  assert.equal(cardsOn(B1).length, 0, 'nothing was written');
});

test('a stale foreign identifier the caller cannot delete still refuses, before any card is written', async () => {
  putBoard(B1, []);
  putBoard(B2, [{ id: 'live', kind: 'note' }]);
  idents = [ident(B2, 'Z', 'u9')];
  // RLS on a board you can read but not write: the DELETE succeeds, deleting nothing.
  on('DELETE', 'object_identifiers', () => reply(undefined, 204));
  const r = await api('POST', `/boards/${B1}/cards`, {
    on_conflict: 'identifier',
    cards: [{ kind: 'note', body: 'nine', identifiers: [{ scope: 'src', value: 'u9' }] }],
  });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(cardsOn(B1).length, 0, 'no card is written ahead of a certain collision');
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

test('a matched board in the Trash is renamed and keeps its place instead of failing the batch', async () => {
  // move_boards_under skips a trashed child as 'missing'. After the rename and
  // the creates had landed, that skip turned the whole re-run into a 409.
  putBoard(B1, [], { workspace_id: W1, parent_board_id: null, deleted_at: '2026-10-02T00:00:00+00:00' });
  idents = [boardIdent(B1, '1')];
  const moves = [];
  on('POST', 'rpc/move_boards_under', (c) => {
    moves.push(c.body);
    return reply({ moved: [], skipped: c.body.p_child_ids.map((id) => ({ id, reason: 'missing' })) });
  });
  const r = await api('POST', '/boards', {
    on_conflict: 'identifier', workspace_id: W1,
    boards: [{ name: 'Shot 1', parent_board_id: P1, identifiers: [{ scope: 'sg', value: '1' }] }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(boards.get(B1).row.name, 'Shot 1');
  assert.equal(moves.length, 0, 'a trashed board is not offered to move_boards_under');
  assert.equal(r.body.boards[0].parent_board_id, null, 'it reports where it actually is');
  assert.equal(r.body.boards[0].deleted, true);
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

// ── API-12: the change feed reports deletions; deleted=true means the Trash ──

const boardsQuery = () => calls.filter((c) => c.method === 'GET' && c.path === 'boards').pop().query;

test('a since= change feed includes soft-deleted boards, marked deleted', async () => {
  putBoard(B1, [], { deleted_at: '2026-10-02T00:00:00+00:00', updated_at: '2026-10-02T00:00:00+00:00' });
  const r = await api('GET', '/boards?since=2026-10-01T00:00:00Z');
  assert.equal(r.status, 200);
  assert.equal(boardsQuery().get('deleted_at'), null, 'no deleted_at filter in a change feed');
  assert.equal(r.body.boards[0].deleted, true);
});

test('the default listing is still live boards only', async () => {
  await api('GET', '/boards');
  assert.equal(boardsQuery().get('deleted_at'), 'is.null');
});

test('deleted=true and deleted=1 both list the Trash', async () => {
  for (const v of ['true', '1']) {
    await api('GET', `/boards?deleted=${v}`);
    assert.equal(boardsQuery().get('deleted_at'), 'not.is.null', `deleted=${v}`);
  }
});

// ── API-15: a rename RLS refuses is a 403, not a 200 with the old name ───────

test('PATCH /boards/:id answers 403 when the rename was refused', async () => {
  putBoard(B1, [], { name: 'Old' });
  boards.get(B1).readOnly = true;
  const r = await api('PATCH', `/boards/${B1}`, { name: 'New' });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(r.body.code, 'forbidden');
});

test('PATCH /boards/:id still renames a board you can edit', async () => {
  putBoard(B1, [], { name: 'Old' });
  const r = await api('PATCH', `/boards/${B1}`, { name: 'New' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.board.name, 'New');
});

test('the single-board upsert answers 403 when the matched board cannot be changed', async () => {
  putBoard(B1, [], { name: 'Old', workspace_id: W1 });
  boards.get(B1).readOnly = true;
  idents = [boardIdent(B1, '1')];
  const r = await api('POST', '/boards', {
    name: 'New', workspace_id: W1, on_conflict: 'identifier', identifiers: [{ scope: 'sg', value: '1' }],
  });
  assert.equal(r.status, 403, JSON.stringify(r.body));
});

// ── API-11: the delivery log pages by (created_at, id) ───────────────────────

const H1 = '55555555-5555-4555-8555-555555555555';
const delivery = (n, ts = '2026-10-10T00:00:00.000001+00:00') => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, event: 'card.created', created_at: ts,
});

test('a 500-row page asks for 501 and reports has_more from the extra row', async () => {
  let args;
  on('POST', 'rpc/webhook_deliveries_page', (c) => {
    args = c.body;
    return reply(Array.from({ length: 501 }, (_, i) => delivery(i)));
  });
  const r = await api('GET', `/webhooks/${H1}/deliveries?limit=500`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(args.p_limit, 501);
  assert.equal(r.body.deliveries.length, 500);
  assert.equal(r.body.has_more, true);
  const last = r.body.deliveries[499];
  assert.equal(r.body.next_cursor, `${last.created_at.replace('+00:00', 'Z')}|${last.id}`);
});

test('the cursor carries the id, so a run of deliveries sharing a timestamp is not skipped', async () => {
  let args;
  on('POST', 'rpc/webhook_deliveries_page', (c) => { args = c.body; return reply([]); });
  const d = delivery(7);
  const r = await api('GET', `/webhooks/${H1}/deliveries?cursor=${encodeURIComponent(`${d.created_at}|${d.id}`)}`);
  assert.equal(r.status, 200);
  assert.equal(args.p_cursor_ts, d.created_at);
  assert.equal(args.p_cursor_id, d.id);
  assert.equal(r.body.has_more, false);
  assert.equal(r.body.next_cursor, null);
});

test('before 0409, the log falls back to the old function inside its 200-row cap', async () => {
  on('POST', 'rpc/webhook_deliveries_page', () => reply({
    code: 'PGRST202', message: 'Could not find the function public.webhook_deliveries_page',
  }, 404));
  let args;
  on('POST', 'rpc/webhook_deliveries_list', (c) => {
    args = c.body;
    return reply(Array.from({ length: c.body.p_limit }, (_, i) => delivery(i)));
  });
  const r = await api('GET', `/webhooks/${H1}/deliveries?limit=500`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(args.p_limit <= 200);
  assert.equal(r.body.limit, args.p_limit - 1);
  assert.equal(r.body.has_more, true, 'a full capped page is not reported as the end');
});

// ── API-17: a test delivery is sent and reported on its own ──────────────────

function hookRoutes(receiver) {
  on('POST', 'rpc/webhook_list', () => reply([{ id: H1, workspace_id: W1 }]));
  on('POST', 'webhook_deliveries', (c) => reply([{ id: 'test-del', ...c.body[0] }], 201));
  const claims = [];
  on('POST', 'rpc/webhook_deliveries_claim', (c) => {
    claims.push(c.body);
    return reply([{ id: 'test-del', webhook_id: H1, event: 'webhook.test', payload: { type: 'webhook.test' }, attempt: 0 }]);
  });
  on('GET', 'webhooks', () => reply([{ id: H1, url: 'https://hooks.example.com/hook', secret: 's', active: true, failure_count: 0 }]));
  on('PATCH', /^webhook/, () => reply(undefined, 204));
  const hits = [];
  on('POST', '/hook', (c) => { hits.push(c.headers['x-soleil-delivery']); return receiver(c); });
  return { claims, hits };
}

test('POST /webhooks/:id/test sends that delivery and reports its own result', async () => {
  const { claims, hits } = hookRoutes(() => reply(undefined, 204));
  const r = await api('POST', `/webhooks/${H1}/test`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(claims[0].p_id, 'test-del', 'claimed by id, not "the 25 oldest due"');
  assert.deepEqual(hits, ['test-del']);
  assert.equal(r.body.sent, true);
  assert.equal(r.body.delivery.id, 'test-del');
  assert.equal(r.body.delivery.status, 204);
  assert.equal('result' in r.body, false, 'no counts from other workspaces');
});

test('a test the receiver refuses is reported as not sent', async () => {
  hookRoutes(() => reply({ nope: true }, 401));
  const r = await api('POST', `/webhooks/${H1}/test`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.sent, false);
  assert.match(r.body.delivery.error, /401/);
});

// ── API-09: a delete says which cards its response cannot bring back ─────────

test('deleting a note returns a card that POSTs back, with nothing flagged', async () => {
  putBoard(B1, [{ id: 'n1', kind: 'note', body: 'hello' }]);
  const r = await api('DELETE', `/boards/${B1}/cards/n1`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.card.body, 'hello');
  assert.equal('not_restorable' in r.body, false);
});

test('deleting a grid or an app-written doc names them as not restorable by POST', async () => {
  putBoard(B1, [
    { id: 'g1', kind: 'grid', cells: [] },
    { id: 'd1', kind: 'doc', title: 'Treatment', docPages: [{ id: 'p1' }] },
    { id: 'n1', kind: 'note', body: 'fine' },
  ]);
  const r = await api('DELETE', `/boards/${B1}/cards`, { card_ids: ['g1', 'd1', 'n1'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.not_restorable.sort(), ['d1', 'g1']);
  assert.match(r.body.recover, /Version history/);
});

// ── API-13: a cursor survives being pasted into a URL unencoded ──────────────

test('next_cursor has nothing a URL would mangle', async () => {
  putBoard(B1, [], { updated_at: '2026-08-09T12:00:00.123456+00:00' });
  putBoard(B2, [], { updated_at: '2026-08-09T12:00:01.5+00:00' });
  const r = await api('GET', '/boards?since=2026-08-01T00:00:00Z&limit=1');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.has_more, true);
  assert.doesNotMatch(r.body.next_cursor, /[+ ]/);
  assert.match(r.body.next_cursor, /^2026-08-09T12:00:00\.123456Z\|/, 'same instant, microseconds kept');
});

test('a cursor whose + arrived as a space (pasted unencoded) still pages', async () => {
  const pasted = `2026-08-09T12:00:00.123456 00:00|${B1}`;
  const r = await api('GET', `/boards?since=2026-08-01T00:00:00Z&cursor=${pasted.replace(/ /g, '+')}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const or = calls.filter((c) => c.path === 'boards').pop().query.get('or');
  assert.match(or, /updated_at\.gt\.2026-08-09T12:00:00\.123456\+00:00/);
});

test('a card move repoints stars and file shares as the caller, identical ids included', async () => {
  putBoard(B1, [{ id: 'X', kind: 'note', x: 0, y: 0 }, { id: 'Y', kind: 'note', x: 300, y: 0 }]);
  putBoard(B2, [{ id: 'X', kind: 'note', x: 0, y: 0 }]);
  const r = await api('POST', `/boards/${B1}/cards/move`, { to_board_id: B2, card_ids: ['X', 'Y'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const refs = calls.filter((c) => c.method === 'POST' && c.path === 'rpc/repoint_card_refs');
  assert.equal(refs.length, 1);
  assert.equal(refs[0].body.p_from, B1);
  assert.equal(refs[0].body.p_to, B2);
  const pairs = refs[0].body.p_pairs;
  assert.equal(pairs.length, 2);
  assert.ok(pairs.some((p) => p.from === 'Y' && p.to === 'Y'), 'identical ids are included');
  assert.ok(pairs.some((p) => p.from === 'X' && /^X-/.test(p.to)));
});

// ── 0537: a card move asks before it lands on another meter ──────────────────
// A team's workspaces share the team's meter and a personal workspace is on its
// owner's, so one owner's team workspace and their own are two meters.

const TEAM = '33333333-3333-4333-8333-333333333333';

async function moveBetween(from, to) {
  putBoard(B1, [{ id: 'X', kind: 'note', x: 0, y: 0 }], { workspace_id: 'w-from' });
  putBoard(B2, [], { workspace_id: 'w-to' });
  on('GET', 'workspaces', () => reply([{ id: 'w-from', ...from }, { id: 'w-to', ...to }]));
  on('POST', 'rpc/get_board_capacity', () => reply([{ is_capped: true, cap: 50, used: 50 }]));
  on('GET', 'card_index', () => reply([{ weight: 1 }]));
  const r = await api('POST', `/boards/${B1}/cards/move`, { to_board_id: B2, card_ids: ['X'] });
  return { r, asked: calls.some((c) => c.path === 'rpc/get_board_capacity') };
}

test('cards leaving a team for its owner\'s own workspace are asked about first', async () => {
  const { r, asked } = await moveBetween({ created_by: 'u1', org_id: TEAM }, { created_by: 'u1', org_id: null });
  assert.ok(asked, 'the destination\'s capacity is asked');
  assert.equal(r.status, 402, JSON.stringify(r.body));
  assert.equal(r.body.code, 'limit_reached');
});

test('cards moving between one owner\'s own workspaces stay on one meter', async () => {
  const { r, asked } = await moveBetween({ created_by: 'u1', org_id: null }, { created_by: 'u1', org_id: null });
  assert.equal(asked, false);
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('cards moving between one team\'s workspaces stay on one meter, whoever owns each', async () => {
  const { r, asked } = await moveBetween({ created_by: 'u1', org_id: TEAM }, { created_by: 'u2', org_id: TEAM });
  assert.equal(asked, false);
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

// ── GET /boards/:id/gallery and view_board ───────────────────────────────────

// An R2 bucket in memory that remembers which keys were read, and which bodies
// were let go unread.
function fakeBucket(objects) {
  const read = [];
  const cancelled = [];
  return {
    read,
    cancelled,
    async get(key) {
      read.push(key);
      const bytes = objects[key];
      if (!bytes) return null;
      return {
        size: bytes.length,
        httpMetadata: { contentType: 'image/webp' },
        body: { cancel: async () => { cancelled.push(key); } },
        arrayBuffer: async () => bytes.slice().buffer,
      };
    },
  };
}

const bytesOf = (n, fill = 7) => new Uint8Array(n).fill(fill);

function galleryBoard() {
  putBoard(B1, [
    { id: 'n1', kind: 'note', body: 'a note', x: 0, y: 0, w: 200, h: 100 },
    { id: 'i2', kind: 'image', src: 'r2:w1/b.webp', x: 300, y: 10, w: 200, h: 150 },
    { id: 'i1', kind: 'image', src: 'r2:w1/a.webp', caption: 'Neon\nsign', x: 0, y: 200, w: 200, h: 150 },
    { id: 'v1', kind: 'video', src: 'r2:w1/v.mp4', poster: 'r2:w1/p.webp', x: 300, y: 210, w: 200, h: 150 },
    { id: 'i3', kind: 'image', src: 'r2:elsewhere/secret.webp', x: 0, y: 600, w: 200, h: 150 },
    { id: 'i4', kind: 'image', src: 'https://example.com/linked.jpg', x: 300, y: 600, w: 200, h: 150 },
  ], { name: 'Diner', thumb_key: 'w1/thumbs/b1.webp', thumb_updated_at: '2026-10-20T00:00:00+00:00' });
  // The rows this user can read. elsewhere/secret.webp is on the board but not
  // theirs, so it has no row here.
  const rows = [
    { storage_path: 'w1/a.webp', preview_sm_path: 'w1/a_sm.webp', preview_sm_w: 640, preview_sm_h: 480,
      preview_path: 'w1/a_pv.webp', preview_w: 1280, preview_h: 960, width: 4000, height: 3000, size_bytes: 2_000_000 },
    { storage_path: 'w1/b.webp', width: 300, height: 200, size_bytes: 1000 },
    { storage_path: 'w1/p.webp', preview_path: 'w1/p_pv.webp', preview_w: 1280, preview_h: 720, width: 1920, height: 1080, size_bytes: 900_000 },
  ];
  on('GET', 'images', (c) => {
    const keys = idFromQuery(c.query, 'storage_path') || [];
    return reply(rows.filter((r) => keys.includes(r.storage_path)));
  });
  return fakeBucket({
    'w1/thumbs/b1.webp': bytesOf(5, 1),
    'w1/a_sm.webp': bytesOf(30, 2),
    'w1/a_pv.webp': bytesOf(60, 3),
    'w1/b.webp': bytesOf(10, 4),
    'w1/p_pv.webp': bytesOf(20, 5),
    'elsewhere/secret.webp': bytesOf(10, 9),
  });
}

async function withBucket(bucket, fn) {
  ENV.IMAGES = bucket;
  try { return await fn(); } finally { delete ENV.IMAGES; }
}

test('the gallery lists a board\'s pictures in reading order, the board\'s own picture first, and pages them', async () => {
  const bucket = galleryBoard();
  await withBucket(bucket, async () => {
    const first = await api('GET', `/boards/${B1}/gallery?inline=1&limit=3`);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const g = first.body;
    assert.equal(g.board.name, 'Diner');
    assert.equal(g.board.url, `https://clusters.test/?to=b:${B1}`);
    assert.equal(g.board.card_count, 6);
    assert.equal(g.board.picture_count, 4, 'a note and a linked image are not pictures');
    assert.equal(g.board.thumbnail.data, Buffer.from(bytesOf(5, 1)).toString('base64'));
    assert.deepEqual(g.pictures.map((p) => [p.card_id, p.position]), [['i2', 1], ['i1', 2], ['v1', 3]]);

    const [i2, i1, v1] = g.pictures;
    assert.equal(i2.rendition.variant, 'original', 'a small original stands in for missing renditions');
    assert.equal(i2.data, Buffer.from(bytesOf(10, 4)).toString('base64'));
    assert.deepEqual(i1.rendition, { variant: 'sm', width: 640, height: 480 });
    assert.equal(i1.caption, 'Neon\nsign');
    assert.equal(i1.url, `https://clusters.test/?to=c:${B1}:i1`);
    assert.equal(i1.mime, 'image/webp');
    assert.equal(v1.poster, true);
    assert.equal(v1.rendition.variant, 'preview', 'the small one is missing, so the larger one');
    assert.equal(g.has_more, true);
    assert.equal(g.next_cursor, 'p3');

    const next = await api('GET', `/boards/${B1}/gallery?inline=1&limit=3&cursor=p3`);
    assert.equal(next.status, 200);
    assert.equal(next.body.board.thumbnail, null, 'only the first page carries the board\'s picture');
    assert.deepEqual(next.body.pictures.map((p) => [p.card_id, p.position, p.reason]), [['i3', 4, 'not_found']]);
    assert.equal(next.body.pictures[0].data, undefined);
    assert.equal(next.body.has_more, false);
    assert.equal(next.body.next_cursor, null);
  });
  // Bytes are read only from a rendition of a row this user can read: never
  // from a key a card merely names.
  assert.ok(!bucket.read.includes('elsewhere/secret.webp'));
  assert.ok(!bucket.read.includes('w1/a.webp'), 'a large original is never read');
});

test('without inline the gallery is the manifest alone, and reads no bytes', async () => {
  const bucket = galleryBoard();
  await withBucket(bucket, async () => {
    const res = await api('GET', `/boards/${B1}/gallery`);
    assert.equal(res.status, 200);
    assert.equal(res.body.pictures.length, 4);
    assert.ok(res.body.pictures.every((p) => p.data === undefined && p.reason === undefined));
    assert.deepEqual(res.body.board.thumbnail, { updated_at: '2026-10-20T00:00:00+00:00' });
  });
  assert.deepEqual(bucket.read, []);
});

test('in the gallery, card_ids looks closely at the pictures named, at the larger size', async () => {
  const bucket = galleryBoard();
  await withBucket(bucket, async () => {
    const res = await api('GET', `/boards/${B1}/gallery?inline=1&size=preview&card_ids=i1,v1`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.size, 'preview');
    assert.equal(res.body.board.thumbnail, null);
    assert.deepEqual(res.body.pictures.map((p) => [p.card_id, p.position, p.rendition.variant]),
      [['i1', null, 'preview'], ['v1', null, 'preview']]);
    assert.equal(res.body.pictures[0].data, Buffer.from(bytesOf(60, 3)).toString('base64'));
    assert.equal(res.body.has_more, false);

    const none = await api('GET', `/boards/${B1}/gallery?card_ids=n1`);
    assert.equal(none.status, 404);
    assert.match(none.body.error, /no picture on this board for card n1/);
  });
});

test('the gallery refuses what it did not issue or cannot serve', async () => {
  galleryBoard();
  const bad = async (q) => (await api('GET', `/boards/${B1}/gallery${q}`));
  assert.equal((await bad('?size=huge')).status, 400);
  assert.equal((await bad('?cursor=36')).status, 400);
  const many = Array.from({ length: 25 }, (_, i) => `c${i}`).join(',');
  const tooMany = await bad(`?card_ids=${many}`);
  assert.equal(tooMany.status, 400);
  assert.match(tooMany.body.error, /at most 24 card_ids/);
  assert.equal((await api('GET', `/boards/${B2}/gallery`)).status, 404, 'a board this user cannot see');
});

test('a picture too heavy to embed is listed with why, and its body let go unread', async () => {
  const bucket = galleryBoard();
  bucket.get = ((get) => async (key) => {
    const obj = await get(key);
    if (obj && key === 'w1/a_sm.webp') obj.size = 10 * 1024 * 1024;
    return obj;
  })(bucket.get.bind(bucket));
  await withBucket(bucket, async () => {
    const res = await api('GET', `/boards/${B1}/gallery?inline=1`);
    const i1 = res.body.pictures.find((p) => p.card_id === 'i1');
    assert.equal(i1.reason, 'too_large');
    assert.equal(i1.data, undefined);
    assert.ok(res.body.pictures.find((p) => p.card_id === 'v1').data, 'the next picture still shows');
  });
  assert.deepEqual(bucket.cancelled, ['w1/a_sm.webp']);
});

test('view_board over /mcp answers in words and pictures, for a read-only token', async () => {
  scopes = ['read'];
  const bucket = galleryBoard();
  await withBucket(bucket, async () => {
    const res = await mcp('tools/call', { name: 'view_board', arguments: { board_id: B1, limit: 2 } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { content, isError } = res.body.result;
    assert.ok(!isError, JSON.stringify(content));
    assert.deepEqual(content.map((b) => b.type), ['text', 'image', 'text', 'image', 'text', 'image']);
    assert.match(content[0].text, /^Board "Diner" · 4 pictures among 6 cards · https:\/\/clusters\.test\/\?to=b:/);
    assert.match(content[0].text, /cursor "p2"/);
    assert.equal(content[2].text, '#1 card i2');
    assert.equal(content[4].text, '#2 card i1 — Neon sign');
    assert.equal(content[5].mimeType, 'image/webp');
    const { structuredContent: sc } = res.body.result;
    assert.equal(sc.board.id, B1);
    assert.deepEqual(sc.pictures.map((p) => [p.card_id, p.shown]), [['i2', true], ['i1', true]]);
    assert.ok(!JSON.stringify(sc).includes(Buffer.from(bytesOf(30, 2)).toString('base64')), 'no bytes in the manifest');

    const wrong = await mcp('tools/call', { name: 'view_board', arguments: { board_id: B1, card_ids: ['a', 'b', 'c', 'd', 'e'] } });
    assert.equal(wrong.body.result.isError, true, 'more than four card_ids is refused before the call');
  });
});

// ── /boards/:id/share-link, share_board and unshare_board ───────────────────

const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const T3 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// public_share_links in memory, answered as list_public_links / create_public_link /
// revoke_public_link answer: newest first, and 42501 for a link this caller may
// not revoke.
function fakeLinks(rows = []) {
  const links = rows.map((r) => ({ kind: 'view', revoked_at: null, expires_at: null,
    include_subboards: false, created_by: 'u1', created_at: '2026-10-01T00:00:00+00:00', ...r }));
  const made = [];
  on('POST', 'rpc/list_public_links', () => reply(links.filter((l) => l.board_id === undefined || l.board_id === B1)));
  on('POST', 'rpc/create_public_link', (c) => {
    const token = [T3, T2, T1][made.length] || T1;
    made.push(c.body);
    links.unshift({ token, kind: 'view', revoked_at: null, expires_at: c.body.p_expires_at,
      include_subboards: c.body.p_include_subboards, created_by: 'u1', created_at: '2026-10-25T00:00:00+00:00' });
    return reply(token);
  });
  on('POST', 'rpc/revoke_public_link', (c) => {
    const l = links.find((x) => x.token === c.body.p_token);
    if (l.created_by !== 'u1') return reply({ code: '42501', message: 'you can only manage links you created' }, 403);
    l.revoked_at = '2026-10-25T00:00:00+00:00';
    return reply(null);
  });
  return { links, made };
}

test('share-link makes a view link once, then hands the same one back', async () => {
  putBoard(B1, []);
  const { made } = fakeLinks();
  const first = await api('POST', `/boards/${B1}/share-link`, {});
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.created, true);
  assert.equal(first.body.link.url, `https://clusters.test/share/${T3}`);
  assert.equal(first.body.link.include_subboards, false, 'a new link shows just the one board');
  assert.deepEqual(made, [{ p_board_id: B1, p_expires_at: null, p_include_subboards: false }]);

  const again = await api('POST', `/boards/${B1}/share-link`, {});
  assert.equal(again.status, 200);
  assert.equal(again.body.created, false);
  assert.equal(again.body.link.url, first.body.link.url);
  assert.equal(made.length, 1, 'asking twice never piles up tokens');

  // The token travels only in a response body: never in a path or query the
  // request log could keep.
  assert.ok(calls.every((c) => !c.path.includes(T3) && !String(c.query).includes(T3)));
});

test('share-link reuses a link of the scope asked for, and only live view links count', async () => {
  putBoard(B1, []);
  const { made } = fakeLinks([
    { token: T1, include_subboards: true },
    { token: T2, kind: 'invite' },
  ]);
  // Asked for nothing in particular: the board's live link, whichever kind.
  const any = await api('POST', `/boards/${B1}/share-link`);
  assert.equal(any.body.link.url, `https://clusters.test/share/${T1}`);
  assert.equal(any.body.link.include_subboards, true);
  // Asked for just the board: the wide link does not fit, the invite never does.
  const narrow = await api('POST', `/boards/${B1}/share-link`, { include_subboards: false });
  assert.equal(narrow.status, 201);
  assert.deepEqual(made.map((m) => m.p_include_subboards), [false]);

  const listed = await api('GET', `/boards/${B1}/share-link`);
  assert.deepEqual(listed.body.links.map((l) => [l.url.slice(-36), l.include_subboards, l.created_by_you]),
    [[T3, false, true], [T1, true, true]]);
});

test('revoked and expired links are not handed out', async () => {
  putBoard(B1, []);
  const { made } = fakeLinks([
    { token: T1, revoked_at: '2026-10-02T00:00:00+00:00' },
    { token: T2, expires_at: '2026-01-01T00:00:00+00:00' },
  ]);
  const res = await api('POST', `/boards/${B1}/share-link`, {});
  assert.equal(res.status, 201);
  assert.equal(made.length, 1);
  assert.deepEqual((await api('GET', `/boards/${B1}/share-link`)).body.links.map((l) => l.url.slice(-36)), [T3]);
});

test('share-link refuses a bad scope, a board it cannot see and a read-only token', async () => {
  putBoard(B1, []);
  fakeLinks();
  assert.equal((await api('POST', `/boards/${B1}/share-link`, { include_subboards: 'yes' })).status, 400);
  assert.equal((await api('POST', `/boards/${B2}/share-link`, {})).status, 404);
  scopes = ['read'];
  const ro = await api('POST', `/boards/${B1}/share-link`, {});
  assert.equal(ro.status, 403);
  assert.equal(ro.body.code, 'insufficient_scope');
});

test('unsharing revokes the links this caller may, needs only write, and counts the rest', async () => {
  putBoard(B1, []);
  const { links } = fakeLinks([
    { token: T1 },
    { token: T2, created_by: 'someone-else' },
    { token: T3, kind: 'invite' },
  ]);
  scopes = ['read', 'write'];
  const res = await api('DELETE', `/boards/${B1}/share-link`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.revoked, 1);
  assert.equal(res.body.still_shared, 1);
  assert.equal(res.body.message, '1 link made by someone else stays live until they, or an owner of the workspace, revoke it');
  assert.ok(links.find((l) => l.token === T1).revoked_at);
  assert.equal(links.find((l) => l.token === T3).revoked_at, null, 'an invite is never touched');
});

test('share_board and unshare_board over /mcp', async () => {
  putBoard(B1, []);
  fakeLinks();
  const shared = await mcp('tools/call', { name: 'share_board', arguments: { board_id: B1 } });
  const r = shared.body.result;
  assert.ok(!r.isError, JSON.stringify(r));
  assert.equal(r.structuredContent.link.url, `https://clusters.test/share/${T3}`);
  assert.equal(r.structuredContent.created, true);

  const un = await mcp('tools/call', { name: 'unshare_board', arguments: { board_id: B1 } });
  assert.ok(!un.body.result.isError, JSON.stringify(un.body.result));
  assert.equal(un.body.result.structuredContent.revoked, 1);
});

// ── one card, a doc's pages, and fetch ───────────────────────────────────────

// A board holding a note, an image and a doc card whose two pages are real
// fragments, written the way the app writes them.
function putDocBoard(id) {
  const doc = new Y.Doc();
  const map = doc.getMap('cards');
  map.set('n1', cardToYMap({ id: 'n1', kind: 'note', body: 'Coffee, black.', x: 0, y: 300 }));
  map.set('i1', cardToYMap({ id: 'i1', kind: 'image', title: 'Booth', src: 'r2:w1/a.webp', caption: 'Red vinyl', x: 0, y: 0 }));
  const card = new Y.Map();
  map.set('d1', card);
  card.set('id', 'd1'); card.set('kind', 'doc'); card.set('title', 'Treatment'); card.set('x', 300); card.set('y', 0);
  const pages = new Y.Array();
  const content = new Y.Map();
  card.set('docPages', pages); card.set('docPageContent', content);
  card.set('docPageSheets', new Y.Map()); card.set('docSheetContent', new Y.Map());
  for (const [i, [pid, name, words]] of [['p1', 'Opening', 'A diner at night.'], ['p2', 'Close', 'Dawn.']].entries()) {
    pages.push([{ id: pid, name, parent_id: null, order: i }]);
    const frag = new Y.XmlFragment();
    content.set(pid, frag);
    const para = new Y.XmlElement('paragraph');
    frag.insert(0, [para]);
    const text = new Y.XmlText();
    para.insert(0, [text]);
    text.insert(0, words);
  }
  boards.set(id, {
    row: { id, name: 'Diner', workspace_id: 'w1', parent_board_id: null, view: 'canvas', deleted_at: null,
      updated_at: '2026-10-01T00:00:00+00:00' },
    doc: bytesToB64(Y.encodeStateAsUpdate(doc)),
  });
}

test('one card by id, with its link; a path below a card that is not /doc is unknown', async () => {
  putDocBoard(B1);
  const res = await api('GET', `/boards/${B1}/cards/n1`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.card.body, 'Coffee, black.');
  assert.equal(res.body.url, `https://clusters.test/?to=c:${B1}:n1`);
  assert.equal((await api('GET', `/boards/${B1}/cards/zz`)).status, 404);
  assert.equal((await api('GET', `/boards/${B1}/cards/n1/comments`)).status, 404);
  assert.equal((await api('PATCH', `/boards/${B1}/cards/n1/anything`, { title: 'x' })).status, 404,
    'a deeper path no longer rewrites the card');
  const board = await api('GET', `/boards/${B1}`);
  assert.equal(board.body.url, `https://clusters.test/?to=b:${B1}`);
});

test('a doc card reads as Markdown, page by page, within a character budget', async () => {
  putDocBoard(B1);
  const res = await api('GET', `/boards/${B1}/cards/d1/doc`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.title, 'Treatment');
  assert.equal(res.body.page_count, 2);
  assert.equal(res.body.complete, true);
  assert.deepEqual(res.body.pages.map((p) => [p.id, p.title, p.markdown]),
    [['p1', 'Opening', 'A diner at night.\n'], ['p2', 'Close', 'Dawn.\n']]);

  const one = await api('GET', `/boards/${B1}/cards/d1/doc?page=p2`);
  assert.deepEqual(one.body.pages.map((p) => p.id), ['p2']);
  assert.equal(one.body.page_count, 2);
  const tight = await api('GET', `/boards/${B1}/cards/d1/doc?max_chars=5`);
  assert.equal(tight.body.complete, false);
  assert.deepEqual(tight.body.pages.map((p) => [p.markdown, p.truncated]), [['A din', true], [null, false]]);

  assert.equal((await api('GET', `/boards/${B1}/cards/d1/doc?page=nope`)).status, 404);
  const note = await api('GET', `/boards/${B1}/cards/n1/doc`);
  assert.equal(note.status, 400);
  assert.match(note.body.error, /is a note, not a doc/);
  assert.equal((await api('PATCH', `/boards/${B1}/cards/d1/doc`, { markdown: 'x' })).status, 405);
});

const fetchTool = async (id) => (await mcp('tools/call', { name: 'fetch', arguments: { id } })).body.result;

test('fetch reads a board, a card, a doc and a page, in ChatGPT\'s shape', async () => {
  scopes = ['read'];
  putDocBoard(B1);
  const board = await fetchTool(`board:${B1}`);
  assert.ok(!board.isError, JSON.stringify(board));
  const b = board.structuredContent;
  assert.deepEqual(Object.keys(b).sort(), ['id', 'metadata', 'text', 'title', 'url']);
  assert.equal(b.id, `board:${B1}`);
  assert.equal(b.url, `https://clusters.test/?to=b:${B1}`);
  assert.equal(b.metadata.card_count, 3);
  // Reading order: the image and the doc share the top row, the note is below.
  assert.match(b.text, /^# Diner\n\n3 cards, in reading order:\n\n- \*\*Booth\*\* — image \(card i1\): Red vinyl · Image: w1\/a\.webp/);
  assert.match(b.text, /- \*\*Treatment\*\* — doc \(card d1\): fetch doc:[^:]+:d1 for its text\n- note \(card n1\): Coffee, black\.$/);
  assert.equal(JSON.parse(board.content[0].text).id, b.id, 'the text block carries the same JSON');

  const doc = (await fetchTool(`card:${B1}:d1`)).structuredContent;
  assert.equal(doc.title, 'Treatment');
  assert.equal(doc.text, '## Opening\n\nA diner at night.\n\n## Close\n\nDawn.');
  assert.equal(doc.metadata.card_kind, 'doc');

  const page = (await fetchTool(`doc:${B1}:d1:p2`)).structuredContent;
  assert.equal(page.id, `doc:${B1}:d1:p2`);
  assert.equal(page.title, 'Treatment — Close');
  assert.equal(page.text, 'Dawn.');

  const viaLink = (await fetchTool(`https://clusters.soleilpictures.com/?to=c:${B1}:n1`)).structuredContent;
  assert.equal(viaLink.id, `card:${B1}:n1`);
  assert.equal(viaLink.text, 'Coffee, black.');
});

test('fetch says what an id should look like, and where a non-doc is read', async () => {
  putDocBoard(B1);
  const bad = await fetchTool('board:not-a-uuid');
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /id must be board:<board id>/);
  const notDoc = await fetchTool(`doc:${B1}:n1`);
  assert.equal(notDoc.isError, true);
  assert.match(notDoc.content[0].text, new RegExp(`fetch card:${B1}:n1 reads it`));
});
