// Search through /api/v1 and MCP, end to end: the real handleApiRoute against a
// fake PostgREST holding boards, card_index, entity_search and doc_page_index.
// What they pin: a board is found by its name and a picture by what is in it
// (the two reads that went through a plain `col=ilike.…` filter, where
// PostgREST keeps the double quotes pgLikeValue adds as part of the pattern and
// nothing matches), a deleted board is left out, and LIKE characters and
// PostgREST's reserved characters in the query are literal.
//
// The fake parses filters the way PostgREST does, which is the point: a plain
// filter takes its value verbatim, and only `or=(…)` / `in.(…)` unquote.
//
// Run: node --test src/lib/searchRoute.test.mjs

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleApiRoute } from '../worker-api.js';

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  PARTY_HOST: 'party.test',
};
const W1 = '99999999-9999-4999-8999-999999999999';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B1 = '11111111-1111-4111-8111-111111111111';
const B2 = '22222222-2222-4222-8222-222222222222';
const B3 = '33333333-3333-4333-8333-333333333333';
const C1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const C2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

let db;            // { boards, card_index, entity_search, doc_page_index }
let quotedPlain;   // every plain ilike value that started with a double quote
const realFetch = globalThis.fetch;

const reply = (body, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

const board = (id, name, extra = {}) => ({
  id, name, workspace_id: W1, parent_board_id: null, view: 'canvas',
  created_at: '2026-10-01T00:00:00Z', updated_at: null, deleted_at: null, ...extra,
});

// PostgREST's filters as this route uses them.
const TABLES = {
  boards: ['id', 'name', 'workspace_id', 'parent_board_id', 'view', 'created_at', 'updated_at', 'deleted_at'],
  card_index: ['board_id', 'card_id', 'kind', 'title', 'body', 'workspace_id', 'updated_at'],
  entity_search: ['kind', 'board_id', 'card_id', 'title', 'seen', 'workspace_id', 'updated_at'],
  doc_page_index: ['doc_card_id', 'page_id', 'page_title', 'page_text', 'workspace_id', 'updated_at'],
};

// A value inside `in.(…)` or an `or=(…)` term: double-quoted (\" and \\ are
// escapes) or bare up to the next comma or close paren.
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
function orTerms(v) {
  const inner = v.slice(1, -1);
  const out = [];
  for (let i = 0; i < inner.length;) {
    const c1 = inner.indexOf('.', i);
    const c2 = inner.indexOf('.', c1 + 1);
    const [val, next] = readValue(inner, c2 + 1, [',', ')']);
    out.push({ col: inner.slice(i, c1), op: inner.slice(c1 + 1, c2), val });
    i = next + 1;
  }
  return out;
}
// ilike: % any run, _ one character, a backslash makes the next one literal.
function likeRe(p) {
  let re = '';
  for (let i = 0; i < p.length; i += 1) {
    const c = p[i];
    if (c === '\\' && i + 1 < p.length) { i += 1; re += p[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    else if (c === '%') re += '[\\s\\S]*';
    else if (c === '_') re += '[\\s\\S]';
    else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}
function test1(row, col, op, val) {
  const have = row[col] == null ? null : String(row[col]);
  if (op === 'ilike') return have !== null && likeRe(val).test(have);
  if (op === 'eq') return have === val;
  if (op === 'is') { if (val !== 'null') throw new Error(`the fake doesn't know is.${val}`); return have === null; }
  if (op === 'gte') return have !== null && have >= val;
  if (op === 'in') return listOf(val).includes(have);
  throw new Error(`the fake doesn't know ${col}.${op}`);
}
function matches(table, row, q) {
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    if (k === 'or') {
      if (!orTerms(v).some((t) => test1(row, t.col, t.op, t.val))) return false;
      continue;
    }
    if (!TABLES[table].includes(k)) throw new Error(`the fake doesn't know column ${k} on ${table}`);
    const dot = v.indexOf('.');
    const op = v.slice(0, dot);
    const val = v.slice(dot + 1);
    // A plain filter takes its value verbatim: no unquoting.
    if (op === 'ilike' && val.startsWith('"')) quotedPlain.push(val);
    if (!test1(row, k, op, val)) return false;
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

beforeEach(() => {
  db = { boards: [], card_index: [], entity_search: [], doc_page_index: [] };
  quotedPlain = [];
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const path = u.pathname.replace(/^\/rest\/v1\//, '');
    if (path === 'rpc/api_token_resolve') {
      return reply([{ user_id: U1, token_id: 't1', scopes: ['read'], req_limit: 1000, req_count: 1 }]);
    }
    if (path === 'rpc/api_session_begin') return reply([{ access_token: 'user-jwt' }]);
    if (path.startsWith('rpc/')) return reply(null);
    if (method === 'GET' && TABLES[path]) {
      const rows = db[path].filter((r) => matches(path, r, u.searchParams));
      return reply(page(rows, u.searchParams));
    }
    return method === 'GET' ? reply([]) : reply(undefined, 201);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
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
  const res = await handleApiRoute(url, req, ENV, null);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const tool = async (name, args) => {
  const r = await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return r.body.result;
};

test('a board is found by its name, and a deleted one is not', async () => {
  db.boards.push(
    board(B1, 'Lookbook'),
    board(B2, 'Lookbook (old)', { deleted_at: '2026-10-02T00:00:00Z' }),
  );
  const r = await api('GET', '/search?q=Lookbook&kind=board');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.boards.items.map((b) => b.id), [B1]);
  assert.equal(r.body.boards.items[0].name, 'Lookbook');
  assert.ok(r.body.boards.items[0].url);
  assert.deepEqual(quotedPlain, []);
});

test('the match is case-insensitive and partial, and cards are found too', async () => {
  db.boards.push(board(B1, 'Lookbook'));
  db.card_index.push({
    board_id: B1, card_id: C1, kind: 'note', title: 'Look notes', body: null, workspace_id: W1, updated_at: '2026-10-03T00:00:00Z',
  });
  const r = await api('GET', '/search?q=look');
  assert.equal(r.status, 200);
  assert.ok(r.body.boards.items.some((b) => b.name === 'Lookbook'));
  assert.ok(r.body.cards.items.some((c) => c.title === 'Look notes'));
  assert.deepEqual(quotedPlain, []);
});

test('LIKE characters and PostgREST reserved characters in q are literal', async () => {
  db.boards.push(
    board(B1, '100% cotton'),
    board(B2, '1000 cotton'),
    board(B3, 'Rain, night (b-roll)'),
  );
  const pct = await api('GET', `/search?q=${encodeURIComponent('100%')}&kind=board`);
  assert.deepEqual(pct.body.boards.items.map((b) => b.name), ['100% cotton']);
  const odd = await api('GET', `/search?q=${encodeURIComponent('Rain, night (b')}&kind=board`);
  assert.deepEqual(odd.body.boards.items.map((b) => b.name), ['Rain, night (b-roll)']);
  assert.deepEqual(quotedPlain, []);
});

test('a picture is found by what is in it', async () => {
  db.entity_search.push({
    kind: 'image', board_id: B1, card_id: C2, title: 'IMG_0042', seen: 'a red car parked at night',
    workspace_id: W1, updated_at: '2026-10-03T00:00:00Z',
  });
  const r = await api('GET', `/search?q=${encodeURIComponent('red car')}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.pictures.items.length, 1);
  assert.equal(r.body.pictures.items[0].card_id, C2);
  assert.equal(r.body.pictures.items[0].in_picture, 'a red car parked at night');
  assert.deepEqual(quotedPlain, []);
});

test('MCP search finds a board by name', async () => {
  db.boards.push(board(B1, 'Lookbook'));
  const r = await tool('search', { query: 'Lookbook', kind: 'board' });
  const first = r.structuredContent.results[0];
  assert.equal(first.id, `board:${B1}`);
  assert.equal(first.kind, 'board');
  assert.equal(first.title, 'Lookbook');
});

const cardRow = (id, title, body, fold = null) => ({
  board_id: B1, card_id: id, kind: 'note', title, body, fold, workspace_id: W1, updated_at: '2026-10-03T00:00:00Z',
});

// Every card_index / doc_page_index read the route makes, decoded.
function recordReads() {
  const reads = [];
  const inner = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    const path = u.pathname.replace(/^\/rest\/v1\//, '');
    if (['card_index', 'doc_page_index', 'boards'].includes(path) && u.searchParams.has('or')) {
      reads.push({ path, or: u.searchParams.get('or') });
    }
    return inner(input, init);
  };
  return reads;
}

test('folding works both ways: "café" finds plain "cafe", "cafe" finds "Café" through fold', async () => {
  db.card_index.push(
    cardRow(C1, 'Plain', 'we met at the cafe'),                    // fold NULL: nothing to fold
    cardRow(C2, 'Café notes', null, 'Cafe notes'),            // stored accented, folded
  );
  const accented = await api('GET', `/search?q=${encodeURIComponent('café')}&kind=card`);
  assert.deepEqual(accented.body.cards.items.map((c) => c.card_id).sort(), [C1, C2].sort());
  const plain = await api('GET', '/search?q=cafe&kind=card');
  assert.deepEqual(plain.body.cards.items.map((c) => c.card_id).sort(), [C1, C2].sort());
});

test('the fold terms are in the or-tree in both directions', async () => {
  const reads = recordReads();
  await api('GET', `/search?q=${encodeURIComponent('café')}&kind=card`);
  const card = reads.find((r) => r.path === 'card_index').or;
  assert.ok(card.includes('title.ilike.'), card);
  for (const col of ['title', 'body', 'meta->>fileName']) assert.ok(card.includes(`${col}.ilike."%cafe%"`), `${col} against the folded query`);
  assert.ok(card.includes('fold.ilike."%cafe%"'));
  const pages = reads.find((r) => r.path === 'doc_page_index').or;
  for (const col of ['page_title', 'page_text', 'fold']) assert.ok(pages.includes(`${col}.ilike."%cafe%"`), col);
});

test('a database without the fold column is retried once, on the raw words and the folded query', async () => {
  const inner = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    const path = u.pathname.replace(/^\/rest\/v1\//, '');
    if (path === 'card_index') {
      const or = u.searchParams.get('or') || '';
      calls.push(or);
      if (or.includes('fold.ilike')) {
        return reply({ code: '42703', message: 'column card_index.fold does not exist' }, 400);
      }
    }
    return inner(input, init);
  };
  db.card_index.push(cardRow(C1, 'Plain', 'we met at the cafe'));
  const r = await api('GET', `/search?q=${encodeURIComponent('café')}&kind=card`);
  assert.equal(r.status, 200);
  assert.equal(calls.length, 2, 'one try with fold, one retry without');
  assert.ok(!calls[1].includes('fold.ilike'));
  assert.ok(calls[1].includes('body.ilike."%cafe%"'), 'the folded query still reaches the raw columns');
  assert.deepEqual(r.body.cards.items.map((c) => c.card_id), [C1]);
});

test('only a missing column (42703) is retried', async () => {
  const inner = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    if (u.pathname.endsWith('/card_index')) {
      calls += 1;
      return reply({ code: '42501', message: 'permission denied' }, 403);
    }
    return inner(input, init);
  };
  const r = await api('GET', '/search?q=cafe&kind=card');
  assert.equal(calls, 1, 'no retry on another error');
  assert.notEqual(r.status, 200);
});

test('a board name: an accented query finds a plain name; the plain query does not find an accented one', async () => {
  db.boards.push(board(B1, 'Cafe lookbook'), board(B2, 'Café stills'));
  const accented = await api('GET', `/search?q=${encodeURIComponent('café')}&kind=board`);
  assert.deepEqual(accented.body.boards.items.map((b) => b.id).sort(), [B1, B2].sort());
  const plain = await api('GET', '/search?q=cafe&kind=board');
  assert.deepEqual(plain.body.boards.items.map((b) => b.id), [B1], 'boards have no fold column, so this direction is documented as not matched');
  assert.deepEqual(quotedPlain, []);
});
