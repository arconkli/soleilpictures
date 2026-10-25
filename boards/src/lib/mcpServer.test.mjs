// The MCP registry and the hosted server.
//
// Two things are being protected here.
//
// One: that the stdio package and the Worker really do serve the SAME tools.
// They are two files on disk — one generated from the other — and a client
// finding a tool on one transport and not the other looks like a client bug,
// which is the most expensive kind of drift there is.
//
// Two: that the JSON-RPC shell answers the way the protocol says. A client
// speaks to this over a socket and gets whatever it gets; there is no type
// system between them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TOOLS, HOSTED_TOOLS, PROMPTS, SERVER_INFO, RENAMED, RENAMED_PROMPTS, TREE_MAX, toolManifest, apiErrorFrom, ApiError,
  parseFetchId,
} from './mcpTools.js';
import {
  handleMcpMessage, handleMcpRequest, headerProblem, decodeHeaderValue,
  SUPPORTED_PROTOCOL_VERSIONS, META, ERR, INSTRUCTIONS,
} from './mcpServer.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const BOARD_ID = '3f2a6c1e-8b4d-4e7a-9c1f-2d5e8a7b6c4d';

// ── one registry, two copies ─────────────────────────────────────────────────

const STRIP_BANNER = /^\/\/ GENERATED[^\n]*\n\/\/ Regenerate[^\n]*\n\n/;

test('the npm package ships the same registry the Worker serves', () => {
  const source = readFileSync(resolve(REPO, 'boards/src/lib/mcpTools.js'), 'utf8');
  const copy = readFileSync(resolve(REPO, 'mcp/src/tools.js'), 'utf8');
  assert.equal(copy.replace(STRIP_BANNER, ''), source,
    'mcp/src/tools.js is stale — run `npm run sync` in mcp/. '
    + 'A tool present on one transport and missing on the other looks like a client bug.');
});

// The npm README and server.json are the two things a stranger reads BEFORE
// installing anything, and neither is covered by the docs gate — that one reads
// boards/content/docs. The README claimed "29 tools" for weeks after there were
// 33, which is the sort of small lie that makes someone doubt the rest of it.
test('the npm README states the real tool count', () => {
  const readme = readFileSync(resolve(REPO, 'mcp/README.md'), 'utf8');
  const claimed = readme.match(/(\d+)\s+tools:/);
  assert.ok(claimed, 'mcp/README.md should say how many tools there are');
  assert.equal(Number(claimed[1]), TOOLS.length,
    `mcp/README.md says ${claimed[1]} tools; the registry has ${TOOLS.length}. `
    + 'The local package serves TOOLS (the hosted one serves HOSTED_TOOLS, which is one fewer '
    + '— upload_file needs a filesystem).');
});

