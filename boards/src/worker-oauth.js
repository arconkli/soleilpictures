// OAuth 2.1 — Soleil Clusters as its own authorization server.
//
// WHY THIS EXISTS. Until now, connecting an assistant meant: have an account,
// sign in on the web, find Settings → API, mint a personal access token, and
// paste it into a JSON file on disk. That is a developer's flow, and the people
// this product is for are mostly not developers. It is also not what the
// protocol asks for — the MCP authorization specification says an MCP server
// MUST implement OAuth 2.0 Protected Resource Metadata (RFC 9728), and the
// client directories that would list us gate on the flow existing at all.
//
// With this, a client discovers everything it needs from two well-known
// documents, registers itself, sends the person to one page, and gets a token.
// Nobody ever sees the token. And because our sign-in IS our sign-up — one
// email box, no password — a person with no account at all can go from
// "Connect" to a working assistant without ever visiting the site first. That
// is the actual point of the exercise.
//
// WHAT IT DOES NOT DO. It introduces no new authorization model. An access
// token issued here is an ordinary api_tokens row: resolved by the same
// api_token_resolve, carrying the same read/write/delete scopes, subject to the
// same rate limit, and exchanged for the user's own Supabase session by the
// same code path in lib/apiAuth.js. So a connected assistant reaches exactly
// what the person reaches and not one row more — structurally, not by
// remembering to check.
//
// The DIVISION OF LABOUR with migration 0224 is deliberate: anything that must
// hold even if this file has a bug lives in SQL. Single-use codes, single-use
// refresh tokens, PKCE verification, and binding a code to its client and
// redirect_uri are all enforced inside the statement that claims the row. This
// file does URL parsing, hashing, and shape.

import { userRpc } from './lib/apiAuth.js';
import { scoutRpc } from './lib/scoutDb.js';

// An access token is short-lived and refreshed; that is the OAuth 2.1 default
// and it means a leaked token is a one-hour problem rather than a forever one.
const ACCESS_TTL_SECONDS = 3600;
const REFRESH_TTL_DAYS = 90;
const CODE_TTL_SECONDS = 120;
const MAX_REDIRECT_URIS = 10;

// The scopes a client gets if it asks for nothing. Deleting is deliberately NOT
// in it — the product's existing rule is that an agent may be allowed to build
// without being allowed to destroy, and a default that quietly included delete
// would undo that for every connection made through this flow.
const DEFAULT_SCOPES = ['read', 'write'];
const ALL_SCOPES = ['read', 'write', 'delete'];

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
  'access-control-max-age': '86400',
};

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...CORS, ...headers },
});

// OAuth errors have a defined shape (RFC 6749 §5.2) and clients branch on
// `error`. A prose message under some other key is not something they can act
// on, so every failure out of this file uses it.
const oauthError = (error, description, status = 400) =>
  json({ error, error_description: description }, status);

async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const randomHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

// ── The resource being protected ─────────────────────────────────────────────

// The canonical URI of this MCP server, per RFC 8707 §2: no fragment, no
// trailing slash, lowercase scheme and host.
const mcpResource = (origin) => `${origin}/api/v1/mcp`;

// Which `resource` values a token may be requested for.
//
// The check that matters is the one this enables: a token minted for someone
// else's server must never be accepted here, and a token minted here must never
// be usable there. Three spellings of OUR OWN resource are accepted because
// clients differ on how specific they are, and refusing a client for naming the
// API root rather than the MCP path would be pedantry with a support cost.
const acceptableResources = (origin) => new Set([
  origin, `${origin}/`, `${origin}/api/v1`, `${origin}/api/v1/`, mcpResource(origin),
]);

export function protectedResourceMetadata(origin, { resource } = {}) {
  return {
    resource: resource || mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: DEFAULT_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'Soleil Clusters',
    resource_documentation: `${origin}/docs/mcp`,
  };
}

