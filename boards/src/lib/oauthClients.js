// Who is asking: the clients this authorization server will talk to.
//
// Two kinds. A REGISTERED client POSTed its metadata to /oauth/register
// (RFC 7591) and was handed an opaque `soleil_…` id. A METADATA client is named
// by an https URL that serves its own metadata, the Client ID Metadata Document
// (draft-ietf-oauth-client-id-metadata-document), which the MCP authorization
// spec prefers since 2025-11-25 and which Claude, Claude Code, ChatGPT and
// VS Code use whenever the server advertises it. Nothing is registered: the
// client_id IS the document's address, so the name on the consent screen comes
// from a host its owner controls rather than from whatever was typed into a
// registration form.
//
// This file is the pure half: what a client_id URL may look like, what a
// fetched document must say, how long it is trusted, and which redirect URIs
// match a registered one. worker-oauth.js does the fetching. The redirect rule
// is enforced a second time in SQL, by _oauth_redirect_matches (0701), at the
// moment a consent is recorded; oauthClients.test.mjs holds this file and that
// function to the same list of pairs, read out of the migration itself.

// Redirect URIs a client may list, registered or published.
export const MAX_REDIRECT_URIS = 10;

// A metadata document is a few hundred bytes of JSON. The draft recommends
// reading at most 5 KB (§8.7): anything larger is not a client document, and
// this fetch runs on behalf of whoever typed the URL.
export const METADATA_MAX_BYTES = 5 * 1024;

// Claude gives the whole discovery step 10 seconds; a document that takes
// longer than 3 to arrive is better refused than allowed to eat the rest.
export const METADATA_TIMEOUT_MS = 3000;

// How long a fetched document is trusted before it is read again: its own
// Cache-Control max-age, within these bounds. The floor keeps one consent flow
// (a page load, then an approval a minute later) from fetching twice; the
// ceiling means a client that changes its redirect URIs is believed within a
// day. A failed fetch is never cached (§5.2).
export const METADATA_CACHE_MIN_SECONDS = 300;
export const METADATA_CACHE_MAX_SECONDS = 86400;
export const METADATA_CACHE_DEFAULT_SECONDS = 3600;

const METADATA_URL_MAX = 512;

// The client_id URL's own rules (§3): https, a path, no fragment, no
// credentials, and spelled the way a URL parser would spell it, which rules out
// `.` and `..` segments, an explicit :443 and upper-case hosts in one check.
// Whether the host is one the server may fetch is asked separately, at fetch
// time, by safeUrl.js.
export function isMetadataClientId(id) {
  if (typeof id !== 'string' || !id.startsWith('https://') || id.length > METADATA_URL_MAX) return false;
  if (id.includes('#')) return false;
  let u;
  try { u = new URL(id); } catch { return false; }
  return u.href === id && !u.username && !u.password && u.pathname.length > 1;
}

export function clientKind(clientId) {
  return isMetadataClientId(clientId) ? 'metadata' : 'registered';
}