test('server.json and package.json agree on the registry name', () => {
  // The MCP Registry verifies ownership by matching `mcpName` in the published
  // npm package against `name` in server.json. If they drift, publishing fails
  // with a message about package validation that does not name either file.
  const server = JSON.parse(readFileSync(resolve(REPO, 'mcp/server.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(resolve(REPO, 'mcp/package.json'), 'utf8'));
  assert.equal(server.name, pkg.mcpName,
    'mcp/server.json `name` must equal mcp/package.json `mcpName`');
  assert.equal(server.version, pkg.version,
    'mcp/server.json `version` must match the package version being published');
  const npmPackage = (server.packages || []).find((p) => p.registryType === 'npm');
  assert.equal(npmPackage?.identifier, pkg.name);
  assert.equal(npmPackage?.version, pkg.version);
  // And the server reports the same release it ships as, on both transports.
  assert.equal(SERVER_INFO.version, pkg.version,
    'SERVER_INFO.version in mcpTools.js must equal mcp/package.json `version`');
  // The hosted server is the recommended route, so it must actually be listed —
  // a registry entry with only the npm package would send everyone down the
  // harder path.
  assert.ok((server.remotes || []).some((r) => r.type === 'streamable-http' && /\/api\/v1\/mcp$/.test(r.url)),
    'server.json must advertise the hosted streamable-http endpoint');

  // The registry caps this at 100 and rejects the whole publish with a 422.
  // Learned the hard way at 197 characters, with npm already published and
  // therefore no way to back out and rethink the wording.
  assert.ok(server.description.length <= 100,
    `server.json description is ${server.description.length} chars; the MCP Registry allows 100`);
});

// Found by installing the package from npm and reading the audit log: the stdio
// server is not an MCP client talking to /mcp, it IS an MCP server that speaks
// plain REST. Without this header every call it makes is indistinguishable from
// a hand-written script and the admin tools table is empty for its users.
test('the stdio package tells the API which tool it is acting for', () => {
  const pkg = readFileSync(resolve(REPO, 'mcp/src/index.js'), 'utf8');
  assert.match(pkg, /'mcp-name': tool/,
    'mcp/src/index.js must send Mcp-Name on calls made on behalf of a tool');
  assert.match(pkg, /'mcp-method': 'tools\/call'/,
    'and Mcp-Method beside it, as the revision defines');

  const worker = readFileSync(resolve(REPO, 'boards/src/worker-api.js'), 'utf8');
  assert.match(worker, /request\.headers\.get\('mcp-name'\)/,
    'worker-api.js must read Mcp-Name into the request trace');
  // It is a log annotation, so it must be bounded and never trusted for a
  // decision — the header is attacker-controlled.
  assert.match(worker, /\[a-z0-9_\/\.-\]\{1,80\}/i,
    'the header must be length- and charset-bounded before it is recorded');
  assert.match(worker, /access-control-allow-headers[\s\S]{0,160}mcp-name/,
    'and be allowed through CORS, or a browser-based client cannot send it');
});

test('the npm package ships the same PROTOCOL the Worker serves', () => {
  // This matters more than the registry copy. A tool missing from one
  // transport looks like a client bug; a protocol that differs between them
  // fails at connection time with nothing useful to read.
  const source = readFileSync(resolve(REPO, 'boards/src/lib/mcpServer.js'), 'utf8');
  const copy = readFileSync(resolve(REPO, 'mcp/src/server.js'), 'utf8');
  const expected = source
    .replace("from './mcpTools.js'", "from './tools.js'")
    .replace("from './mcpValidate.js'", "from './validate.js'");
  assert.equal(copy.replace(STRIP_BANNER, ''), expected,
    'mcp/src/server.js is stale — run `npm run sync` in mcp/.');
  // The permitted edits must actually have applied; if an import is ever
  // renamed, the copy would silently ship a broken specifier.
  assert.match(copy, /from '\.\/tools\.js'/);
  assert.match(copy, /from '\.\/validate\.js'/);
});

test('the npm package holds calls to the same argument rules the Worker does', () => {
  const source = readFileSync(resolve(REPO, 'boards/src/lib/mcpValidate.js'), 'utf8');
  const copy = readFileSync(resolve(REPO, 'mcp/src/validate.js'), 'utf8');
  assert.equal(copy.replace(STRIP_BANNER, ''), source,
    'mcp/src/validate.js is stale — run `npm run sync` in mcp/.');
});

// ── the shape of a tool ──────────────────────────────────────────────────────

test('update_cards can change every field add_cards can set', () => {
  // The two schemas are written separately and the update fell behind once:
  // with additionalProperties false, a validating client refused group_id,
  // z, rotation and the audio/pdf kinds on an update (audit API-18).
  const tool = (name) => TOOLS.find((t) => t.name === name);
  const item = tool('add_cards').inputSchema.properties.cards.items;
  const update = tool('update_cards').inputSchema.properties.cards.items;
  const missing = Object.keys(item.properties).filter((k) => !(k in update.properties));
  assert.deepEqual(missing, [], `update_cards is missing ${missing.join(', ')}`);
  assert.deepEqual(update.properties.kind.enum, item.properties.kind.enum);
  assert.deepEqual(update.required, ['id']);
  assert.equal(update.additionalProperties, false, 'a misspelt field is refused, not dropped');
});

test('the MCP card kinds are the API\'s', () => {
  const api = readFileSync(resolve(REPO, 'boards/src/worker-api.js'), 'utf8');
  const kinds = [...api.match(/const CARD_KINDS = \[([^\]]+)\]/)[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
  const item = TOOLS.find((t) => t.name === 'add_cards').inputSchema.properties.cards.items;
  assert.deepEqual([...item.properties.kind.enum].sort(), [...kinds].sort());
});

test('every tool is well formed', () => {
  const names = new Set();
  for (const t of TOOLS) {
    assert.match(t.name, /^[a-z][a-z_]*$/, `${t.name}: snake_case only`);
    assert.equal(names.has(t.name), false, `${t.name} is defined twice`);
    names.add(t.name);
    assert.ok(t.title, `${t.name}: needs a title`);
    assert.ok(t.description?.length > 40, `${t.name}: description is too thin to be useful`);
    assert.equal(typeof t.call, 'function', `${t.name}: needs an implementation`);
    assert.equal(t.inputSchema.type, 'object', `${t.name}: inputSchema must be an object schema`);
    assert.ok(t.inputSchema.properties, `${t.name}: inputSchema needs properties`);
  }
});

test('every tool declares all four annotations', () => {
  // A client reads these when deciding whether a call needs confirming. A
  // missing destructiveHint is not a neutral default — it reads as "safe".
  for (const t of TOOLS) {
    for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
      assert.equal(typeof t.annotations?.[hint], 'boolean', `${t.name}: missing ${hint}`);
    }
  }
});

test('anything that deletes is marked destructive, and nothing else is', () => {
  const destructive = TOOLS.filter((t) => t.annotations.destructiveHint).map((t) => t.name).sort();
  // unshare_board deletes nothing anyone made, but a revoked link never opens
  // again for anyone holding it: irreversible for other people, so a client
  // should ask first. edit_doc_page can take a page's words away; the board
  // goes to Version history first, but getting them back is done in the app.
  assert.deepEqual(destructive, ['delete_board', 'delete_cards', 'edit_doc_page', 'unshare_board']);
  // And a read-only tool must not also claim to write.
  for (const t of TOOLS) {
    if (t.annotations.readOnlyHint) {
      assert.equal(t.annotations.destructiveHint, false, `${t.name}: cannot be read-only AND destructive`);
    }
  }
});

test('every read tool is marked read-only', () => {
  // If a tool that only fetches is not marked readOnlyHint, a careful client
  // will ask the user to confirm reading a board — which trains them to
  // click through confirmations.
  const reads = ['whoami', 'search', 'fetch', 'list_boards', 'resolve_identifier', 'read_board',
    'view_board', 'list_comments', 'list_tags', 'list_audit'];
  for (const name of reads) {
    const t = TOOLS.find((x) => x.name === name);
    assert.ok(t, `${name} is missing from the registry`);
    assert.equal(t.annotations.readOnlyHint, true, `${name} should be read-only`);
  }
});

test('the hosted registry drops only what needs a local filesystem', () => {
  const dropped = TOOLS.filter((t) => t.local).map((t) => t.name);
  assert.deepEqual(dropped, ['upload_file']);
  assert.equal(HOSTED_TOOLS.length, TOOLS.length - 1);
  assert.equal(HOSTED_TOOLS.some((t) => t.name === 'upload_file'), false,
    'a tool that can only fail is worse than one that is absent');
});

test('a local-only tool refuses cleanly when there is no filesystem', async () => {
  const t = TOOLS.find((x) => x.name === 'upload_file');
  await assert.rejects(() => t.call({ path: '/x' }, { api: async () => ({}) }),
    /local filesystem/);
});

// ── the JSON-RPC shell ───────────────────────────────────────────────────────

const ctx = { api: async (path, opts) => ({ echoed: path, method: opts?.method || 'GET' }) };

// A LEGACY call: no per-request _meta, exactly as a client that opened with
// `initialize` sends. Every assertion below that does not say otherwise is
// about the era every shipping client is still on.
const rpc = (method, params, id = 1) =>
  handleMcpMessage({ jsonrpc: '2.0', id, method, params }, ctx).then((r) => r.body);

test('initialize negotiates and advertises only what is implemented', async () => {
  const r = await rpc('initialize', { protocolVersion: '2025-06-18' });
  assert.ok(r.result.protocolVersion);
  assert.equal(r.result.serverInfo.name, 'soleil-clusters');
  assert.deepEqual(Object.keys(r.result.capabilities).sort(), ['prompts', 'tools']);
  // Advertising resources or subscriptions and never sending one is worse than
  // not advertising: a client waits for something that is never coming.
  assert.equal('resources' in r.result.capabilities, false);
  assert.ok(r.result.instructions);
});

test('initialize echoes a version we implement, and names our best when it does not', async () => {
  // Answering a 2025-06-18 client with 2025-11-25 would make it disconnect over
  // a version number, which is the least actionable failure there is.
  assert.equal((await rpc('initialize', { protocolVersion: '2025-06-18' })).result.protocolVersion,
    '2025-06-18');
  assert.equal((await rpc('initialize', { protocolVersion: '2025-11-25' })).result.protocolVersion,
    '2025-11-25');
  assert.equal((await rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion,
    '2025-11-25', 'an unknown version gets our best legacy answer, not a refusal');
});

test('a legacy result carries no modern fields', async () => {
  // resultType and the serverInfo _meta key are 2026-07-28 additions. A client
  // validating against the older schema has no reason to expect either.
  const r = await rpc('tools/list');
  assert.equal('resultType' in r.result, false);
  assert.equal('ttlMs' in r.result, false);
  assert.equal('_meta' in r.result, false);
});

test('notifications get no reply at all', async () => {
  const one = await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx);
  assert.equal(one.body, null);
  assert.equal(one.status, 202);
  assert.equal((await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/anything' }, ctx)).body, null);
});

test('tools/list returns the hosted registry in protocol shape', async () => {
  const r = await rpc('tools/list');
  assert.equal(r.result.tools.length, HOSTED_TOOLS.length);
  const one = r.result.tools[0];
  assert.deepEqual(Object.keys(one).sort(),
    Object.keys(toolManifest(HOSTED_TOOLS[0])).sort());
  // The implementation must not leak into the wire.
  assert.equal('call' in one, false);
  assert.equal('local' in one, false);
});

test('tools/call runs the tool and returns content', async () => {
  const r = await rpc('tools/call', { name: 'whoami', arguments: {} });
  assert.equal(r.result.isError, undefined);
  assert.equal(r.result.content[0].type, 'text');
  assert.match(r.result.content[0].text, /\/me/);
  // whoami declares an outputSchema, so it also carries structured content.
  assert.ok(r.result.structuredContent);
});

test('a tool that FAILS is a successful call with isError, not an RPC error', async () => {
  // The distinction matters: an RPC error tells a model only that something
  // broke, while isError plus the API's own sentence tells it what to do.
  const failing = { api: async () => { throw new Error('this token cannot delete'); } };
  const { body } = await handleMcpMessage(
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'delete_board', arguments: { board_id: BOARD_ID } } },
    failing);
  assert.equal(body.error, undefined);
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /cannot delete/);
});

test('an unknown tool is an RPC error that lists what exists', async () => {
  const r = await rpc('tools/call', { name: 'delete_everything' });
  assert.equal(r.error.code, -32602);
  assert.ok(r.error.data.available.includes('whoami'));
  assert.equal(r.error.data.renamed_to, undefined);
});

test('a tool folded into another in 3.0 says which one, and how', async () => {
  // A host may hold the tool list from before 3.0 for a while and call an old
  // name: it is told what does that now, not only that the name is unknown.
  const r = await rpc('tools/call', { name: 'get_board', arguments: { board_id: BOARD_ID } });
  assert.equal(r.error.code, -32602);
  assert.match(r.error.message, /^get_board is gone since version 3\.0: read_board answers with the board/);
  assert.equal(r.error.data.renamed_to, 'read_board');
  assert.ok(r.error.data.available.includes('read_board'));
  // and the map is honest: every old name is gone, every new one is real
  const names = new Set(TOOLS.map((t) => t.name));
  for (const [old, { to, how }] of Object.entries(RENAMED)) {
    assert.ok(!names.has(old), `${old} is still a tool`);
    assert.ok(names.has(to), `${old} → ${to}, which is not a tool`);
    assert.ok(how.includes(to), `${old}: say how ${to} does it`);
  }
  // A name that only looks like a key of the map is still just unknown.
  assert.equal((await rpc('tools/call', { name: 'constructor' })).error.message, 'unknown tool: constructor');
});

test('a local-only tool is not callable over the hosted transport', async () => {
  const r = await rpc('tools/call', { name: 'upload_file', arguments: { path: '/x' } });
  assert.equal(r.error.code, -32602, 'it must not be reachable, not merely fail');
});

test('prompts list and render with their arguments', async () => {
  const list = await rpc('prompts/list');
  assert.equal(list.result.prompts.length, PROMPTS.length);
  const got = await rpc('prompts/get', { name: 'review_board', arguments: { board_id: 'b-1' } });
  assert.equal(got.result.messages[0].role, 'user');
  assert.match(got.result.messages[0].content.text, /b-1/);
  const brief = await rpc('prompts/get', { name: 'moodboard', arguments: { brief: 'a 70s Tokyo noir' } });
  assert.match(brief.result.messages[0].content.text, /a 70s Tokyo noir/);
  assert.doesNotMatch(brief.result.messages[0].content.text, /workspace undefined|in workspace/);
});

test('a prompt missing a required argument says which one', async () => {
  const r = await rpc('prompts/get', { name: 'review_board', arguments: {} });
  assert.equal(r.error.code, -32602);
  assert.match(r.error.message, /board_id/);
});

test('a prompt renamed in 3.0 names its new name', async () => {
  const r = await rpc('prompts/get', { name: 'describe_board', arguments: { board_id: 'b-1' } });
  assert.equal(r.error.code, -32602);
  assert.equal(r.error.message, 'prompt describe_board is now review_board');
  assert.equal(r.error.data.renamed_to, 'review_board');
  for (const to of Object.values(RENAMED_PROMPTS)) assert.ok(PROMPTS.some((p) => p.name === to), to);
});

test('every prompt names only tools that exist', () => {
  const names = new Set(TOOLS.map((t) => t.name));
  for (const p of PROMPTS) {
    const args = Object.fromEntries((p.arguments || []).map((a) => [a.name, `<${a.name}>`]));
    for (const [, n] of p.render(args).matchAll(/\b([a-z]+_[a-z_]+)\b/g)) {
      if (!['board_id', 'workspace_id', 'on_conflict'].includes(n)) assert.ok(names.has(n), `prompt ${p.name} names ${n}`);
    }
  }
});

test('an unsupported method is method-not-found, not a hang', async () => {
  const r = await rpc('completion/complete', {});
  assert.equal(r.error.code, -32601);
});

test('resources answer empty rather than erroring', async () => {
  // A client probing for resources should get a clean "none" it can branch on.
  assert.deepEqual((await rpc('resources/list')).result, { resources: [] });
  assert.deepEqual((await rpc('resources/templates/list')).result, { resourceTemplates: [] });
});

// ── 2026-07-28: the handshake is gone ────────────────────────────────────────
//
// The revision that deleted `initialize`. Version, identity and capabilities
// ride in `_meta` on every request, so any instance can answer any request —
// which is what this server always wanted to be, since a Worker isolate does
// not survive between requests anyway.

const MODERN = '2026-07-28';
const meta = (over = {}) => ({
  [META.protocolVersion]: MODERN,
  [META.clientInfo]: { name: 'test-client', version: '1.0.0' },
  [META.clientCapabilities]: {},
  ...over,
});
const modernRpc = (method, params = {}, id = 1) =>
  handleMcpMessage({ jsonrpc: '2.0', id, method, params: { ...params, _meta: meta() } }, ctx);

test('server/discover is answered — the spec says servers MUST implement it', async () => {
  const { body, status } = await handleMcpMessage(
    { jsonrpc: '2.0', id: 'd1', method: 'server/discover', params: { _meta: meta() } }, ctx);
  assert.equal(status, 200);
  assert.deepEqual(body.result.supportedVersions, SUPPORTED_PROTOCOL_VERSIONS);
  assert.equal(body.result.supportedVersions[0], MODERN, 'newest first: it is a preference order');
  assert.deepEqual(Object.keys(body.result.capabilities).sort(), ['prompts', 'tools']);
  assert.equal(body.result._meta[META.serverInfo].name, 'soleil-clusters');
  assert.equal(body.result.resultType, 'complete');
  assert.ok(body.result.ttlMs > 0);
});

test('discover answers in modern shape even to a client that declared nothing', async () => {
  // It is the stdio backward-compatibility probe: a dual-era client sends it
  // FIRST, before it knows what this server is. Refusing it for lack of _meta
  // would defeat the only mechanism stdio has for era detection.
  const { body } = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'server/discover' }, ctx);
  assert.equal(body.result.resultType, 'complete');
  assert.ok(body.result.supportedVersions.includes(MODERN));
});

