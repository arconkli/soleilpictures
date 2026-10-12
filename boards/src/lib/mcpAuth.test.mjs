// The stdio package's sign-in, over the life of a session.
//
// `npx soleil-clusters-mcp login` stores an OAuth access token that lives an
// hour. The server used to read it once at startup, so every signed-in user
// lost access an hour into a session, and two MCP hosts sharing the sign-in
// raced each other on the single-use refresh token (2026-10-11 audit, API-06).
//
// These tests run against a throwaway config directory and a local HTTP
// server standing in for clusters.soleilpictures.com. Nothing leaves the
// machine.

import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(HERE, '../../../mcp/src/index.js');

const CONFIG = mkdtempSync(join(tmpdir(), 'soleil-mcp-auth-'));
const DIR = join(CONFIG, 'soleil-clusters');
const CREDS = join(DIR, 'credentials.json');
const LOCK = `${CREDS}.lock`;

// auth.js fixes its paths at import, so the environment is set first.
const savedXdg = process.env.XDG_CONFIG_HOME;
const savedToken = process.env.SOLEIL_API_TOKEN;
process.env.XDG_CONFIG_HOME = CONFIG;
delete process.env.SOLEIL_API_TOKEN;
const { tokenSource } = await import('../../../mcp/src/auth.js');

// ── a stand-in for the API ───────────────────────────────────────────────────

let refreshes = 0;
let accepted = new Set();
let server;
let BASE;

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url === '/oauth/token') {
        refreshes++;
        const n = refreshes;
        accepted.add(`at_${n}`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ access_token: `at_${n}`, refresh_token: `rt_${n}`, expires_in: 3600 }));
        return;
      }
      const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (!accepted.has(bearer)) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid token', code: 'invalid_token' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ user: { id: 'u1' }, scopes: ['read'] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BASE = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(CONFIG, { recursive: true, force: true });
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXdg;
  if (savedToken !== undefined) process.env.SOLEIL_API_TOKEN = savedToken;
});

beforeEach(() => {
  refreshes = 0;
  accepted = new Set();
  rmSync(LOCK, { force: true });
});

const store = (access, expiresInMs) => {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(CREDS, JSON.stringify({
    base: BASE, client_id: 'c1', access_token: access, refresh_token: 'rt_0',
    expires_at: new Date(Date.now() + expiresInMs).toISOString(),
  }));
};
const stored = () => JSON.parse(readFileSync(CREDS, 'utf8'));

// ── the token source ─────────────────────────────────────────────────────────

test('a fresh stored token is used as it is', async () => {
  store('at_live', 3600_000);
  assert.equal(await tokenSource(BASE).get(), 'at_live');
  assert.equal(refreshes, 0);
});

test('a token near expiry is refreshed before it is sent, and the refresh is saved', async () => {
  store('at_old', 30_000);
  assert.equal(await tokenSource(BASE).get(), 'at_1');
  assert.equal(stored().access_token, 'at_1');
  assert.equal(stored().refresh_token, 'rt_1');
});

test('the SAME process asks again later and gets a new token, not the startup one', async () => {
  store('at_live', 3600_000);
  const tokens = tokenSource(BASE);
  assert.equal(await tokens.get(), 'at_live');
  store('at_live', 10_000);   // an hour has passed
  assert.equal(await tokens.get(), 'at_1');
});

test('concurrent calls share one refresh', async () => {
  store('at_old', 0);
  const tokens = tokenSource(BASE);
  const got = await Promise.all([tokens.get(), tokens.get(), tokens.get()]);
  assert.deepEqual(got, ['at_1', 'at_1', 'at_1']);
  assert.equal(refreshes, 1);
});

test('after a 401, a token another process rotated in is used without refreshing again', async () => {
  store('at_mine', 3600_000);
  const tokens = tokenSource(BASE);
  store('at_theirs', 3600_000);   // the other host refreshed and saved
  assert.equal(await tokens.rejected('at_mine'), 'at_theirs');
  assert.equal(refreshes, 0);
});

test('after a 401 on the stored token itself, it is refreshed', async () => {
  store('at_revoked_early', 3600_000);
  assert.equal(await tokenSource(BASE).rejected('at_revoked_early'), 'at_1');
  assert.equal(refreshes, 1);
});

test('a refresh waits for another process holding the lock, then uses what it saved', async () => {
  store('at_old', 0);
  writeFileSync(LOCK, '');
  const pending = tokenSource(BASE).get();
  // The other process finishes its refresh and lets go.
  setTimeout(() => {
    store('at_other', 3600_000);
    rmSync(LOCK, { force: true });
  }, 250);
  assert.equal(await pending, 'at_other');
  assert.equal(refreshes, 0, 'a single-use refresh token must not be spent twice');
  assert.equal(existsSync(LOCK), false);
});

test('SOLEIL_API_TOKEN wins and is never refreshed', async () => {
  process.env.SOLEIL_API_TOKEN = 'sk_live_env';
  try {
    const tokens = tokenSource(BASE);
    assert.equal(await tokens.get(), 'sk_live_env');
    assert.equal(await tokens.rejected('sk_live_env'), null);
  } finally {
    delete process.env.SOLEIL_API_TOKEN;
  }
});

// ── the real process ─────────────────────────────────────────────────────────

test('the stdio server recovers from a 401 mid-session instead of failing every call', async () => {
  // Fresh-looking but already dead at the API — what a rotation by another
  // host, or an hour passing, looks like from inside the process.
  store('at_dead', 3600_000);
  const env = { ...process.env, XDG_CONFIG_HOME: CONFIG, SOLEIL_API_BASE: BASE };
  delete env.SOLEIL_API_TOKEN;
  const child = spawn(process.execPath, [ENTRY], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const reply = new Promise((res, rej) => {
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); rej(new Error(`no reply. stderr: ${err}`)); }, 15000);
    child.stderr.on('data', (c) => { err += c; });
    child.stdout.on('data', (c) => {
      out += c;
      const nl = out.indexOf('\n');
      if (nl >= 0) { clearTimeout(timer); child.kill(); res(JSON.parse(out.slice(0, nl))); }
    });
  });
  child.stdin.write(`${JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whoami', arguments: {} },
  })}\n`);
  const msg = await reply;
  assert.notEqual(msg.result?.isError, true, JSON.stringify(msg));
  assert.equal(refreshes, 1);
  assert.equal(stored().access_token, 'at_1');
});
