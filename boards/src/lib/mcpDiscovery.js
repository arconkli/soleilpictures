// What a directory, a scanner or a client reads about the hosted MCP server
// without signing in: its server card, the AI Catalog that lists it, and the
// /.well-known paths nothing serves.
//
// The standard card is MCP's server card (SEP-2127, final): name, title,
// description, version, icons, repository, websiteUrl and the remotes a client
// connects to, and nothing about tools. It is served at the two /server-card
// addresses beside the MCP endpoints, with the media type
// application/mcp-server-card+json, and listed in the AI Catalog at
// /.well-known/ai-catalog.json so a client that knows only the domain finds it.
// Its name, repository and remotes match mcp/server.json (the test holds them).
//
// The older card (SEP-1649's draft) stays at /.well-known/mcp/server-card.json
// and /.well-known/mcp.json for Smithery-style scanners: they read serverInfo,
// authentication and the tools with their schemas from a server they cannot
// sign in to. It carries no $schema, because the URL it once named never existed.

import { HOSTED_TOOLS, SERVER_INFO, toolManifest } from './mcpTools.js';
import { CAPABILITIES, INSTRUCTIONS, SUPPORTED_PROTOCOL_VERSIONS } from './mcpServer.js';

export const SERVER_CARD_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json';
export const SERVER_CARD_TYPE = 'application/mcp-server-card+json';
export const SERVER_CARD_ENDPOINTS = ['/api/v1/mcp/server-card', '/mcp/server-card'];
export const AI_CATALOG_PATH = '/.well-known/ai-catalog.json';
export const AI_CATALOG_TYPE = 'application/ai-catalog+json';
export const LEGACY_CARD_PATHS = ['/.well-known/mcp/server-card.json', '/.well-known/mcp.json'];

const DESCRIPTION = 'Read and build visual moodboards, shot lists and lookbooks from an AI assistant.';

export function serverCard(origin) {
  return {
    $schema: SERVER_CARD_SCHEMA,
    name: 'com.soleilpictures/clusters',
    title: SERVER_INFO.title,
    description: DESCRIPTION,
    version: SERVER_INFO.version,
    websiteUrl: `${origin}/docs/mcp`,
    icons: SERVER_INFO.icons,
    repository: { url: 'https://github.com/arconkli/soleilpictures', source: 'github', subfolder: 'mcp' },
    remotes: [
      { type: 'streamable-http', url: `${origin}/api/v1/mcp`, supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS },
      { type: 'streamable-http', url: `${origin}/mcp`, supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS },
    ],
  };
}

export function aiCatalog(origin) {
  return {
    specVersion: '1.0',
    entries: [{
      identifier: 'urn:air:soleilpictures.com:mcp:clusters',
      type: SERVER_CARD_TYPE,
      url: `${origin}${SERVER_CARD_ENDPOINTS[0]}`,
    }],
  };
}

export function legacyServerCard(origin) {
  return {
    version: '1.0',
    protocolVersion: '2025-11-25',
    serverInfo: { name: SERVER_INFO.name, title: SERVER_INFO.title, version: SERVER_INFO.version },
    description: DESCRIPTION,
    documentationUrl: `${origin}/docs/mcp`,
    iconUrl: SERVER_INFO.icons?.[0]?.src,
    transport: { type: 'streamable-http', endpoint: '/api/v1/mcp' },
    capabilities: CAPABILITIES,
    authentication: {
      required: true,
      schemes: ['oauth2'],
      // RFC 9728: where a client finds the authorization server.
      resourceMetadata: `${origin}/.well-known/oauth-protected-resource/api/v1/mcp`,
    },
    instructions: INSTRUCTIONS,
    tools: HOSTED_TOOLS.map((t) => {
      const m = toolManifest(t);
      return {
        name: m.name, title: m.title, description: m.description,
        inputSchema: m.inputSchema, annotations: m.annotations,
      };
    }),
  };
}

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=300',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,HEAD,OPTIONS',
  'access-control-allow-headers': 'content-type',
};

// The Worker's answer to the card addresses and to a /.well-known path that is
// not an OAuth document: a card, the catalog, or a JSON 404 (the SPA fallback
// would answer 200 HTML). The caller serves a static asset first.
export function wellKnownResponse(url, method) {
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: HEADERS });
  }
  const ok = (body, type) => new Response(method === 'HEAD' ? null : JSON.stringify(body), {
    status: 200, headers: { ...HEADERS, 'content-type': type },
  });
  if (SERVER_CARD_ENDPOINTS.includes(url.pathname)) return ok(serverCard(url.origin), SERVER_CARD_TYPE);
  if (url.pathname === AI_CATALOG_PATH) return ok(aiCatalog(url.origin), AI_CATALOG_TYPE);
  if (LEGACY_CARD_PATHS.includes(url.pathname)) return ok(legacyServerCard(url.origin), HEADERS['content-type']);
  return new Response(method === 'HEAD' ? null : JSON.stringify({ error: 'not_found' }), {
    status: 404, headers: { ...HEADERS, 'cache-control': 'public, max-age=60' },
  });
}