test('a modern result carries resultType and identifies its server', async () => {
  const { body } = await modernRpc('tools/list');
  assert.equal(body.result.resultType, 'complete');
  assert.equal(body.result._meta[META.serverInfo].name, 'soleil-clusters');
  assert.equal(body.result.ttlMs, 300_000);
  assert.equal(body.result.cacheScope, 'public');
  assert.equal(body.result.tools.length, HOSTED_TOOLS.length);
});

test('the tool list is deterministic, so a client can cache it', async () => {
  const a = (await modernRpc('tools/list')).body.result.tools.map((t) => t.name);
  const b = (await modernRpc('tools/list')).body.result.tools.map((t) => t.name);
  assert.deepEqual(a, b);
});

test('an unsupported version lists what IS supported, with 400', async () => {
  const { body, status } = await handleMcpMessage({
    jsonrpc: '2.0', id: 1, method: 'tools/list',
    params: { _meta: { ...meta(), [META.protocolVersion]: '1900-01-01' } },
  }, ctx);
  assert.equal(status, 400);
  assert.equal(body.error.code, ERR.UNSUPPORTED_PROTOCOL_VERSION);
  assert.equal(body.error.code, -32022);
  assert.deepEqual(body.error.data.supported, SUPPORTED_PROTOCOL_VERSIONS);
  assert.equal(body.error.data.requested, '1900-01-01');
});

