// Clients named by a metadata document, loopback redirects on any port, and
// the OAuth routes that read them.
//
//   node --test src/lib/oauthClients.test.mjs
//
// The documents below are the real ones, fetched 2026-10-24 from the URLs they
// name: if one of these four stops being accepted, Claude, Claude Code, ChatGPT
// or VS Code stops being able to connect. The redirect pairs are read out of
// migration 0701, whose own proof block runs them through the SQL twin of
// redirectUriMatches, so the Worker's answer and the database's cannot drift.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MAX_REDIRECT_URIS, METADATA_MAX_BYTES,
  METADATA_CACHE_MIN_SECONDS, METADATA_CACHE_MAX_SECONDS, METADATA_CACHE_DEFAULT_SECONDS,
  isMetadataClientId, clientKind, clientHost, clientMetadataFromDocument,
  metadataCacheSeconds, redirectUriMatches, anyRedirectMatches,
} from './oauthClients.js';
import { handleOAuthRoute, authorizationServerMetadata } from '../worker-oauth.js';

const MIGRATION = readFileSync(
  new URL('../../../supabase/migrations/0701_oauth_metadata_clients_refresh_reuse.sql', import.meta.url), 'utf8');

const CLAUDE = {
  client_id: 'https://claude.ai/oauth/mcp-oauth-client-metadata', client_name: 'Claude', client_uri: 'https://claude.ai',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:jwt-bearer'],
  response_types: ['code'], token_endpoint_auth_method: 'none',
};
const CLAUDE_CODE = {
  client_id: 'https://claude.ai/oauth/claude-code-client-metadata', client_name: 'Claude Code', client_uri: 'https://claude.ai',
  redirect_uris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
  grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
};
const CHATGPT = {
  client_id: 'https://chatgpt.com/oauth/client.json', client_uri: 'https://chatgpt.com/',
  redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
  token_endpoint_auth_method: 'private_key_jwt', token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
  grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_name: 'ChatGPT',
  logo_uri: 'https://persistent.oaistatic.com/sonic/misc/openai-logo.png', token_endpoint_auth_signing_alg: 'RS256',
  jwks_uri: 'https://chatgpt.com/oauth/jwks.json',
};
const VSCODE = {
  client_name: 'Visual Studio Code', logo_uri: 'https://code.visualstudio.com/assets/branding/code-stable.png',
  grant_types: ['authorization_code', 'refresh_token', 'urn:ietf:params:oauth:grant-type:device_code'],
  response_types: ['code'], token_endpoint_auth_method: 'none', application_type: 'native',
  client_id: 'https://vscode.dev/oauth/client-metadata.json', client_uri: 'https://vscode.dev/product',
  redirect_uris: ['http://127.0.0.1:33418/', 'https://vscode.dev/redirect'],
};

// ── The client_id URL ────────────────────────────────────────────────────────

test('a metadata client id is an https URL with a path, spelled canonically', () => {
  for (const id of [CLAUDE.client_id, CHATGPT.client_id, VSCODE.client_id, 'https://example.com/c?v=2']) {
    assert.equal(isMetadataClientId(id), true, id);
  }
  for (const id of [
    'soleil_0123456789abcdef', 'http://example.com/c', 'https://example.com', 'https://example.com/',
    'https://example.com/c#frag', 'https://example.com/c#', 'https://user:pw@example.com/c',
    'https://EXAMPLE.com/c', 'https://example.com:443/c', 'https://example.com/a/../c', '', null,
    `https://example.com/${'x'.repeat(600)}`,
  ]) {
    assert.equal(isMetadataClientId(id), false, String(id));
  }
  assert.equal(clientKind(CLAUDE.client_id), 'metadata');
  assert.equal(clientKind('soleil_ab12'), 'registered');
  assert.equal(clientHost(CHATGPT.client_id), 'chatgpt.com');
  assert.equal(clientHost('soleil_ab12'), null);
});

// ── The document ─────────────────────────────────────────────────────────────

