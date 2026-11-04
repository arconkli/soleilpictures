// mcpDiscovery.test.mjs — how a client or a directory first meets the hosted
// MCP server: the 401 that starts sign-in, the server card, the /.well-known
// paths nothing serves, and a browser sent to the docs.
//
//   node --test src/lib/mcpDiscovery.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApiRoute } from '../worker-api.js';
import { readFileSync } from 'node:fs';
import {
  serverCard, legacyServerCard, aiCatalog, wellKnownResponse, SERVER_CARD_SCHEMA, SERVER_CARD_TYPE,
  SERVER_CARD_ENDPOINTS, AI_CATALOG_PATH, LEGACY_CARD_PATHS,
} from './mcpDiscovery.js';
import { HOSTED_TOOLS, SERVER_INFO } from './mcpTools.js';

const ORIGIN = 'https://clusters.test';
const LIVE = 'https://clusters.soleilpictures.com';
const SERVER_JSON = JSON.parse(readFileSync(new URL('../../../mcp/server.json', import.meta.url), 'utf8'));
const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's' };
const go = (path, init = {}) => {
  const url = new URL(path, ORIGIN);
  return handleApiRoute(url, new Request(url, init), ENV, null);
};

test('no Authorization header: 401 with the way in and no error code (RFC 6750 3.1)', async () => {
  const r = await go('/api/v1/mcp', { method: 'POST', body: '{}' });
  assert.equal(r.status, 401);
  const h = r.headers.get('www-authenticate');
  assert.match(h, /^Bearer /);
  assert.match(h, new RegExp(`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/v1/mcp"`));
  assert.doesNotMatch(h, /error=/);
});

test('a bad token keeps error="invalid_token"', async () => {
  const r = await go('/api/v1/mcp', { method: 'POST', headers: { authorization: 'Bearer nope' }, body: '{}' });
  assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate'), /error="invalid_token"/);
  assert.match(r.headers.get('www-authenticate'), /resource_metadata=/);
});

test('CORS exposes WWW-Authenticate beside what it listed', async () => {
  const r = await go('/api/v1/mcp', { method: 'OPTIONS' });
  const exposed = r.headers.get('access-control-expose-headers').split(',');
  for (const h of ['www-authenticate', 'retry-after', 'etag', 'x-ratelimit-limit']) assert.ok(exposed.includes(h), h);
});

test('a browser opening /api/v1/mcp goes to the docs; an MCP client\'s GET does not', async () => {
  const page = await go('/api/v1/mcp', { headers: { accept: 'text/html,application/xhtml+xml' } });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), `${ORIGIN}/docs/mcp`);
  const stream = await go('/api/v1/mcp', { headers: { accept: 'text/event-stream' } });
  assert.equal(stream.status, 401);
  const other = await go('/api/v1/boards', { headers: { accept: 'text/html' } });
  assert.equal(other.status, 401);
});

