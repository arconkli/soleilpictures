// apiLog.test.mjs — what a request writes to api_request_log (0858).
//
//   node --test src/lib/apiLog.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { apiLogParams, mcpClientName, mcpOutcome, mcpMethodLogged } from './apiLog.js';
import { handleMcpRequest } from './mcpServer.js';
import { ApiError } from './mcpTools.js';

const auth = { tokenId: 't1', userId: 'u1' };
const req = (headers = {}) => new Request('https://x.test/api/v1/mcp', { method: 'POST', headers });
const params = (trace, status = 200) => apiLogParams({ auth, request: req({ 'user-agent': 'UA' }), trace, status, ms: 7 });

test('a plain success writes the old fields and is_error false', () => {
  const p = params({ route: '/boards', target: 'b1', tool: null });
  assert.deepEqual(p, {
    p_token_id: 't1', p_user_id: 'u1', p_method: 'POST', p_route: '/boards', p_status: 200, p_ms: 7,
    p_target: 'b1', p_tool: null, p_ip: null, p_ua: 'UA',
    p_is_error: false, p_error_code: null, p_client: null,
  });
});

test('an HTTP status of 400 or more is an error, with the API code behind it', () => {
  const p = params({ route: '/boards/x', target: null, errorCode: 'not_found' }, 404);
  assert.equal(p.p_is_error, true);
  assert.equal(p.p_error_code, 'not_found');
  assert.equal(params({ route: '/x', target: null }, 500).p_error_code, null);
});

test('a tool result with isError is an error even at HTTP 200; the code is cut to 64 characters', () => {
  const p = params({ route: '/mcp', target: null, tool: 'add_cards', mcpMethod: 'tools/call', isError: true, errorCode: 'limit_reached' });
  assert.equal(p.p_is_error, true);
  assert.equal(p.p_error_code, 'limit_reached');
  assert.equal(params({ route: '/mcp', target: null, isError: true, errorCode: 'x'.repeat(100) }).p_error_code.length, 64);
  assert.equal(params({ route: '/mcp', target: null, isError: false }).p_error_code, null);
});

test('ping and notifications are not logged; everything else on /mcp is', () => {
  for (const m of ['ping', 'notifications/initialized', 'notifications/cancelled']) {
    assert.equal(params({ route: '/mcp', target: null, mcpMethod: m }), null, m);
    assert.equal(mcpMethodLogged(m), false);
  }
  for (const m of ['initialize', 'tools/list', 'tools/call', 'prompts/get', null]) {
    assert.notEqual(params({ route: '/mcp', target: null, mcpMethod: m }), null, String(m));
  }
});

test('the client is name/version from initialize, trimmed to 120 characters, and only there', () => {
  const init = (clientInfo) => ({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo } });
  assert.equal(mcpClientName(init({ name: ' claude-ai ', version: '0.1.0 ' })), 'claude-ai/0.1.0');
  assert.equal(mcpClientName(init({ name: 'cursor' })), 'cursor');
  assert.equal(mcpClientName(init({ name: 'n'.repeat(200), version: '1' })).length, 120);
  assert.equal(mcpClientName(init({})), null);
  assert.equal(mcpClientName({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), null);
  assert.equal(params({ route: '/mcp', target: null, client: 'claude-ai/0.1.0' }).p_client, 'claude-ai/0.1.0');
});

test('mcpOutcome reads a protocol error, a failed tool, and a batch', () => {
  assert.deepEqual(mcpOutcome({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'x' } }), { isError: true, code: '-32602' });
  assert.deepEqual(mcpOutcome({ jsonrpc: '2.0', id: 1, result: { isError: true, content: [] } }), { isError: true, code: null });
  assert.deepEqual(mcpOutcome({ jsonrpc: '2.0', id: 1, result: { content: [] } }), { isError: false, code: null });
  assert.deepEqual(mcpOutcome([{ result: {} }, { error: { code: -32601 } }]), { isError: true, code: '-32601' });
  assert.deepEqual(mcpOutcome(null), { isError: false, code: null });
});

test('a tool that fails reports its API code through onToolError and the answer is unchanged', async () => {
  const seen = [];
  const call = (name, args, api) => handleMcpRequest(
    new Request('https://x.test/api/v1/mcp', { method: 'POST' }),
    { api, onToolError: (c) => seen.push(c) },
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
  );
  const out = await call('read_board', { board_id: '3f2a6c1e-8b4d-4e7a-9c1f-2d5e8a7b6c4d' },
    async () => { throw new ApiError('no such board', { status: 404, code: 'not_found' }); });
  assert.equal(out.body.result.isError, true);
  assert.deepEqual(Object.keys(out.body.result).sort(), ['content', 'isError']);
  assert.deepEqual(seen, ['not_found']);
  await call('read_board', { board_id: 'nope', bogus: 1 }, async () => ({}));
  assert.equal(seen[1], 'invalid_arguments');
});