test('a modern request without client capabilities is malformed', async () => {
  // The server is forbidden from relying on a capability the client did not
  // declare, which is only enforceable if declaring is mandatory.
  const { body, status } = await handleMcpMessage({
    jsonrpc: '2.0', id: 1, method: 'tools/list',
    params: { _meta: { [META.protocolVersion]: MODERN } },
  }, ctx);
  assert.equal(status, 400);
  assert.equal(body.error.code, ERR.INVALID_PARAMS);
  assert.match(body.error.message, /clientCapabilities/);
});

test('an unknown method is 404 in the modern era and 200 in the legacy one', async () => {
  const modern = await modernRpc('completion/complete');
  assert.equal(modern.status, 404);
  assert.equal(modern.body.error.code, ERR.METHOD_NOT_FOUND);
  const legacy = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'completion/complete' }, ctx);
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.error.code, ERR.METHOD_NOT_FOUND);
});

test('ping is gone in 2026-07-28 but still answered for legacy clients', async () => {
  // A stateless protocol has no connection to keep alive. Removing it for
  // everyone would break every client shipping today.
  assert.equal((await modernRpc('ping')).status, 404);
  assert.deepEqual((await rpc('ping')).result, {});
});

test('tools still run, and still report their own failures as content', async () => {
  const good = await modernRpc('tools/call', { name: 'whoami', arguments: {} });
  assert.equal(good.body.result.resultType, 'complete');
  assert.equal(good.body.result.isError, undefined);
  const failing = { api: async () => { throw new Error('this token cannot delete'); } };
  const bad = await handleMcpMessage({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'delete_board', arguments: { board_id: BOARD_ID }, _meta: meta() },
  }, failing);
  assert.equal(bad.body.error, undefined);
  assert.equal(bad.body.result.isError, true);
});