test('the standard server card is the SEP-2127 card, and matches the registry entry', async () => {
  const required = ['$schema', 'name', 'description', 'version'];
  const optional = ['title', 'icons', 'repository', 'websiteUrl', 'remotes'];
  for (const path of SERVER_CARD_ENDPOINTS) {
    const r = wellKnownResponse(new URL(path, LIVE), 'GET');
    assert.equal(r.status, 200, path);
    assert.equal(r.headers.get('content-type'), SERVER_CARD_TYPE);
    assert.equal(r.headers.get('content-type'), 'application/mcp-server-card+json');
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.match(r.headers.get('cache-control'), /max-age=\d+/);
    const card = await r.json();
    for (const k of required) assert.ok(card[k], k);
    assert.deepEqual(Object.keys(card).filter((k) => !required.includes(k)).sort(), [...optional].sort());
    for (const k of ['tools', 'prompts', 'resources']) assert.ok(!(k in card), `${k} is not on the card`);
    assert.equal(card.$schema, 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json');
    assert.equal(card.$schema, SERVER_CARD_SCHEMA);
    assert.match(card.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    assert.equal(card.name, SERVER_JSON.name);
    assert.ok(card.description.length >= 1 && card.description.length <= 100, 'description is 1-100 characters');
    assert.equal(card.version, SERVER_INFO.version);
    assert.equal(card.version, SERVER_JSON.version);
    assert.equal(card.title, SERVER_INFO.title);
    assert.equal(card.websiteUrl, `${LIVE}/docs/mcp`);
    assert.deepEqual(card.repository, SERVER_JSON.repository);
    assert.deepEqual(card.remotes.map((x) => x.url), SERVER_JSON.remotes.map((x) => x.url));
    assert.ok(card.remotes.every((x) => x.type === 'streamable-http' && x.supportedProtocolVersions.length));
  }
  assert.deepEqual(serverCard(ORIGIN), serverCard(ORIGIN));
});

test('the AI Catalog lists the standard card', async () => {
  const r = wellKnownResponse(new URL(AI_CATALOG_PATH, ORIGIN), 'GET');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/ai-catalog+json');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  const catalog = await r.json();
  assert.deepEqual(catalog, aiCatalog(ORIGIN));
  assert.equal(catalog.specVersion, '1.0');
  assert.equal(catalog.entries.length, 1);
  assert.equal(catalog.entries[0].type, 'application/mcp-server-card+json');
  assert.match(catalog.entries[0].identifier, /^urn:air:/);
  assert.equal(catalog.entries[0].url, `${ORIGIN}/api/v1/mcp/server-card`);
});

test('every card address answers HEAD without a body, and OPTIONS and other verbs as before', async () => {
  for (const path of [...SERVER_CARD_ENDPOINTS, AI_CATALOG_PATH, ...LEGACY_CARD_PATHS]) {
    const head = wellKnownResponse(new URL(path, ORIGIN), 'HEAD');
    assert.equal(head.status, 200, path);
    assert.equal(await head.text(), '', path);
    assert.ok(head.headers.get('content-type'), path);
    assert.equal(wellKnownResponse(new URL(path, ORIGIN), 'OPTIONS').status, 204, path);
    assert.equal(wellKnownResponse(new URL(path, ORIGIN), 'POST').status, 405, path);
  }
});

test('the older card stays for scanners that cannot sign in, and names no $schema', async () => {
  for (const path of LEGACY_CARD_PATHS) {
    const r = wellKnownResponse(new URL(path, ORIGIN), 'GET');
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-type'), /^application\/json/);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    const card = await r.json();
    assert.ok(!('$schema' in card), 'the URL it once named never existed');
    assert.equal(card.serverInfo.name, SERVER_INFO.name);
    assert.equal(card.serverInfo.version, SERVER_INFO.version);
    assert.equal(card.documentationUrl, `${ORIGIN}/docs/mcp`);
    assert.deepEqual(card.transport, { type: 'streamable-http', endpoint: '/api/v1/mcp' });
    assert.equal(card.authentication.required, true);
    assert.deepEqual(card.authentication.schemes, ['oauth2']);
    assert.deepEqual(card.tools.map((t) => t.name), HOSTED_TOOLS.map((t) => t.name));
    assert.ok(card.tools.every((t) => t.title && t.description && t.inputSchema && t.annotations));
    for (const k of ['version', 'protocolVersion', 'serverInfo', 'transport', 'capabilities']) assert.ok(card[k], k);
  }
  assert.deepEqual(legacyServerCard(ORIGIN), legacyServerCard(ORIGIN));
});

test('any other /.well-known path answers a JSON 404, not the app', async () => {
  const r = wellKnownResponse(new URL('/.well-known/nothing-here', ORIGIN), 'GET');
  assert.equal(r.status, 404);
  assert.match(r.headers.get('content-type'), /^application\/json/);
  assert.deepEqual(await r.json(), { error: 'not_found' });
  assert.equal(wellKnownResponse(new URL('/.well-known/x', ORIGIN), 'GET').status, 404);
});
