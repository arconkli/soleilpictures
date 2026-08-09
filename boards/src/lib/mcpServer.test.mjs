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
import { TOOLS, HOSTED_TOOLS, PROMPTS, toolManifest } from './mcpTools.js';
import { handleMcpMessage, handleMcpRequest } from './mcpServer.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');

// ── one registry, two copies ─────────────────────────────────────────────────

test('the npm package ships the same registry the Worker serves', () => {
  const source = readFileSync(resolve(REPO, 'boards/src/lib/mcpTools.js'), 'utf8');
  const copy = readFileSync(resolve(REPO, 'mcp/src/tools.js'), 'utf8');
  const stripped = copy.replace(/^\/\/ GENERATED[^\n]*\n\/\/ Regenerate[^\n]*\n\n/, '');
  assert.equal(stripped, source,
    'mcp/src/tools.js is stale — run `npm run sync` in mcp/. '
    + 'A tool present on one transport and missing on the other looks like a client bug.');
});

// ── the shape of a tool ──────────────────────────────────────────────────────

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
  assert.deepEqual(destructive, ['delete_board', 'delete_card', 'delete_cards']);
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
  const reads = ['whoami', 'search', 'read_board', 'list_boards', 'board_tree',
    'get_board', 'view_image', 'list_images', 'export_board', 'resolve_identifier',
    'list_audit', 'get_metadata', 'list_workspaces', 'list_deleted_boards'];
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
const rpc = (method, params, id = 1) => handleMcpMessage({ jsonrpc: '2.0', id, method, params }, ctx);

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

test('notifications get no reply at all', async () => {
  assert.equal(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx), null);
  assert.equal(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/anything' }, ctx), null);
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
  const r = await handleMcpMessage(
    { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'delete_board', arguments: { board_id: 'x' } } },
    failing);
  assert.equal(r.error, undefined);
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /cannot delete/);
});

test('an unknown tool is an RPC error that lists what exists', async () => {
  const r = await rpc('tools/call', { name: 'delete_everything' });
  assert.equal(r.error.code, -32602);
  assert.ok(r.error.data.available.includes('whoami'));
});

test('a local-only tool is not callable over the hosted transport', async () => {
  const r = await rpc('tools/call', { name: 'upload_file', arguments: { path: '/x' } });
  assert.equal(r.error.code, -32602, 'it must not be reachable, not merely fail');
});

test('prompts list and render with their arguments', async () => {
  const list = await rpc('prompts/list');
  assert.equal(list.result.prompts.length, PROMPTS.length);
  const got = await rpc('prompts/get', { name: 'describe_board', arguments: { board_id: 'b-1' } });
  assert.equal(got.result.messages[0].role, 'user');
  assert.match(got.result.messages[0].content.text, /b-1/);
});

test('a prompt missing a required argument says which one', async () => {
  const r = await rpc('prompts/get', { name: 'describe_board', arguments: {} });
  assert.equal(r.error.code, -32602);
  assert.match(r.error.message, /board_id/);
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
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_workspaces' } },
  ]), flaky);
  assert.equal(out.body[0].result.isError, true);
  assert.equal(out.body[1].result.isError, undefined);
});
