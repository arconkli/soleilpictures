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
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from './mcpTools.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, '../../../mcp/src/index.js');

/**
 * Start the server, write every message, and collect the replies.
 * Resolves once `expected` responses have arrived, or the process dies.
 */
function converse(messages, expected) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [ENTRY], {
      env: {
        ...process.env,
        // Enough to get past the startup check. No request below reaches it.
        SOLEIL_API_TOKEN: 'sk_test_stdio',
        SOLEIL_API_BASE: 'http://127.0.0.1:1',
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