// ── mirrored headers ─────────────────────────────────────────────────────────

const modernPost = (msg, headers = {}) => new Request('https://x/api/v1/mcp', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'mcp-protocol-version': MODERN,
    'mcp-method': msg.method,
    ...(msg.params?.name ? { 'mcp-name': msg.params.name } : {}),
    ...headers,
  },
  body: JSON.stringify(msg),
});

const modernMsg = (method, params = {}) => ({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: meta() } });

test('mirrored headers that agree with the body are accepted', async () => {
  const msg = modernMsg('tools/call', { name: 'whoami', arguments: {} });
  const out = await handleMcpRequest(modernPost(msg), ctx, msg);
  assert.equal(out.status, 200);
  assert.equal(out.body.result.resultType, 'complete');
});

test('a header that disagrees with the body is refused', async () => {
  // The whole reason the headers exist is that an intermediary may route on
  // them without parsing the body. Two components acting on different values
  // is the vulnerability this closes.
  const msg = modernMsg('tools/call', { name: 'whoami', arguments: {} });
  const out = await handleMcpRequest(modernPost(msg, { 'mcp-name': 'delete_board' }), ctx, msg);
  assert.equal(out.status, 400);
  assert.equal(out.body.error.code, ERR.HEADER_MISMATCH);
  assert.equal(out.body.error.code, -32020);
  assert.match(out.body.error.message, /Mcp-Name/);
});