test('the four documents the big hosts publish are all accepted', () => {
  for (const doc of [CLAUDE, CLAUDE_CODE, CHATGPT, VSCODE]) {
    const { meta, problem } = clientMetadataFromDocument(doc, doc.client_id);
    assert.equal(problem, undefined, `${doc.client_id}: ${problem}`);
    assert.deepEqual(meta.redirect_uris, doc.redirect_uris);
    // Grants this server lacks (jwt-bearer, device_code) are dropped, not refused.
    assert.deepEqual(meta.grant_types, ['authorization_code', 'refresh_token']);
  }
  assert.equal(clientMetadataFromDocument(CHATGPT, CHATGPT.client_id).meta.client_name, 'ChatGPT');
  assert.equal(clientMetadataFromDocument(VSCODE, VSCODE.client_id).meta.logo_uri, VSCODE.logo_uri);
});

test('a document must be the one its URL names', () => {
  const { problem } = clientMetadataFromDocument(CLAUDE, 'https://evil.example/claude.json');
  assert.match(problem, /different client_id/);
});

test('a published document can never hold a shared secret', () => {
  for (const method of ['client_secret_post', 'client_secret_basic', 'client_secret_jwt']) {
    const { problem } = clientMetadataFromDocument({ ...CLAUDE, token_endpoint_auth_method: method }, CLAUDE.client_id);
    assert.match(problem, /shared secret/, method);
  }
  assert.match(clientMetadataFromDocument({ ...CLAUDE, client_secret: 'x' }, CLAUDE.client_id).problem, /client_secret/);
  assert.match(clientMetadataFromDocument({ ...CLAUDE, token_endpoint_auth_method: 'tls_client_auth' }, CLAUDE.client_id).problem,
    /accepts none/);
});

test('redirect URIs in a document are held to the registration rules', () => {
  const id = CLAUDE.client_id;
  assert.match(clientMetadataFromDocument({ ...CLAUDE, redirect_uris: [] }, id).problem, /must list redirect_uris/);
  assert.match(clientMetadataFromDocument({ ...CLAUDE, redirect_uris: ['http://evil.example/cb'] }, id).problem, /loopback/);
  assert.match(clientMetadataFromDocument({ ...CLAUDE, redirect_uris: ['javascript:alert(1)'] }, id).problem, /not allowed/);
  assert.match(clientMetadataFromDocument({ ...CLAUDE, redirect_uris: [42] }, id).problem, /not a string/);
  const many = Array.from({ length: MAX_REDIRECT_URIS + 1 }, (_, i) => `https://e.example/${i}`);
  assert.match(clientMetadataFromDocument({ ...CLAUDE, redirect_uris: many }, id).problem, /more than/);
});

test('a document must allow the code flow; omitted fields take the RFC 7591 defaults', () => {
  const id = CLAUDE.client_id;
  assert.match(clientMetadataFromDocument({ ...CLAUDE, grant_types: ['refresh_token'] }, id).problem, /authorization_code/);
  assert.match(clientMetadataFromDocument({ ...CLAUDE, response_types: ['token'] }, id).problem, /code response/);
  const bare = clientMetadataFromDocument({ client_id: id, redirect_uris: CLAUDE.redirect_uris }, id);
  assert.equal(bare.problem, undefined);
  assert.deepEqual(bare.meta.grant_types, ['authorization_code']);
  // No name: the host that serves the document, which is at least true.
  assert.equal(bare.meta.client_name, 'claude.ai');
  // Only https links survive onto the consent page.
  const odd = clientMetadataFromDocument({ ...CLAUDE, logo_uri: 'javascript:x', client_uri: 'http://x.example' }, id).meta;
  assert.equal(odd.logo_uri, null);
  assert.equal(odd.client_uri, null);
  assert.match(clientMetadataFromDocument([], id).problem, /JSON object/);
});

test('a document is trusted for its max-age, within bounds', () => {
  assert.equal(metadataCacheSeconds(null), METADATA_CACHE_DEFAULT_SECONDS);
  assert.equal(metadataCacheSeconds('public, max-age=600'), 600);
  assert.equal(metadataCacheSeconds('max-age=5'), METADATA_CACHE_MIN_SECONDS);
  assert.equal(metadataCacheSeconds('max-age=31536000, immutable'), METADATA_CACHE_MAX_SECONDS);
  assert.equal(metadataCacheSeconds('no-store'), METADATA_CACHE_MIN_SECONDS);
  assert.equal(metadataCacheSeconds('private, no-cache'), METADATA_CACHE_MIN_SECONDS);
  assert.equal(metadataCacheSeconds('s-maxage=60'), METADATA_CACHE_DEFAULT_SECONDS);
});

