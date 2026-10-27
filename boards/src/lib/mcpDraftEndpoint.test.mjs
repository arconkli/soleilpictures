// mcpDraftEndpoint.test.mjs — /mcp end to end against a stand-in database:
// someone in ChatGPT or Claude with no account (P3b).
//
//   node --test src/lib/mcpDraftEndpoint.test.mjs
//
// Nothing leaves the machine: fetch is replaced by a small fake of Supabase's
// auth admin API and PostgREST, holding drafts the way 0705 does.
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleMcpEndpoint } from '../worker-api.js';
import { HOSTED_TOOLS } from './mcpTools.js';
import { draftSecret, draftTokens, subjectHash, sha256Hex, DRAFT_INSTRUCTIONS, DRAFT_SAYS } from './mcpDrafts.js';

const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
const ORIGIN = 'https://main-soleil-boards.arconkli.workers.dev';
const WS = '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d';
const EXPIRES = '2026-11-26T00:00:00+00:00';
const CLAUDE = 'Claude-User/1.0';
const SUBJECT = 'v1/openai-anon-user';

let calls;
let routes;
let drafts;      // key_hash → the row mcp_draft_resolve answers from
let users;       // auth user id → address
let boards;
const realFetch = globalThis.fetch;

const reply = (body, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});
const on = (method, path, handle) => routes.push([(c) => c.method === method && c.path === path, handle]);
const rpcCalls = (fn) => calls.filter((c) => c.path === `rpc/${fn}`);

beforeEach(() => {
  calls = [];
  routes = [];
  drafts = new Map();
  users = new Map();
  boards = new Map();
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    const path = u.pathname.replace(/^\/rest\/v1\//, '');
    const call = { method, path, query: u.searchParams, body, headers: init.headers || {} };
    calls.push(call);
    for (const [match, handle] of routes) if (match(call)) return handle(call);

    if (path === '/auth/v1/admin/users' && method === 'POST') {
      const id = crypto.randomUUID();
      users.set(id, body.email);
      return reply({ id, email: body.email });
    }
    if (path.startsWith('/auth/v1/admin/users/') && method === 'DELETE') {
      users.delete(path.split('/').pop());
      return reply({});
    }
    if (path === 'rpc/mcp_draft_admit') return reply('ok');
    if (path === 'rpc/get_or_create_personal_workspace') return reply({ id: WS, name: 'Personal' });
    if (path === 'rpc/mcp_draft_register') {
      if (body.p_subject_hash && [...drafts.values()].some((d) => d.subject_hash === body.p_subject_hash && d.state === 'live')) {
        return reply({ code: '23505', message: 'duplicate key value violates unique constraint "mcp_drafts_live_subject"' }, 409);
      }
      drafts.set(body.p_key_hash, {
        draft_id: body.p_id, user_id: body.p_user_id, workspace_id: body.p_workspace_id,
        subject_hash: body.p_subject_hash, host: body.p_host, state: 'live', expires_at: EXPIRES,
      });
      return reply(EXPIRES);
    }
    if (path === 'rpc/mcp_draft_resolve') {
      let d = body.p_key_hash ? drafts.get(body.p_key_hash) : null;
      if (!d && body.p_subject_hash) d = [...drafts.values()].find((x) => x.subject_hash === body.p_subject_hash);
      if (!d) return reply([{ state: 'unknown', req_limit: 300 }]);
      return reply([{ ...d, req_count: 1, req_limit: 300, req_reset: '2026-10-27T15:04:05+00:00' }]);
    }
    if (path === 'rpc/api_session_begin') return reply([{ access_token: `jwt-${body.p_user_id}` }]);
    if (path === 'rpc/api_token_resolve') {
      return reply([{ user_id: 'u1', token_id: 't1', scopes: ['read', 'write', 'delete'], req_limit: 1000, req_count: 1 }]);
    }
    if (path === 'boards' && method === 'POST') {
      for (const r of body) boards.set(r.id, { deleted_at: null, ...r });
      return reply(undefined, 201);
    }
    if (path === 'boards' && method === 'GET') return reply([...boards.values()]);
    if (path.startsWith('rpc/')) return reply(null);
    return reply(method === 'GET' ? [] : null);
  };
});

afterEach(() => { globalThis.fetch = realFetch; });

async function post(message, { origin = ORIGIN, auth, ua } = {}) {
  const url = new URL(`${origin}/mcp`);
  const req = new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
      ...(ua ? { 'user-agent': ua } : {}),
    },
    body: JSON.stringify(message),
  });
  const res = await handleMcpEndpoint(url, req, ENV, null);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}
const rpc = (method, params = {}, opts) => post({ jsonrpc: '2.0', id: 1, method, params }, opts);
const callTool = (name, args, opts = {}) => rpc('tools/call', { name, arguments: args, ...(opts.meta ? { _meta: opts.meta } : {}) }, opts);
const textOf = (r) => (r.body.result?.content || []).map((c) => c.text).join('\n');