// The host that vouches for a metadata client's name ("claude.ai"), or null
// for a registered client, whose name is only what it said about itself.
export function clientHost(clientId) {
  return isMetadataClientId(clientId) ? new URL(clientId).host : null;
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

// Does the redirect_uri on a request match one the client listed?
//
// Exactly, with one exception the RFC makes mandatory: on loopback the port is
// the client's to choose when it starts listening (RFC 8252 §7.3, "MUST allow
// any port"). Claude Code publishes `http://localhost/callback` with no port at
// all and comes back on whatever the operating system gave it, so an exact
// match would refuse it every time. Host, path and query still match exactly,
// and https never gets the exception: a port on a real host is a different
// service. Kept in step with _oauth_redirect_matches (0701) by test.
const LOOPBACK_REDIRECT = /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost)(:([0-9]{1,5}))?(\/[^#]*)?$/i;

function loopbackParts(uri, { checkPort }) {
  const m = LOOPBACK_REDIRECT.exec(uri);
  if (!m) return null;
  if (checkPort && m[3] != null && (Number(m[3]) < 1 || Number(m[3]) > 65535)) return null;
  return { host: m[1].toLowerCase(), rest: m[4] ?? '/' };
}

export function redirectUriMatches(registered, presented) {
  if (typeof registered !== 'string' || typeof presented !== 'string') return false;
  if (registered === presented) return true;
  const r = loopbackParts(registered, { checkPort: false });
  const p = loopbackParts(presented, { checkPort: true });
  return Boolean(r && p && r.host === p.host && r.rest === p.rest);
}

export function anyRedirectMatches(registered, presented) {
  return Array.isArray(registered) && registered.some((r) => redirectUriMatches(r, presented));
}

// ── The document ─────────────────────────────────────────────────────────────

const SUPPORTED_GRANTS = ['authorization_code', 'refresh_token'];

// A published document cannot keep a secret, so the draft forbids every
// shared-secret method (§4.1). `private_key_jwt` is accepted and the client is
// treated as public: this server does not advertise it, a client picks from
// the methods both sides list (ChatGPT lists `none` beside it), and PKCE is
// what proves possession of a code either way.
const SECRET_METHODS = ['client_secret_post', 'client_secret_basic', 'client_secret_jwt'];
const PUBLIC_METHODS = ['none', 'private_key_jwt'];

const httpsOrNull = (v) => {
  if (typeof v !== 'string' || !v.startsWith('https://')) return null;
  try { new URL(v); } catch { return null; }
  return v.slice(0, 500);
};

const textOrNull = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * Read a fetched metadata document. Returns `{ meta }`, the fields to store
 * (the same shape /oauth/register stores), or `{ problem }`, a sentence that
 * completes "the client metadata document …" for the developer reading the
 * error.
 */
export function clientMetadataFromDocument(doc, url) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { problem: 'is not a JSON object' };
  if (doc.client_id !== url) {
    return { problem: 'names a different client_id; it must be exactly the URL it is served from' };
  }
  if (doc.client_secret != null) return { problem: 'publishes a client_secret, which a public document cannot keep' };

  const uris = doc.redirect_uris;
  if (!Array.isArray(uris) || !uris.length) return { problem: 'must list redirect_uris' };
  if (uris.length > MAX_REDIRECT_URIS) return { problem: `lists more than ${MAX_REDIRECT_URIS} redirect_uris` };
  for (const uri of uris) {
    if (typeof uri !== 'string') return { problem: 'has a redirect_uri that is not a string' };
    const problem = redirectUriProblem(uri);
    if (problem) return { problem: `has a redirect_uri ${uri} that is ${problem}` };
  }

  const method = doc.token_endpoint_auth_method == null ? 'none' : String(doc.token_endpoint_auth_method);
  if (SECRET_METHODS.includes(method)) {
    return { problem: `uses ${method}, and a metadata document cannot hold a shared secret` };
  }
  if (!PUBLIC_METHODS.includes(method)) {
    return { problem: `uses ${method}; this server accepts none (with PKCE) or private_key_jwt` };
  }

  // RFC 7591 defaults: authorization_code and code. Grants this server does
  // not have (Claude lists jwt-bearer, VS Code device_code) are ignored rather
  // than refused, as /oauth/register ignores them.
  const grants = doc.grant_types == null ? ['authorization_code'] : doc.grant_types;
  if (!Array.isArray(grants) || !grants.includes('authorization_code')) {
    return { problem: 'must allow the authorization_code grant' };
  }
  const responses = doc.response_types == null ? ['code'] : doc.response_types;
  if (!Array.isArray(responses) || !responses.includes('code')) {
    return { problem: 'must allow the code response type' };
  }

  return {
    meta: {
      client_name: textOrNull(doc.client_name, 120) || new URL(url).host,
      client_uri: httpsOrNull(doc.client_uri),
      logo_uri: httpsOrNull(doc.logo_uri),
      redirect_uris: uris,
      grant_types: SUPPORTED_GRANTS.filter((g) => grants.includes(g)),
      scope: typeof doc.scope === 'string' ? doc.scope.slice(0, 200) : null,
      software_id: textOrNull(doc.software_id, 120),
      software_version: textOrNull(doc.software_version, 60),
    },
  };
}

// Seconds to trust a document for, from the response's Cache-Control.
// `no-store` and `no-cache` get the floor rather than zero: the row has to
// exist for the code and the grant to point at, and re-reading it at every
// step of one sign-in protects nobody.
export function metadataCacheSeconds(cacheControl) {
  const cc = String(cacheControl || '').toLowerCase();
  if (/(^|[\s,])(no-store|no-cache)(\s*[,=]|\s*$)/.test(cc)) return METADATA_CACHE_MIN_SECONDS;
  const m = cc.match(/(?:^|[\s,])max-age\s*=\s*"?(\d+)/);
  const seconds = m ? Number(m[1]) : METADATA_CACHE_DEFAULT_SECONDS;
  return Math.min(METADATA_CACHE_MAX_SECONDS, Math.max(METADATA_CACHE_MIN_SECONDS, seconds));
}