// ── Redirect matching, against the SQL twin ──────────────────────────────────

function proofPairs() {
  const block = MIGRATION.slice(MIGRATION.indexOf('-- proof pairs'), MIGRATION.indexOf(') as t(registered, presented, expected)'));
  const pairs = [];
  for (const m of block.matchAll(/\(array\[([^\]]*)\](?:::text\[\])?,\s*'([^']*)',\s*(true|false)\)/g)) {
    const registered = m[1].trim() ? [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]) : [];
    pairs.push({ registered, presented: m[2], expected: m[3] === 'true' });
  }
  return pairs;
}

test('redirect matching agrees with _oauth_redirect_matches on every pair the migration proves', () => {
  const pairs = proofPairs();
  assert.ok(pairs.length >= 20, `found only ${pairs.length} proof pairs in 0701`);
  for (const { registered, presented, expected } of pairs) {
    assert.equal(anyRedirectMatches(registered, presented), expected,
      `${JSON.stringify(registered)} vs ${presented}`);
  }
});

test('loopback matches on any port; nothing else does', () => {
  assert.equal(redirectUriMatches('http://localhost/callback', 'http://localhost:61234/callback'), true);
  assert.equal(redirectUriMatches('https://claude.ai/api/mcp/auth_callback', 'https://claude.ai:444/api/mcp/auth_callback'), false);
  assert.equal(redirectUriMatches(null, 'http://localhost/cb'), false);
  assert.equal(anyRedirectMatches(undefined, 'http://localhost/cb'), false);
});

test('the database backstops hold the same numbers as this file', () => {
  assert.match(MIGRATION, new RegExp(`not between 1 and ${MAX_REDIRECT_URIS}\\b`));
  assert.match(MIGRATION, new RegExp(
    `greatest\\(${METADATA_CACHE_MIN_SECONDS}, least\\(coalesce\\(p_ttl_seconds, ${METADATA_CACHE_DEFAULT_SECONDS}\\), ${METADATA_CACHE_MAX_SECONDS}\\)\\)`));
});

// ── The routes ───────────────────────────────────────────────────────────────

const DB = 'https://db.test';
const ENV = { SUPABASE_URL: DB, SUPABASE_SERVICE_ROLE_KEY: 'svc', SUPABASE_ANON_KEY: 'anon' };
const ORIGIN = 'https://clusters.soleilpictures.com';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

let ipSeq = 0;
const nextIp = () => `198.51.100.${++ipSeq}`;

// Routes every fetch the handler makes: the database's RPCs by name, anything
// else by URL. Unrouted fetches fail the test, which is how "never fetched" is
// asserted.
function stub({ rpc = {}, web = {} } = {}) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(typeof input === 'string' ? input : input.url);
    if (url.startsWith(`${DB}/rest/v1/rpc/`)) {
      const fn = url.slice(`${DB}/rest/v1/rpc/`.length);
      const body = JSON.parse(init.body || '{}');
      calls.push({ fn, body });
      const handler = rpc[fn];
      if (!handler) throw new Error(`unexpected rpc ${fn}`);
      const out = await handler(body);
      return out instanceof Response ? out : new Response(JSON.stringify(out), { status: 200 });
    }
    calls.push({ url, init });
    const handler = web[url];
    if (!handler) throw new Error(`unexpected fetch ${url}`);
    return handler(init);
  };
  return calls;
}

const savedRow = ({ p_client_id, p_meta, p_ttl_seconds }) => ({
  client_id: p_client_id, client_name: p_meta.client_name, client_uri: p_meta.client_uri, logo_uri: p_meta.logo_uri,
  redirect_uris: p_meta.redirect_uris, client_secret_hash: null,
  metadata_expires_at: new Date(Date.now() + p_ttl_seconds * 1000).toISOString(),
});
const jsonDoc = (doc, headers = {}) => () => new Response(JSON.stringify(doc), { status: 200, headers });

async function call(path, { method = 'GET', ip = nextIp(), body, form, headers = {} } = {}) {
  const url = new URL(path, ORIGIN);
  const init = { method, headers: { 'cf-connecting-ip': ip, ...headers } };
  if (body) { init.body = JSON.stringify(body); init.headers['content-type'] = 'application/json'; }
  if (form) { init.body = new URLSearchParams(form).toString(); init.headers['content-type'] = 'application/x-www-form-urlencoded'; }
  const res = await handleOAuthRoute(url, new Request(url, init), ENV);
  return { status: res.status, body: await res.json() };
}