test('every required header is required', async () => {
  const msg = modernMsg('tools/call', { name: 'whoami', arguments: {} });
  for (const drop of ['mcp-protocol-version', 'mcp-method', 'mcp-name']) {
    const headers = new Headers({
      'mcp-protocol-version': MODERN, 'mcp-method': msg.method, 'mcp-name': 'whoami',
    });
    headers.delete(drop);
    assert.match(headerProblem(headers, msg) || '', new RegExp(drop.replace(/-/g, '.'), 'i'),
      `${drop} must be required`);
  }
});

test('Mcp-Name is only required where the spec says it is', async () => {
  const list = modernMsg('tools/list');
  const headers = new Headers({ 'mcp-protocol-version': MODERN, 'mcp-method': 'tools/list' });
  assert.equal(headerProblem(headers, list), null);
});

test('a legacy request has no header contract at all', () => {
  // Legacy clients send none of this. Enforcing it would break every client
  // shipping today, which is the whole reason this server is dual-era.
  assert.equal(headerProblem(new Headers({}), { method: 'tools/list', params: {} }), null);
});

test('a name that is not plain ASCII round-trips through the base64 sentinel', () => {
  assert.equal(decodeHeaderValue('=?base64?SGVsbG8sIOS4lueVjA==?='), 'Hello, 世界');
  assert.equal(decodeHeaderValue('whoami'), 'whoami', 'a plain value is left alone');
  // A malformed sentinel must not throw — it is attacker-controlled input.
  assert.equal(decodeHeaderValue('=?base64?!!!?='), '=?base64?!!!?=');
});

test('batching is refused in 2026-07-28 and still works for legacy clients', async () => {
  // The modern transport requires one message per POST — the mirrored headers
  // describe a single method and name, so a batch cannot be validated at all.
  const batch = [modernMsg('tools/list'), modernMsg('prompts/list')];
  const out = await handleMcpRequest(modernPost(batch[0]), ctx, batch);
  assert.equal(out.status, 400);
  assert.equal(out.body.error.code, ERR.INVALID_REQUEST);
  assert.match(out.body.error.message, /batching/);
});

// ── the HTTP shell ───────────────────────────────────────────────────────────

const post = (body) => new Request('https://x/api/v1/mcp', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('GET is refused with a reason, not left to hang', async () => {
  const out = await handleMcpRequest(new Request('https://x/api/v1/mcp'), ctx);
  assert.equal(out.status, 405);
  assert.match(out.body.error, /POST/);
});

test('a batch is answered as a batch', async () => {
  const out = await handleMcpRequest(post([
    { jsonrpc: '2.0', id: 1, method: 'ping' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ]), ctx);
  assert.equal(out.status, 200);
  assert.equal(out.body.length, 2);
  assert.deepEqual(out.body.map((r) => r.id), [1, 2]);
});

test('a batch of only notifications gets 202 and no body', async () => {
  const out = await handleMcpRequest(post([{ jsonrpc: '2.0', method: 'notifications/initialized' }]), ctx);
  assert.equal(out.status, 202);
  assert.equal(out.body, null);
});

test('a malformed body is a parse error, not a crash', async () => {
  const out = await handleMcpRequest(new Request('https://x/api/v1/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
  }), ctx);
  assert.equal(out.status, 400);
  assert.equal(out.body.error.code, -32700);
});

test('one tool throwing does not take down the rest of a batch', async () => {
  let n = 0;
  const flaky = { api: async () => { n++; if (n === 1) throw new Error('boom'); return { ok: true }; } };
  const out = await handleMcpRequest(post([
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whoami' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_boards' } },
  ]), flaky);
  assert.equal(out.body[0].result.isError, true);
  assert.equal(out.body[1].result.isError, undefined);
});

// ── what a model is told when a call goes wrong ──────────────────────────────

test('bad arguments are a tool error naming the path, and the API is never called', async () => {
  let called = false;
  const watch = { api: async () => { called = true; return {}; } };
  const { body } = await handleMcpMessage({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'read_board', arguments: { boardId: BOARD_ID } },
  }, watch);
  assert.equal(body.error, undefined, 'a model self-corrects from isError; an RPC error tells it nothing');
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /^Error: Invalid arguments for read_board:\n- boardId is not an argument here — did you mean board_id\?/);
  assert.equal(called, false);
});

test('the tool receives its arguments as checked, not as sent', async () => {
  let seen = null;
  const watch = { api: async (path) => { seen = path; return { cards: [] }; } };
  await handleMcpMessage({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'read_board', arguments: { board_id: BOARD_ID, limit: '25', source: null } },
  }, watch);
  assert.equal(seen, `/boards/${BOARD_ID}/cards?include=groups&limit=25`);
});

test('an API refusal reaches the model with its code and advice, on either transport', async () => {
  const refusing = {
    api: async () => {
      throw apiErrorFrom(403, {
        error: 'this token cannot delete', code: 'insufficient_scope', scopes: ['read', 'write'],
      });
    },
  };
  const { body } = await handleMcpMessage({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'delete_board', arguments: { board_id: BOARD_ID } },
  }, refusing);
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /This connection may: read, write\..*\[insufficient_scope\]$/s);
});