export function authorizationServerMetadata(origin) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    scopes_supported: ALL_SCOPES,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // S256 only. OAuth 2.1 removes `plain`, and advertising it would invite a
    // client to use it.
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    // RFC 9207. We return `iss` on every authorization response including
    // errors, so we must say so — a client that sees this true and then no
    // `iss` is required to REJECT the response, which is the point.
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/docs/mcp`,
  };
}

// ── Redirect URIs ────────────────────────────────────────────────────────────

// What a client may be sent back to.
//
// Open redirection is the classic way an authorization code is stolen, so this
// is an allowlist by shape, not a denylist:
//
//   · https anywhere — the ordinary case for a hosted client.
//   · http ONLY on loopback, for a command-line client that has no domain
//     (RFC 8252 §7.3). `localhost` is included alongside the literals because
//     that is what people write, though the literals are what RFC 8252 prefers.
//   · a private scheme (cursor://, vscode://, com.example.app:/cb) — how a
//     desktop or mobile client receives a callback.
//
// A fragment is refused outright: the authorization response is appended to the
// query, and a URI that already carries a fragment cannot be extended safely.
export function redirectUriProblem(raw) {
  let u;
  try { u = new URL(raw); } catch { return 'not a valid absolute URI'; }
  if (u.hash) return 'must not contain a fragment';

  const scheme = u.protocol.replace(/:$/, '').toLowerCase();
  if (['javascript', 'data', 'file', 'blob', 'vbscript'].includes(scheme)) {
    return `the ${scheme} scheme is not allowed`;
  }
  if (scheme === 'https') return null;
  if (scheme === 'http') {
    const host = u.hostname.toLowerCase();
    return (host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === 'localhost')
      ? null
      : 'http is only allowed on loopback (127.0.0.1, ::1, localhost)';
  }
  // A private-use scheme. Must look like a reverse-DNS or app name, not a
  // browser-interpretable pseudo-scheme.
  return /^[a-z][a-z0-9+.-]*$/.test(scheme) ? null : 'unrecognised URI scheme';
}

// ── Client authentication ────────────────────────────────────────────────────

// A public client presents only its id (PKCE is what proves it). A confidential
// client also presents a secret, either in the body or as HTTP Basic.
async function authenticateClient(env, params, request) {
  let clientId = params.get('client_id') || '';
  let secret = params.get('client_secret') || '';

  const basic = request.headers.get('authorization') || '';
  if (/^Basic\s+/i.test(basic)) {
    try {
      const [u, p] = atob(basic.replace(/^Basic\s+/i, '')).split(':');
      // Per RFC 6749 the credentials are form-urlencoded before base64.
      if (u) clientId = decodeURIComponent(u);
      if (p) secret = decodeURIComponent(p);
    } catch { /* fall through to the body values */ }
  }

  if (!clientId) return { error: 'invalid_client', detail: 'client_id is required' };

  const client = await scoutRpc(env, 'oauth_client_get', { p_client_id: clientId })
    .catch(() => null);
  const row = Array.isArray(client) ? client[0] : client;
  if (!row || !row.client_id) return { error: 'invalid_client', detail: 'unknown client' };

  if (row.client_secret_hash) {
    if (!secret) return { error: 'invalid_client', detail: 'this client must present its secret' };
    if (await sha256Hex(secret) !== row.client_secret_hash) {
      return { error: 'invalid_client', detail: 'client authentication failed' };
    }
  }
  return { client: row };
}

// ── Routes ───────────────────────────────────────────────────────────────────

export function isOAuthRoute(pathname) {
  return pathname.startsWith('/oauth/')
    || pathname === '/.well-known/oauth-authorization-server'
    || pathname === '/.well-known/openid-configuration'
    || pathname.startsWith('/.well-known/oauth-authorization-server/')
    || pathname.startsWith('/.well-known/oauth-protected-resource');
}

export async function handleOAuthRoute(url, request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { origin, pathname } = url;

  // ── Discovery ──
  //
  // Both documents are public and cacheable. A discovery document you need a
  // credential to read is not discovery.
  if (pathname.startsWith('/.well-known/oauth-protected-resource')) {
    // RFC 9728 §3.1: for a resource with a path, the metadata lives at the
    // well-known prefix followed by that path. The bare form is served too
    // because clients differ on which they ask for first, and it describes the
    // origin rather than pretending to describe the MCP path.
    const suffix = pathname.slice('/.well-known/oauth-protected-resource'.length);
    const resource = suffix && suffix !== '/' ? `${origin}${suffix.replace(/\/$/, '')}` : origin;
    return json(protectedResourceMetadata(origin, { resource }), 200,
      { 'cache-control': 'public, max-age=3600' });
  }

  if (pathname === '/.well-known/oauth-authorization-server'
      || pathname.startsWith('/.well-known/oauth-authorization-server/')
      || pathname === '/.well-known/openid-configuration') {
    return json(authorizationServerMetadata(origin), 200,
      { 'cache-control': 'public, max-age=3600' });
  }

  // ── Dynamic client registration (RFC 7591) ──
  if (pathname === '/oauth/register') {
    if (request.method !== 'POST') {
      return oauthError('invalid_request', 'POST client metadata to register', 405);
    }
    let meta;
    try { meta = await request.json(); } catch { meta = null; }
    if (!meta || typeof meta !== 'object') {
      return oauthError('invalid_client_metadata', 'the body must be a JSON object');
    }

    const uris = Array.isArray(meta.redirect_uris) ? meta.redirect_uris : [];
    if (!uris.length) {
      return oauthError('invalid_redirect_uri', 'redirect_uris is required and must not be empty');
    }
    if (uris.length > MAX_REDIRECT_URIS) {
      return oauthError('invalid_redirect_uri', `at most ${MAX_REDIRECT_URIS} redirect_uris`);
    }
    for (const uri of uris) {
      const problem = redirectUriProblem(String(uri));
      if (problem) return oauthError('invalid_redirect_uri', `${uri}: ${problem}`);
    }

    const authMethod = String(meta.token_endpoint_auth_method || 'none');
    let secret = null;
    if (authMethod !== 'none') {
      secret = `cs_${randomHex(32)}`;
    }

    const grantTypes = Array.isArray(meta.grant_types) && meta.grant_types.length
      ? meta.grant_types.filter((g) => ['authorization_code', 'refresh_token'].includes(g))
      : ['authorization_code', 'refresh_token'];
    if (!grantTypes.includes('authorization_code')) {
      return oauthError('invalid_client_metadata',
        'this server only issues tokens through the authorization_code grant');
    }

    let row;
    try {
      const rows = await scoutRpc(env, 'oauth_client_register', {
        p_meta: {
          client_name: String(meta.client_name || '').slice(0, 120),
          client_uri: meta.client_uri ? String(meta.client_uri).slice(0, 500) : null,
          logo_uri: meta.logo_uri ? String(meta.logo_uri).slice(0, 500) : null,
          redirect_uris: uris.map(String),
          grant_types: grantTypes,
          response_types: ['code'],
          token_endpoint_auth_method: authMethod,
          scope: normalizeScopeString(meta.scope) || DEFAULT_SCOPES.join(' '),
          software_id: meta.software_id ? String(meta.software_id).slice(0, 120) : null,
          software_version: meta.software_version ? String(meta.software_version).slice(0, 60) : null,
          client_secret_hash: secret ? await sha256Hex(secret) : null,
        },
        p_ip: request.headers.get('cf-connecting-ip') || null,
      });
      row = Array.isArray(rows) ? rows[0] : rows;
    } catch (e) {
      if (/too many client registrations/i.test(e?.message || '')) {
        return oauthError('invalid_client_metadata', e.message, 429);
      }
      return oauthError('server_error', 'could not register that client', 500);
    }
    if (!row?.client_id) return oauthError('server_error', 'could not register that client', 500);

    return json({
      client_id: row.client_id,
      ...(secret ? { client_secret: secret } : {}),
      client_id_issued_at: Math.floor(Date.parse(row.created_at) / 1000),
      ...(secret ? { client_secret_expires_at: 0 } : {}),
      client_name: row.client_name,
      redirect_uris: row.redirect_uris,
      grant_types: row.grant_types,
      response_types: row.response_types,
      token_endpoint_auth_method: row.token_endpoint_auth_method,
      scope: row.scope,
    }, 201);
  }

  // ── What the consent screen needs to describe the request ──
  //
  // The consent page asks for this BEFORE showing anything, so a bad client_id
  // or an unregistered redirect_uri produces an error page rather than a
  // redirect. Sending an error to an unverified redirect_uri is itself the open
  // redirect this is guarding against.
  if (pathname === '/oauth/client' && request.method === 'GET') {
    const clientId = url.searchParams.get('client_id') || '';
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    const rows = await scoutRpc(env, 'oauth_client_get', { p_client_id: clientId }).catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row?.client_id) return oauthError('invalid_client', 'unknown client', 404);
    const known = (row.redirect_uris || []).includes(redirectUri);
    return json({
      client_id: row.client_id,
      client_name: row.client_name,
      client_uri: row.client_uri,
      logo_uri: row.logo_uri,
      // Never echo the registered list back — it would let anyone enumerate a
      // client's callbacks. Just say whether the one presented is among them.
      redirect_uri_registered: known,
      scopes_supported: ALL_SCOPES,
    });
  }

  // ── Consent → authorization code ──
  //
  // Called by the consent page with the person's own Supabase session. The code
  // is bound to auth.uid() inside the RPC, so this Worker never asserts an
  // identity — it only passes one along.
  if (pathname === '/oauth/authorize' && request.method === 'POST') {
    const auth = (request.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/i);
    if (!auth) return oauthError('access_denied', 'sign in first', 401);

    let body;
    try { body = await request.json(); } catch { body = null; }
    if (!body || typeof body !== 'object') {
      return oauthError('invalid_request', 'the body must be a JSON object');
    }

    const clientId = String(body.client_id || '');
    const redirectUri = String(body.redirect_uri || '');
    const challenge = String(body.code_challenge || '');
    const method = String(body.code_challenge_method || 'S256');
    const state = body.state == null ? null : String(body.state);
    const resource = body.resource ? String(body.resource) : '';
    const scopes = parseScopes(body.scope);

    if (!clientId || !redirectUri) {
      return oauthError('invalid_request', 'client_id and redirect_uri are required');
    }
    if (method !== 'S256') {
      return oauthError('invalid_request', 'code_challenge_method must be S256');
    }
    if (!challenge || challenge.length < 43) {
      return oauthError('invalid_request', 'a PKCE code_challenge is required');
    }
    // RFC 8707. A token is minted for a named audience; a resource we do not
    // serve is a request to mint a credential for somebody else.
    if (resource && !acceptableResources(origin).has(resource.replace(/\/$/, '') || origin)
        && !acceptableResources(origin).has(resource)) {
      return oauthError('invalid_target', 'that resource is not served here');
    }

    const code = `ac_${randomHex(32)}`;
    try {
      await userRpc(env, auth[1], 'oauth_authorize_consent', {
        p_client_id: clientId,
        p_code_hash: await sha256Hex(code),
        p_redirect_uri: redirectUri,
        p_scope: scopes,
        p_challenge: challenge,
        p_method: 'S256',
        p_resource: resource || null,
        p_ttl_seconds: CODE_TTL_SECONDS,
      });
    } catch (e) {
      const message = e?.message || 'could not record that approval';
      const status = /unknown client|redirect_uri/i.test(message) ? 400 : 403;
      return oauthError(/redirect_uri|unknown client/i.test(message) ? 'invalid_request' : 'access_denied',
        message, status);
    }

    // `iss` on every response, per RFC 9207 — a client that recorded our issuer
    // compares it before it will send the code anywhere, which is what defeats
    // a mix-up attack between two authorization servers.
    const back = new URL(redirectUri);
    back.searchParams.set('code', code);
    if (state != null) back.searchParams.set('state', state);
    back.searchParams.set('iss', origin);
    return json({ redirect_to: back.toString() });
  }

  // The person said no. Reported to the client the way the spec expects, so it
  // can show "you declined" rather than hanging on a callback that never comes.
  if (pathname === '/oauth/deny' && request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { body = null; }
    const clientId = String(body?.client_id || '');
    const redirectUri = String(body?.redirect_uri || '');
    const rows = await scoutRpc(env, 'oauth_client_get', { p_client_id: clientId }).catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : rows;
    // Same rule as everywhere else: never redirect to a URI we have not
    // verified belongs to the client.
    if (!row?.client_id || !(row.redirect_uris || []).includes(redirectUri)) {
      return oauthError('invalid_request', 'unknown client or redirect_uri');
    }
    const back = new URL(redirectUri);
    back.searchParams.set('error', 'access_denied');
    back.searchParams.set('error_description', 'the person declined this request');
    if (body?.state != null) back.searchParams.set('state', String(body.state));
    back.searchParams.set('iss', origin);
    return json({ redirect_to: back.toString() });
  }

  // ── Token ──
  if (pathname === '/oauth/token') {
    if (request.method !== 'POST') {
      return oauthError('invalid_request', 'POST form-encoded parameters', 405);
    }
    const params = await readForm(request);
    if (!params) return oauthError('invalid_request', 'could not read the request body');

    const authed = await authenticateClient(env, params, request);
    if (authed.error) return oauthError(authed.error, authed.detail, 401);
    const client = authed.client;

    const grantType = params.get('grant_type') || '';

    if (grantType === 'authorization_code') {
      const code = params.get('code') || '';
      const redirectUri = params.get('redirect_uri') || '';
      const verifier = params.get('code_verifier') || '';
      if (!code || !redirectUri) {
        return oauthError('invalid_request', 'code and redirect_uri are required');
      }
      if (!verifier) return oauthError('invalid_request', 'code_verifier is required');

      const access = `sk_mcp_${randomHex(24)}`;
      const refresh = `rt_${randomHex(32)}`;
      let issued;
      try {
        const rows = await scoutRpc(env, 'oauth_code_redeem', {
          p_code_hash: await sha256Hex(code),
          p_client_id: client.client_id,
          p_redirect_uri: redirectUri,
          p_verifier: verifier,
          p_access_hash: await sha256Hex(access),
          p_prefix: access.slice(0, 14),
          p_refresh_hash: await sha256Hex(refresh),
          p_access_ttl: ACCESS_TTL_SECONDS,
          p_refresh_days: REFRESH_TTL_DAYS,
        });
        issued = Array.isArray(rows) ? rows[0] : rows;
      } catch (e) {
        return oauthError('invalid_grant', e?.message || 'that authorization code is not valid');
      }
      if (!issued) return oauthError('invalid_grant', 'that authorization code is not valid');

      return tokenResponse(access, refresh, issued.scope);
    }

    if (grantType === 'refresh_token') {
      const presented = params.get('refresh_token') || '';
      if (!presented) return oauthError('invalid_request', 'refresh_token is required');

      const access = `sk_mcp_${randomHex(24)}`;
      const refresh = `rt_${randomHex(32)}`;
      let issued;
      try {
        const rows = await scoutRpc(env, 'oauth_refresh_rotate', {
          p_refresh_hash: await sha256Hex(presented),
          p_client_id: client.client_id,
          p_new_access_hash: await sha256Hex(access),
          p_prefix: access.slice(0, 14),
          p_new_refresh_hash: await sha256Hex(refresh),
          p_access_ttl: ACCESS_TTL_SECONDS,
          p_refresh_days: REFRESH_TTL_DAYS,
        });
        issued = Array.isArray(rows) ? rows[0] : rows;
      } catch (e) {
        return oauthError('invalid_grant', e?.message || 'that refresh token is not valid');
      }
      if (!issued) return oauthError('invalid_grant', 'that refresh token is not valid');

      return tokenResponse(access, refresh, issued.scope);
    }

    return oauthError('unsupported_grant_type',
      'this server supports authorization_code and refresh_token');
  }

  // ── Revocation (RFC 7009) ──
  //
  // Always answers 200, even for a token that was never valid. Saying "no such
  // token" turns this endpoint into an oracle for checking whether a stolen
  // string is live.
  if (pathname === '/oauth/revoke') {
    if (request.method !== 'POST') {
      return oauthError('invalid_request', 'POST form-encoded parameters', 405);
    }
    const params = await readForm(request);
    if (!params) return oauthError('invalid_request', 'could not read the request body');
    const authed = await authenticateClient(env, params, request);
    if (authed.error) return oauthError(authed.error, authed.detail, 401);

    const token = params.get('token') || '';
    if (token) {
      await scoutRpc(env, 'oauth_token_revoke_by_hash', {
        p_hash: await sha256Hex(token),
        p_client_id: authed.client.client_id,
      }).catch(() => {});
    }
    return json({}, 200);
  }

  return oauthError('invalid_request', 'no such endpoint', 404);
}

function tokenResponse(access, refresh, scope) {
  return json({
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: refresh,
    scope: (Array.isArray(scope) ? scope : DEFAULT_SCOPES).join(' '),
  }, 200, { 'cache-control': 'no-store', pragma: 'no-cache' });
}

// A token request is form-encoded per OAuth. JSON is accepted too because some
// clients send it, and refusing them over a content type buys nothing.
async function readForm(request) {
  const type = request.headers.get('content-type') || '';
  try {
    if (type.includes('application/json')) {
      const body = await request.json();
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(body || {})) {
        if (v != null) params.set(k, String(v));
      }
      return params;
    }
    return new URLSearchParams(await request.text());
  } catch {
    return null;
  }
}

function normalizeScopeString(scope) {
  const list = parseScopes(scope);
  return list.length ? list.join(' ') : '';
}

// Space-delimited per OAuth; an array is accepted from our own consent page.
// Unknown scopes are DROPPED rather than refused: a client asking for
// `offline_access` or `profile` out of habit should get a working connection
// with the scopes we do have, not an error it cannot interpret.
export function parseScopes(scope) {
  const raw = Array.isArray(scope)
    ? scope
    : String(scope || '').split(/[\s,]+/);
  const wanted = raw.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  const known = ALL_SCOPES.filter((s) => wanted.includes(s));
  return known.length ? known : DEFAULT_SCOPES;
}