const clientPath = (id, redirect) =>
  `/oauth/client?client_id=${encodeURIComponent(id)}&redirect_uri=${encodeURIComponent(redirect)}`;

test('the metadata advertises documents, beside the `none` method Claude also requires', () => {
  const m = authorizationServerMetadata(ORIGIN);
  assert.equal(m.client_id_metadata_document_supported, true);
  assert.ok(m.token_endpoint_auth_methods_supported.includes('none'));
});

test('Claude connects with nothing registered: the document is read, checked and stored', async () => {
  const calls = stub({
    rpc: { oauth_client_get: () => null, oauth_client_upsert_cimd: savedRow },
    web: { [CLAUDE.client_id]: jsonDoc(CLAUDE, { 'cache-control': 'public, max-age=600' }) },
  });
  const ip = nextIp();
  const { status, body } = await call(clientPath(CLAUDE.client_id, CLAUDE.redirect_uris[0]), { ip });
  assert.equal(status, 200);
  assert.equal(body.redirect_uri_registered, true);
  assert.equal(body.client_name, 'Claude');
  assert.equal(body.client_kind, 'metadata');
  assert.equal(body.client_host, 'claude.ai');
  const upsert = calls.find((c) => c.fn === 'oauth_client_upsert_cimd');
  assert.equal(upsert.body.p_ttl_seconds, 600);
  assert.equal(upsert.body.p_ip, ip);
  assert.equal(upsert.body.p_meta.scope, 'read write');
  // The document fetch was made without following anything.
  assert.equal(calls.find((c) => c.url === CLAUDE.client_id).init.redirect, 'manual');
});

test('Claude Code comes back on whatever port its OS gave it', async () => {
  stub({
    rpc: { oauth_client_get: () => null, oauth_client_upsert_cimd: savedRow },
    web: { [CLAUDE_CODE.client_id]: jsonDoc(CLAUDE_CODE) },
  });
  const ok = await call(clientPath(CLAUDE_CODE.client_id, 'http://localhost:53682/callback'));
  assert.equal(ok.body.redirect_uri_registered, true);
});

test('a document read recently is not fetched again', async () => {
  const row = { ...savedRow({ p_client_id: CHATGPT.client_id, p_meta: { client_name: 'ChatGPT', redirect_uris: CHATGPT.redirect_uris }, p_ttl_seconds: 600 }) };
  const calls = stub({ rpc: { oauth_client_get: () => row } });
  const { status, body } = await call(clientPath(CHATGPT.client_id, CHATGPT.redirect_uris[0]));
  assert.equal(status, 200);
  assert.equal(body.redirect_uri_registered, true);
  assert.equal(calls.length, 1);
});

test('a stale copy carries a sign-in through a network blip, for a day and no longer', async () => {
  const stale = (agoMs) => ({
    client_id: VSCODE.client_id, client_name: 'Visual Studio Code', redirect_uris: VSCODE.redirect_uris,
    metadata_expires_at: new Date(Date.now() - agoMs).toISOString(),
  });
  const down = () => { throw new TypeError('fetch failed'); };
  stub({ rpc: { oauth_client_get: () => stale(60_000) }, web: { [VSCODE.client_id]: down } });
  const recent = await call(clientPath(VSCODE.client_id, 'http://127.0.0.1:40111/'));
  assert.equal(recent.status, 200);
  assert.equal(recent.body.redirect_uri_registered, true);

  stub({ rpc: { oauth_client_get: () => stale(2 * 86400_000) }, web: { [VSCODE.client_id]: down } });
  const old = await call(clientPath(VSCODE.client_id, 'http://127.0.0.1:40111/'));
  assert.equal(old.status, 503);
  assert.equal(old.body.error, 'temporarily_unavailable');
});