test('a bug inside a tool is reported without its internals', async () => {
  const broken = { api: async () => { throw new TypeError("Cannot read properties of undefined (reading 'token_hash')"); } };
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a);
  try {
    const { body } = await handleMcpMessage({
      jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whoami', arguments: {} },
    }, broken);
    assert.equal(body.result.isError, true);
    assert.doesNotMatch(body.result.content[0].text, /token_hash|undefined/);
    assert.match(body.result.content[0].text, /\[internal_error\]$/);
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1, 'and logged whole, so it can be found');
});

test('a failure outside any tool answers with a reference, never the exception', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...a) => errors.push(a);
  try {
    // A context whose tools list is not a list: handleMcpMessage itself throws.
    const out = await handleMcpRequest(post({
      jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'whoami', arguments: {} },
    }), { tools: { find: () => { throw new Error('relation "api_tokens" does not exist'); } } });
    assert.equal(out.body.error.code, ERR.INTERNAL);
    assert.match(out.body.error.message, /^internal error \(ref [0-9a-f]{8}\)$/);
    assert.doesNotMatch(JSON.stringify(out.body), /api_tokens/);
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
});

// ── the tools 3.0 folded together ────────────────────────────────────────────

const tool = (name) => TOOLS.find((t) => t.name === name);

test('whoami answers with the workspaces too', async () => {
  const api = async (p) => (p === '/me'
    ? { user_id: 'u-1', scopes: ['read'] }
    : { workspaces: [{ id: 'w-1', name: 'Studio' }] });
  assert.deepEqual(await tool('whoami').call({}, { api }),
    { user_id: 'u-1', scopes: ['read'], workspaces: [{ id: 'w-1', name: 'Studio' }] });
});

test('search answers in the shape ChatGPT asks for, boards first, each id one that fetch reads', async () => {
  let seen;
  const api = async (p) => {
    seen = p;
    return {
      query: 'neon',
      boards: { items: [{ id: BOARD_ID, name: 'Neon nights', url: 'https://x/?to=b:1' }], limit: 20, offset: 0, has_more: false },
      cards: {
        items: [
          { board_id: BOARD_ID, card_id: 'c-1', kind: 'image', title: null, excerpt: `A neon sign over a wet street ${'x'.repeat(300)}`, url: 'https://x/?to=c:1' },
          { board_id: BOARD_ID, card_id: 'c-2', kind: 'link', title: null, excerpt: null, url: 'https://x/?to=c:2' },
        ],
        limit: 20,
        offset: 0,
        has_more: true,
      },
    };
  };
  const out = await tool('search').call({ query: 'neon' }, { api });
  assert.equal(seen, '/search?q=neon&limit=20');
  assert.deepEqual(out.results.map((r) => r.id), [`board:${BOARD_ID}`, `card:${BOARD_ID}:c-1`, `card:${BOARD_ID}:c-2`]);
  assert.deepEqual(out.results.map((r) => r.kind), ['board', 'card', 'card']);
  assert.match(out.results[1].title, /^A neon sign over a wet street x+…$/, 'a card with no title is named by its words');
  assert.equal(out.results[1].excerpt.length, 201);
  assert.equal(out.results[2].title, 'Untitled link');
  assert.ok(out.results.every((r) => typeof r.title === 'string' && typeof r.url === 'string'));
  assert.deepEqual([out.query, out.has_more, out.next_offset], ['neon', true, 20]);
  for (const r of out.results) assert.ok(parseFetchId(r.id), `fetch reads ${r.id}`);
});

test('list_boards reads one level, a whole hierarchy, or the deleted boards', async () => {
  const seen = [];
  const api = async (p) => { seen.push(p); return p === '/workspaces' ? { workspaces: [{ id: 'w-1' }] } : { boards: [] }; };
  const run = (a) => tool('list_boards').call(a, { api });
  await run({ parent: 'root' });
  await run({ depth: 3 });
  await run({ depth: 2, parent: BOARD_ID });
  await run({ deleted: true, workspace_id: 'w-2' });
  assert.deepEqual(seen, [
    '/boards?parent=root',
    '/workspaces', '/boards/tree?workspace=w-1&depth=3',
    `/boards/tree?root=${BOARD_ID}&depth=2`,
    '/boards?deleted=1&workspace=w-2',
  ]);
  await assert.rejects(run({ deleted: true, depth: 2 }), /leave out parent, depth, since and cursor/);
  await assert.rejects(run({ depth: 2, limit: 10, workspace_id: 'w-1' }), /leave out since, cursor, limit and offset/);
  await assert.rejects(run({ depth: 2, parent: 'Diner' }), /parent must be a board id/);
});

test('a hierarchy read in one answer stops at its limit and says how to see the rest', async () => {
  const boards = Array.from({ length: TREE_MAX + 5 }, (_, i) => ({ id: `b-${i}`, depth: 1 }));
  const out = await tool('list_boards').call({ depth: 1, workspace_id: 'w-1' },
    { api: async () => ({ boards, count: boards.length }) });
  assert.equal(out.boards.length, TREE_MAX);
  assert.equal(out.count, TREE_MAX + 5);
  assert.equal(out.truncated, true);
  assert.match(out.note, /pass parent to map one branch/);
});

