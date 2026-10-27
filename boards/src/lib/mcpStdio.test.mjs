// The stdio transport, exercised as a real process.
//
// WHY THIS EXISTS. mcp/src/index.js is the published npm package, and it just
// stopped using the official SDK — the SDK's newest protocol version is
// 2025-11-25, so it cannot express the 2026-07-28 revision at all. The
// transport is now forty lines of newline-delimited JSON in this repo.
//
// Forty lines nobody runs is forty lines that are broken. Every other test in
// this directory imports a function; this one spawns the binary a user's
// `npx soleil-clusters-mcp` would run and talks to it over a pipe, which is the
// only way to catch a bad import specifier, a crash at startup, or a response
// written to the wrong stream.
//
// Nothing here touches the network: discover, initialize and tools/list are all
// answered from the registry.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from './mcpTools.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, '../../../mcp/src/index.js');

/**
 * Start the server, write every message, and collect the replies.
 * Resolves once `expected` responses have arrived, or the process dies.
 */
function converse(messages, expected, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [ENTRY], {
      env: {
        ...process.env,
        // Enough to get past the startup check. No request below reaches it,
        // unless a test points the base at a server of its own.
        SOLEIL_API_TOKEN: 'sk_test_stdio',
        SOLEIL_API_BASE: 'http://127.0.0.1:1',
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const out = [];
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timed out with ${out.length}/${expected} replies. stderr: ${stderr}`));
    }, 15000);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      for (let nl = stdout.indexOf('\n'); nl >= 0; nl = stdout.indexOf('\n')) {
        const line = stdout.slice(0, nl).trim();
        stdout = stdout.slice(nl + 1);
        if (!line) continue;
        try {
          out.push(JSON.parse(line));
        } catch (e) {
          clearTimeout(timer);
          child.kill();
          reject(new Error(`stdout is not JSON-RPC — something else was written to it: ${line}`));
          return;
        }
        if (out.length >= expected) {
          clearTimeout(timer);
          child.kill();
          resolvePromise({ out, stderr });
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => {
      if (out.length < expected) {
        clearTimeout(timer);
        reject(new Error(`exited ${code} after ${out.length}/${expected} replies. stderr: ${stderr}`));
      }
    });

    // A string is written verbatim, so a test can send something that is not
    // JSON at all.
    for (const m of messages) {
      child.stdin.write(typeof m === 'string' ? `${m}\n` : `${JSON.stringify(m)}\n`);
    }
  });
}

const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CAPS = 'io.modelcontextprotocol/clientCapabilities';

test('the published server starts and answers the modern discovery probe', async () => {
  // This is exactly what a dual-era client sends first on stdio: there is no
  // HTTP status here to drive a fallback, so `server/discover` IS the probe.
  const { out, stderr } = await converse([{
    jsonrpc: '2.0', id: 'probe', method: 'server/discover',
    params: { _meta: { [META_VERSION]: '2026-07-28', [META_CAPS]: {} } },
  }], 1);

  assert.equal(out[0].id, 'probe');
  assert.ok(out[0].result.supportedVersions.includes('2026-07-28'));
  assert.equal(out[0].result.resultType, 'complete');
  // The banner must go to stderr. On stdout it would be a parse error at the
  // other end, before the client ever sends a request.
  assert.match(stderr, /soleil-clusters MCP ready/);
});

test('a legacy client still gets its handshake', async () => {
  // Every client shipping today opens this way, including Claude Desktop.
  const { out } = await converse([{
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } },
  }], 1);
  assert.equal(out[0].result.protocolVersion, '2025-06-18');
  assert.equal(out[0].result.serverInfo.name, 'soleil-clusters');
  assert.equal('resultType' in out[0].result, false, 'a legacy result carries no modern fields');
});

test('stdio serves the local-filesystem tool the hosted server cannot', async () => {
  // The whole reason this package still exists: upload_file needs a disk.
  const { out } = await converse([{ jsonrpc: '2.0', id: 2, method: 'tools/list' }], 1);
  const names = out[0].result.tools.map((t) => t.name);
  assert.equal(names.length, TOOLS.length);
  assert.ok(names.includes('upload_file'));
});

test('a notification gets no reply, and does not stall the next request', async () => {
  // A reply to a notification is a protocol violation; a client that then
  // matches it against the following request's id gets nonsense.
  const { out } = await converse([
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 7, method: 'tools/list' },
  ], 1);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 7);
});

test('a garbage line is a parse error, and the server keeps serving', async () => {
  // A malformed line must not kill the process: the client would see the pipe
  // close and have no idea which of its in-flight calls was at fault.
  const { out } = await converse([
    'not json at all',
    { jsonrpc: '2.0', id: 3, method: 'tools/list' },
  ], 2);
  assert.equal(out[0].error.code, -32700);
  assert.equal(out[0].id, null);
  assert.equal(out[1].id, 3);
  assert.ok(out[1].result.tools.length > 0);
});

test('each POST in one tool call has its own idempotency key, and a retry repeats them', async () => {
  // The API holds a key per token, not per route. update_boards posts one move
  // per destination, so a key shared by the whole call would answer the second
  // move with the first one's replay, and that board would never move.
  const posts = [];
  const api = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.method === 'POST') posts.push({ path: req.url, key: req.headers['idempotency-key'], body: JSON.parse(body || 'null') });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ skipped: [] }));
    });
  });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  try {
    const A = '11111111-1111-4111-8111-111111111111';
    const B = '22222222-2222-4222-8222-222222222222';
    const P = '33333333-3333-4333-8333-333333333333';
    const call = (id) => ({
      jsonrpc: '2.0', id, method: 'tools/call',
      params: { name: 'update_boards', arguments: { boards: [{ board_id: A, parent_board_id: P }, { board_id: B, parent_board_id: null }] } },
    });
    const { out } = await converse([call(1), call(2)], 2, { SOLEIL_API_BASE: `http://127.0.0.1:${api.address().port}` });
    assert.ok(out.every((m) => m.result && !m.result.isError), JSON.stringify(out));
    assert.deepEqual(posts.map((p) => p.path), Array(4).fill('/api/v1/boards/move'));
    const keyFor = (to) => new Set(posts.filter((p) => p.body.parent_board_id === to).map((p) => p.key));
    assert.equal(keyFor(P).size, 1, 'the same move in a retried call carries the same key');
    assert.equal(keyFor(null).size, 1);
    assert.notEqual([...keyFor(P)][0], [...keyFor(null)][0], 'two moves in one call carry two keys');
  } finally {
    api.close();
  }
});