test('a document that answers wrongly is refused, and nothing is stored', async () => {
  const id = 'https://app.example/oauth/client.json';
  const cases = [
    [jsonDoc({ ...CLAUDE, client_id: 'https://other.example/c.json' }), /different client_id/],
    [() => new Response('<html>hi</html>', { status: 200 }), /not JSON/],
    [() => new Response('{}', { status: 404 }), /answered 404/],
    [() => new Response(JSON.stringify({ client_id: id, redirect_uris: ['https://app.example/cb'], pad: 'x'.repeat(METADATA_MAX_BYTES) })),
      /larger than 5 KB/],
    [() => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/doc' } }), /redirected/],
  ];
  for (const [answer, why] of cases) {
    const calls = stub({ rpc: { oauth_client_get: () => null }, web: { [id]: answer } });
    const { status, body } = await call(clientPath(id, 'https://app.example/cb'));
    assert.equal(status, 400, String(why));
    assert.equal(body.error, 'invalid_client');
    assert.match(body.error_description, why);
    assert.ok(!calls.some((c) => c.fn === 'oauth_client_upsert_cimd'), 'nothing stored');
    assert.ok(!calls.some((c) => c.url === 'https://elsewhere.example/doc'), 'a redirect is never followed');
  }
});

test('a client id pointing inside a network is never fetched', async () => {
  for (const id of ['https://localhost/c.json', 'https://10.0.0.7/c.json', 'https://169.254.169.254/latest']) {
    stub({ rpc: { oauth_client_get: () => null } });
    const { status, body } = await call(clientPath(id, 'https://e.example/cb'));
    assert.equal(status, 400, id);
    assert.match(body.error_description, /public host/);
  }
});

test('an address gets a handful of document lookups a minute', async () => {
  const ip = nextIp();
  stub({ rpc: { oauth_client_get: () => null }, web: new Proxy({}, { get: () => () => new Response('', { status: 404 }) }) });
  const statuses = [];
  for (let i = 0; i < 11; i++) {
    statuses.push((await call(clientPath(`https://many.example/c/${i}`, 'https://many.example/cb'), { ip })).status);
  }
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400));
  assert.equal(statuses[10], 429);
});

test('our own outage is a 503, never "unknown client"', async () => {
  const down = () => new Response('{"message":"upstream"}', { status: 500 });
  stub({ rpc: { oauth_client_get: down } });
  const lookup = await call(clientPath('soleil_abc', 'https://e.example/cb'));
  assert.equal(lookup.status, 503);
  assert.equal(lookup.body.error, 'temporarily_unavailable');

  stub({ rpc: { oauth_client_get: down } });
  const token = await call('/oauth/token', {
    method: 'POST', form: { grant_type: 'refresh_token', refresh_token: 'rt_x', client_id: 'soleil_abc' },
  });
  assert.equal(token.status, 503);
  assert.equal(token.body.error, 'temporarily_unavailable');
});

test('a token for somebody else\'s resource is refused before anything is spent', async () => {
  const calls = stub();
  const { status, body } = await call('/oauth/token', {
    method: 'POST',
    form: { grant_type: 'authorization_code', code: 'ac_x', redirect_uri: 'https://e.example/cb', client_id: 'soleil_abc',
      code_verifier: 'v'.repeat(43), resource: 'https://evil.example/mcp' },
  });
  assert.equal(status, 400);
  assert.equal(body.error, 'invalid_target');
  assert.equal(calls.length, 0);
});

test('our own resource, however it is spelled, is accepted at the token endpoint', async () => {
  for (const resource of [`${ORIGIN}/api/v1/mcp`, `${ORIGIN}/api/v1/mcp/`, `${ORIGIN}/api/v1`, ORIGIN, `${ORIGIN}/mcp`, `${ORIGIN}/mcp/`]) {
    stub({ rpc: { oauth_client_get: () => null } });
    const { body } = await call('/oauth/token', {
      method: 'POST', form: { grant_type: 'refresh_token', refresh_token: 'rt_x', client_id: 'soleil_abc', resource },
    });
    assert.equal(body.error, 'invalid_client', resource);   // got as far as the client lookup
  }
});