test('held on production: /mcp is not there', async () => {
  for (const origin of ['https://clusters.soleilpictures.com', 'https://soleil-boards.arconkli.workers.dev']) {
    const r = await rpc('initialize', { protocolVersion: '2025-11-25' }, { origin });
    assert.equal(r.status, 404, origin);
    assert.equal(r.body.code, 'not_found');
  }
  assert.equal(calls.length, 0);
});

test('signed out, the handshake and the tool list answer without touching the database', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-11-25' });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.instructions, DRAFT_INSTRUCTIONS);
  const list = await rpc('tools/list');
  assert.equal(list.status, 200);
  const tools = list.body.result.tools;
  assert.equal(tools.length, HOSTED_TOOLS.length);
  assert.deepEqual(tools.find((t) => t.name === 'create_boards').securitySchemes.map((s) => s.type), ['noauth', 'oauth2']);
  assert.ok(tools.find((t) => t.name === 'create_boards').inputSchema.properties.draft);
  assert.deepEqual(tools.find((t) => t.name === 'share_board').securitySchemes.map((s) => s.type), ['oauth2']);
  assert.equal(calls.length, 0);
});

test('a tool that needs an account asks to sign in: Claude by HTTP 401, ChatGPT in the answer', async () => {
  const claude = await callTool('share_board', { board_id: WS }, { ua: CLAUDE });
  assert.equal(claude.status, 401);
  const www = claude.headers.get('www-authenticate');
  assert.match(www, /error="invalid_token"/);
  assert.ok(www.includes(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`));
  assert.equal(claude.body.code, 'invalid_token');

  const chatgpt = await callTool('share_board', { board_id: WS }, { meta: { 'openai/subject': SUBJECT } });
  assert.equal(chatgpt.status, 200);
  assert.equal(chatgpt.body.result.isError, true);
  assert.equal(chatgpt.body.result.content[0].text, DRAFT_SAYS.signInFor('share_board'));
  assert.match(chatgpt.body.result._meta['mcp/www_authenticate'][0], /^Bearer resource_metadata=".*\/mcp", error="insufficient_scope"/);
  assert.equal(calls.length, 0, 'nothing is looked up for a tool no draft may use');
});

test('with no draft yet, only create_boards starts one; anything else asks to sign in', async () => {
  const read = await callTool('list_boards', {}, { ua: CLAUDE });
  assert.equal(read.status, 401);
  assert.equal(read.body.error, DRAFT_SAYS.nothingYet);
  const write = await callTool('add_cards', { board_id: WS, cards: [{ kind: 'note', body: 'x' }] },
    { meta: { 'openai/subject': SUBJECT } });
  assert.equal(write.body.result.isError, true);
  assert.equal(write.body.result.content[0].text, DRAFT_SAYS.nothingYet);
  assert.equal(users.size, 0, 'no account was made');
});

test('create_boards makes a draft and runs as it; the next call finds it by its key', async () => {
  const r = await callTool('create_boards', { boards: [{ name: 'Tokyo noir' }] }, { ua: CLAUDE });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.notEqual(r.body.result.isError, true, textOf(r));

  // The identity: a confirmed account at the draft's own address.
  const made = calls.find((c) => c.path === '/auth/v1/admin/users' && c.method === 'POST');
  assert.match(made.body.email, /^draft\+[0-9a-f-]{36}@draft\.soleilpictures\.com$/);
  assert.equal(made.body.email_confirm, true);
  assert.deepEqual(made.body.user_metadata, { draft: true, host: 'claude' });
  const [userId] = [...users.keys()];
  const draftId = made.body.email.slice('draft+'.length, -'@draft.soleilpictures.com'.length);

  // Its workspace, made for it by the service, then its row, holding hashes only.
  assert.deepEqual(rpcCalls('get_or_create_personal_workspace')[0].body, { p_user_id: userId, p_name: 'Personal' });
  const reg = rpcCalls('mcp_draft_register')[0].body;
  const tokens = await draftTokens(await draftSecret(ENV.SUPABASE_SERVICE_ROLE_KEY), draftId);
  assert.deepEqual(reg, {
    p_id: draftId, p_user_id: userId, p_workspace_id: WS, p_key_hash: tokens.keyHash,
    p_keep_hash: tokens.keepHash, p_subject_hash: null, p_host: 'claude',
  });
  assert.ok(!JSON.stringify(calls.map((c) => c.body)).includes(tokens.keep), 'the keep link is never sent anywhere');

  // The board was made as the draft, not as anyone else.
  const insert = calls.find((c) => c.path === 'boards' && c.method === 'POST');
  assert.equal(insert.headers.authorization, `Bearer jwt-${userId}`);
  assert.equal(insert.body[0].name, 'Tokyo noir');

  // The answer: the board's link leads to the keep page, then the key, the link and what a draft is.
  const keepUrl = `${ORIGIN}/keep/${tokens.keep}`;
  const text = textOf(r);
  assert.ok(text.includes(`${keepUrl}?b=${insert.body[0].id}`), text);
  assert.ok(!text.includes('?to=b:'), 'no link into the app');
  assert.ok(text.includes(tokens.key));
  assert.match(text, /Started a draft/);
  assert.equal(r.body.result._meta['clusters/draft'].keep_url, keepUrl);

  // The next call passes the key back and runs as the same draft.
  calls = [];
  const again = await callTool('create_boards', { draft: tokens.key, boards: [{ name: 'Palette' }] }, { ua: CLAUDE });
  assert.notEqual(again.body.result.isError, true, textOf(again));
  assert.deepEqual(rpcCalls('mcp_draft_resolve')[0].body, { p_key_hash: tokens.keyHash, p_subject_hash: null, p_write: true });
  assert.equal(users.size, 1, 'no second draft');
  assert.equal(calls.find((c) => c.path === 'boards' && c.method === 'POST').headers.authorization, `Bearer jwt-${userId}`);
  assert.doesNotMatch(textOf(again), /Started a draft/);
});

test('in ChatGPT the same anonymous user finds their draft without the key', async () => {
  const meta = { 'openai/subject': SUBJECT, 'openai/session': 's1' };
  const first = await callTool('create_boards', { boards: [{ name: 'Noir' }] }, { meta });
  assert.notEqual(first.body.result.isError, true, textOf(first));
  const subject = await subjectHash(await draftSecret(ENV.SUPABASE_SERVICE_ROLE_KEY), SUBJECT);
  assert.equal(rpcCalls('mcp_draft_register')[0].body.p_subject_hash, subject);
  assert.equal(rpcCalls('mcp_draft_register')[0].body.p_host, 'chatgpt');
  assert.ok(!JSON.stringify(calls.map((c) => c.body)).includes(SUBJECT), "OpenAI's own id is never stored");

  calls = [];
  const next = await callTool('list_boards', {}, { meta });
  assert.notEqual(next.body.result.isError, true, textOf(next));
  assert.deepEqual(rpcCalls('mcp_draft_resolve')[0].body, { p_key_hash: null, p_subject_hash: subject, p_write: false });
  assert.equal(users.size, 1);
});

test('a kept draft asks to sign in; a gone, unknown or malformed key is refused', async () => {
  const secret = await draftSecret(ENV.SUPABASE_SERVICE_ROLE_KEY);
  const kept = await draftTokens(secret, crypto.randomUUID());
  drafts.set(kept.keyHash, { draft_id: 'd1', state: 'kept' });
  const r1 = await callTool('add_cards', { draft: kept.key, board_id: WS, cards: [] }, { ua: CLAUDE });
  assert.equal(r1.status, 401);
  assert.equal(r1.body.error, DRAFT_SAYS.kept);

  const gone = await draftTokens(secret, crypto.randomUUID());
  drafts.set(gone.keyHash, { draft_id: 'd2', state: 'expired' });
  const r2 = await callTool('add_cards', { draft: gone.key, board_id: WS, cards: [] }, { ua: CLAUDE });
  assert.equal(r2.body.result.content[0].text, `Error: ${DRAFT_SAYS.expired}`);

  const unknown = await draftTokens(secret, crypto.randomUUID());
  const r3 = await callTool('create_boards', { draft: unknown.key, boards: [{ name: 'x' }] }, { ua: CLAUDE });
  assert.equal(r3.body.result.content[0].text, `Error: ${DRAFT_SAYS.unknown}`);
  assert.equal(users.size, 0, 'an unknown key never starts a draft');

  calls = [];
  const r4 = await callTool('create_boards', { draft: 'sk_live_123', boards: [{ name: 'x' }] }, { ua: CLAUDE });
  assert.equal(r4.body.result.content[0].text, `Error: ${DRAFT_SAYS.notAKey}`);
  assert.equal(calls.length, 0);

  const busy = await draftTokens(secret, crypto.randomUUID());
  drafts.set(busy.keyHash, { draft_id: 'd3', user_id: 'u3', state: 'rate_limited' });
  const r5 = await callTool('list_boards', { draft: busy.key }, { ua: CLAUDE });
  assert.match(r5.body.result.content[0].text, /300 requests .* 15:04 UTC/);
});

test('past the day\'s ceiling no draft is started, and a person is asked to sign in instead', async () => {
  on('POST', 'rpc/mcp_draft_admit', () => reply('paused'));
  const r = await callTool('create_boards', { boards: [{ name: 'x' }] }, { ua: CLAUDE });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, DRAFT_SAYS.paused);
  assert.equal(users.size, 0);
});

test('a draft that fails half-way is taken apart again', async () => {
  on('POST', 'rpc/mcp_draft_register', () => reply({ code: '22023', message: 'not a draft identity' }, 400));
  const r = await callTool('create_boards', { boards: [{ name: 'x' }] }, { ua: CLAUDE });
  assert.equal(r.body.error?.code, -32603, 'an internal error, with a reference');
  assert.equal(users.size, 0, 'the auth user is deleted');
  assert.ok(calls.some((c) => c.path === 'workspaces' && c.method === 'DELETE' && c.query.get('id') === `eq.${WS}`),
    'and its workspace');
});

test("one ChatGPT user's first two calls at once share one draft", async () => {
  const meta = { 'openai/subject': SUBJECT };
  const secret = await draftSecret(ENV.SUPABASE_SERVICE_ROLE_KEY);
  // The other call registered first, between this one's lookup and its register.
  const subject = await subjectHash(secret, SUBJECT);
  const otherId = crypto.randomUUID();
  const other = await draftTokens(secret, otherId);
  let looked = 0;
  on('POST', 'rpc/mcp_draft_resolve', (c) => {
    looked += 1;
    if (looked === 1) return reply([{ state: 'unknown', req_limit: 300 }]);
    drafts.set(other.keyHash, { draft_id: otherId, user_id: 'u-other', workspace_id: WS, subject_hash: subject, state: 'live', expires_at: EXPIRES });
    return reply([{ ...drafts.get(other.keyHash), req_count: 1, req_limit: 300 }]);
  });
  on('POST', 'rpc/mcp_draft_register', () => {
    drafts.set(other.keyHash, { draft_id: otherId, user_id: 'u-other', workspace_id: WS, subject_hash: subject, state: 'live', expires_at: EXPIRES });
    return reply({ code: '23505', message: 'duplicate key value violates unique constraint "mcp_drafts_live_subject"' }, 409);
  });
  const r = await callTool('create_boards', { boards: [{ name: 'Noir' }] }, { meta });
  assert.notEqual(r.body.result.isError, true, textOf(r));
  assert.equal(users.size, 0, "this call's own account was undone");
  assert.equal(calls.find((c) => c.path === 'boards' && c.method === 'POST').headers.authorization, 'Bearer jwt-u-other');
  assert.ok(textOf(r).includes(other.key), 'and it answers with the draft that won');
});

test('a draft never reaches a route its tools do not use, even if a tool tried', async () => {
  const first = await callTool('create_boards', { boards: [{ name: 'Noir' }] }, { ua: CLAUDE });
  const key = first.body.result._meta['clusters/draft'].key;
  const search = HOSTED_TOOLS.find((t) => t.name === 'search');
  const real = search.call;
  search.call = (a, { api }) => api(`/boards/${WS}/share-link`, { method: 'POST', body: {} });
  try {
    calls = [];
    const r = await callTool('search', { draft: key, query: 'neon' }, { ua: CLAUDE });
    assert.equal(r.body.result.isError, true);
    assert.match(r.body.result.content[0].text, /a draft can make and change its own clusters/);
    assert.ok(!calls.some((c) => /share|public_link/.test(c.path)), 'nothing was published');
  } finally {
    search.call = real;
  }
});

test('signed in, /mcp is the API with the same tool list, and a stale draft key is ignored', async () => {
  const list = await rpc('tools/list', {}, { auth: 'Bearer sk_live_test' });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.result.tools.find((t) => t.name === 'add_cards').securitySchemes.map((s) => s.type),
    ['noauth', 'oauth2']);
  const r = await callTool('list_boards', { draft: `dk_${'a'.repeat(43)}` }, { auth: 'Bearer sk_live_test' });
  assert.equal(r.status, 200);
  assert.notEqual(r.body.result.isError, true, textOf(r));
  assert.equal(rpcCalls('mcp_draft_resolve').length, 0);
  assert.ok(calls.some((c) => c.path === 'boards' && c.headers.authorization === 'Bearer jwt-u1'));
});

test('a refused token is sent to sign in for /mcp itself', async () => {
  on('POST', 'rpc/api_token_resolve', () => reply([]));
  const r = await rpc('tools/list', {}, { auth: 'Bearer sk_live_revoked' });
  assert.equal(r.status, 401);
  assert.ok(r.headers.get('www-authenticate').includes(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`));
});

test('the draft key and keep link are derived, so the keep hash the RPC gets is the real one', async () => {
  const secret = await draftSecret(ENV.SUPABASE_SERVICE_ROLE_KEY);
  const t = await draftTokens(secret, 'a0a0a0a0-b1b1-4c2c-8d3d-e4e4e4e4e4e4');
  assert.equal(t.keepHash, await sha256Hex(t.keep));
});
