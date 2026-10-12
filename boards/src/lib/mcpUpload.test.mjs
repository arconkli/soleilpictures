// upload_file in the stdio package, exercised as a real process against a
// local stand-in for the API and for storage.
//
// The tool exists for files too big to go anywhere else — camera masters,
// ProRes — and it used to readFile() the whole thing first, which Node refuses
// outright above 2 GiB (2026-10-11 audit, API-16). Nothing here leaves the
// machine, and the large file is sparse, so it costs no disk.

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, openSync, ftruncateSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, '../../../mcp/src/index.js');
const TMP = mkdtempSync(join(tmpdir(), 'soleil-mcp-upload-'));
const BOARD = '11111111-1111-4111-8111-111111111111';

let server;
let BASE;
let partSize = 4;
let failParts = false;
let parts = new Map();
let calls = [];

before(async () => {
  server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      calls.push(url.pathname);
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json', etag: '"e"' });
        res.end(body === undefined ? '' : JSON.stringify(body));
      };
      if (url.pathname === '/api/v1/uploads/multipart') {
        const { bytes } = JSON.parse(raw);
        return send(201, { key: 'ws/k.bin', upload_id: 'u1', part_size: partSize, part_count: Math.ceil(bytes / partSize) });
      }
      if (url.pathname === '/api/v1/uploads/multipart/parts') {
        if (failParts) return send(500, { error: 'storage is down', code: 'upstream_error' });
        const { part_numbers: ns } = JSON.parse(raw);
        return send(200, { urls: Object.fromEntries(ns.map((n) => [String(n), `${BASE}/put/${n}`])) });
      }
      if (url.pathname.startsWith('/put/')) {
        parts.set(Number(url.pathname.slice(5)), raw);
        return send(200);
      }
      if (url.pathname === '/api/v1/uploads/multipart/complete') return send(200, { image_key: 'ws/k.bin' });
      if (url.pathname === '/api/v1/uploads/multipart/abort') return send(200, { aborted: true });
      return send(404, { error: 'no' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(TMP, { recursive: true, force: true });
});

function callTool(args) {
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, SOLEIL_API_TOKEN: 'sk_test_upload', SOLEIL_API_BASE: BASE },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const reply = new Promise((res, rej) => {
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); rej(new Error(`no reply. stderr: ${err}`)); }, 20000);
    child.stderr.on('data', (c) => { err += c; });
    child.stdout.on('data', (c) => {
      out += c;
      const nl = out.indexOf('\n');
      if (nl >= 0) { clearTimeout(timer); child.kill(); res(JSON.parse(out.slice(0, nl))); }
    });
  });
  child.stdin.write(`${JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'upload_file', arguments: args },
  })}\n`);
  return reply;
}

test('a file is sent part by part, and the parts reassemble to the file', async () => {
  partSize = 4;
  failParts = false;
  parts = new Map();
  calls = [];
  const path = join(TMP, 'clip.mov');
  const content = Buffer.from('ABCDEFGHIJ');   // 3 parts: 4 + 4 + 2
  writeFileSync(path, content);
  const msg = await callTool({ board_id: BOARD, path });
  assert.notEqual(msg.result?.isError, true, JSON.stringify(msg));
  const joined = Buffer.concat([...parts.keys()].sort((a, b) => a - b).map((n) => parts.get(n)));
  assert.equal(joined.toString(), content.toString());
  assert.ok(calls.includes('/api/v1/uploads/multipart/complete'));
});

test('a file over 2 GiB gets started rather than refused, and a failure aborts the upload', async () => {
  partSize = 8 * 1024 * 1024;
  failParts = true;     // stop before any bytes move: the point is that it got this far
  calls = [];
  const path = join(TMP, 'master.mov');
  const fd = openSync(path, 'w');
  ftruncateSync(fd, 3 * 1024 ** 3);
  closeSync(fd);
  const msg = await callTool({ board_id: BOARD, path });
  assert.equal(msg.result?.isError, true);
  const text = msg.result.content[0].text;
  assert.doesNotMatch(text, /2 GiB|ERR_FS_FILE_TOO_LARGE/);
  assert.match(text, /storage is down/);
  assert.ok(calls.includes('/api/v1/uploads/multipart/abort'), 'an abandoned upload is aborted');
});