test('read_board answers with the board, its capacity and groups beside the cards', async () => {
  const seen = [];
  const api = async (p) => {
    seen.push(p);
    if (p.startsWith(`/boards/${BOARD_ID}?`)) return { board: { id: BOARD_ID, name: 'Diner' }, capacity: null, url: 'https://x/?to=b:1' };
    return { board_id: BOARD_ID, source: 'live', cards: [{ id: 'c-1', body: 'x'.repeat(600), html: '<p>x</p>' }], groups: [{ id: 'g-1' }], has_more: false };
  };
  const out = await tool('read_board').call({ board_id: BOARD_ID, include: 'props' }, { api });
  assert.deepEqual(seen, [`/boards/${BOARD_ID}?include=props,identifiers`, `/boards/${BOARD_ID}/cards?include=props%2Cgroups`]);
  assert.deepEqual([out.board.name, out.url, out.capacity, out.groups], ['Diner', 'https://x/?to=b:1', null, [{ id: 'g-1' }]]);
  assert.equal(out.cards[0].truncated, true);
  assert.match(out.cards[0].html, /call again with full=true/);
  // The index has no groups, so none are asked of it.
  seen.length = 0;
  await tool('read_board').call({ board_id: BOARD_ID, source: 'index' }, { api });
  assert.equal(seen[1], `/boards/${BOARD_ID}/cards?source=index`);
});

test('read_board with format is the whole board as one document, and takes nothing else', async () => {
  let seen;
  const out = await tool('read_board').call({ board_id: BOARD_ID, format: 'omc' },
    { api: async (p) => { seen = p; return { Asset: [] }; } });
  assert.equal(seen, `/boards/${BOARD_ID}/export?format=omc`);
  assert.deepEqual(out, { Asset: [] });
  await assert.rejects(tool('read_board').call({ board_id: BOARD_ID, format: 'json', limit: 10 }, { api: async () => ({}) }),
    /leave out full, include, source, since, limit, offset and cursor/);
});

test('update_boards moves boards a destination at a time, changes the rest one by one, and says which failed', async () => {
  const P = '11111111-1111-4111-8111-111111111111';
  const B = (n) => `${n}2222222-2222-4222-8222-222222222222`;
  const calls = [];
  const api = async (p, o = {}) => {
    calls.push({ p, method: o.method || 'GET', body: o.body });
    if (p === '/boards/move') {
      return o.body.parent_board_id === P
        ? { skipped: [{ id: B(3), reason: 'cycle' }, { id: B(2), reason: 'same-parent' }] }
        : { skipped: [] };
    }
    if (p === `/boards/${B(4)}`) throw apiErrorFrom(403, { error: 'you cannot rename this board', code: 'forbidden' });
    return { board: { id: p.split('/')[2], name: o.body.name } };
  };
  const out = await tool('update_boards').call({
    boards: [
      { board_id: B(1), name: 'Reel 1' },
      { board_id: B(2), parent_board_id: P, name: 'Reel 2' },
      { board_id: B(3), parent_board_id: P },
      { board_id: B(4), name: 'Reel 4' },
      { board_id: B(5), parent_board_id: null },
    ],
  }, { api });
  assert.deepEqual(out.updated, [
    { id: B(1), name: 'Reel 1' },
    { id: B(2), name: 'Reel 2' },
    { id: B(5), parent_board_id: null },
  ], 'a board already under its parent counts as moved, and is still renamed');
  assert.deepEqual(out.failed, [
    { board_id: B(3), error: 'could not move it: cycle [conflict]' },
    { board_id: B(4), error: 'you cannot rename this board [forbidden]' },
  ]);
  assert.deepEqual(calls.filter((c) => c.p === '/boards/move').map((c) => c.body),
    [{ board_ids: [B(2), B(3)], parent_board_id: P }, { board_ids: [B(5)], parent_board_id: null }]);
  assert.ok(calls.every((c) => c.method !== 'PATCH' || !('parent_board_id' in c.body)), 'a move never goes through PATCH');
});

test('update_boards: one board refused is that refusal, and an entry must change something', async () => {
  const api = async () => { throw apiErrorFrom(403, { error: 'you cannot rename this board', code: 'forbidden' }); };
  const run = (boards) => tool('update_boards').call({ boards }, { api });
  await assert.rejects(run([{ board_id: BOARD_ID, name: 'Diner' }]), (e) => e instanceof ApiError && e.code === 'forbidden');
  await assert.rejects(run([{ board_id: BOARD_ID, name: 'a' }, { board_id: '11111111-1111-4111-8111-111111111111', name: 'b' }]),
    /^Error: none of the 2 boards changed: .*you cannot rename this board \[forbidden\]/);
  await assert.rejects(run([{ board_id: BOARD_ID }]), /say what to change/);
  await assert.rejects(run([{ board_id: BOARD_ID, name: 'a' }, { board_id: BOARD_ID, view: 'list' }]), /listed twice/);
});