test('approving a metadata client checks its document, then records the consent', async () => {
  const row = savedRow({ p_client_id: CLAUDE_CODE.client_id, p_meta: { client_name: 'Claude Code', redirect_uris: CLAUDE_CODE.redirect_uris }, p_ttl_seconds: 600 });
  const calls = stub({
    rpc: { oauth_client_get: () => row, oauth_authorize_consent: () => new Date(Date.now() + 120_000).toISOString() },
  });
  const { status, body } = await call('/oauth/authorize', {
    method: 'POST', headers: { authorization: 'Bearer user-jwt' },
    body: { client_id: CLAUDE_CODE.client_id, redirect_uri: 'http://localhost:53682/callback', state: 's1',
      code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', resource: `${ORIGIN}/api/v1/mcp` },
  });
  assert.equal(status, 200);
  const back = new URL(body.redirect_to);
  assert.equal(back.origin + back.pathname, 'http://localhost:53682/callback');
  assert.equal(back.searchParams.get('state'), 's1');
  assert.equal(back.searchParams.get('iss'), ORIGIN);
  assert.match(back.searchParams.get('code'), /^ac_[0-9a-f]{64}$/);
  assert.deepEqual(calls.map((c) => c.fn), ['oauth_client_get', 'oauth_authorize_consent']);
});

test('a new account approving an app that must wait is told so, by name', async () => {
  // _refuse_if_new's refusal as PostgREST sends it (0375): the hint is the key.
  stub({
    rpc: {
      oauth_authorize_consent: () => new Response(JSON.stringify({
        code: '42501', message: 'Connecting an app opens up once an account is three days old',
        hint: 'new_account', details: null,
      }), { status: 403 }),
    },
  });
  const { status, body } = await call('/oauth/authorize', {
    method: 'POST', headers: { authorization: 'Bearer user-jwt' },
    body: { client_id: 'soleil_abc', redirect_uri: 'https://e.example/cb', code_challenge: 'c'.repeat(43) },
  });
  assert.equal(status, 403);
  assert.equal(body.error, 'new_account');
  assert.equal(body.error_description, 'Connecting an app opens up once an account is three days old');
});

// 0704: ChatGPT and Claude connect on an account's first day, by their own
// callbacks: exactly the web callbacks these real documents list. Never a
// loopback or an app's scheme, which is what the wait is for.
test('0704 lets exactly the Claude and ChatGPT web callbacks connect on day one', () => {
  const sql = readFileSync(
    new URL('../../../supabase/migrations/0704_ai_chats_connect_on_day_one.sql', import.meta.url), 'utf8');
  const list = sql.match(/function public\._oauth_ai_chat_callback[\s\S]*?array\[([\s\S]*?)\]/);
  assert.ok(list, '_oauth_ai_chat_callback not found');
  const listed = [...list[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  for (const uri of [...CLAUDE.redirect_uris, ...CHATGPT.redirect_uris]) assert.ok(listed.includes(uri), uri);
  for (const uri of listed) assert.match(uri, /^https:\/\/(claude\.ai|claude\.com|chatgpt\.com)\/[^?#]+$/);
  for (const uri of [...CLAUDE_CODE.redirect_uris, ...VSCODE.redirect_uris]) assert.ok(!listed.includes(uri), uri);
});

test('a consent the database could not record is a 503, not a refusal', async () => {
  stub({ rpc: { oauth_authorize_consent: () => new Response('{"message":"boom"}', { status: 503 }) } });
  const { status, body } = await call('/oauth/authorize', {
    method: 'POST', headers: { authorization: 'Bearer user-jwt' },
    body: { client_id: 'soleil_abc', redirect_uri: 'https://e.example/cb', code_challenge: 'c'.repeat(43) },
  });
  assert.equal(status, 503);
  assert.equal(body.error, 'temporarily_unavailable');
});

test('declining sends a loopback client back on its own port', async () => {
  const row = { client_id: CLAUDE_CODE.client_id, client_name: 'Claude Code', redirect_uris: CLAUDE_CODE.redirect_uris };
  stub({ rpc: { oauth_client_get: () => row } });
  const { status, body } = await call('/oauth/deny', {
    method: 'POST', body: { client_id: CLAUDE_CODE.client_id, redirect_uri: 'http://127.0.0.1:61000/callback', state: 'z' },
  });
  assert.equal(status, 200);
  const back = new URL(body.redirect_to);
  assert.equal(back.host, '127.0.0.1:61000');
  assert.equal(back.searchParams.get('error'), 'access_denied');

  stub({ rpc: { oauth_client_get: () => row } });
  const elsewhere = await call('/oauth/deny', {
    method: 'POST', body: { client_id: CLAUDE_CODE.client_id, redirect_uri: 'http://127.0.0.1:61000/other' },
  });
  assert.equal(elsewhere.status, 400);
});
