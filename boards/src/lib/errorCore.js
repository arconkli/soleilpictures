// errorCore.js — what an error row holds, and how a failed request is read.
//
// Pure: no import.meta.env, no window, so `node --test` loads it
// (errorCore.test.mjs). errorSender.js, the lazy half of errorReporting.js,
// is its only importer, which keeps all of this out of the entry chunk.
//
// Nothing here may carry content. A row says what failed, where, and the names
// of the steps before it; never what anyone typed, a file's name, or a link's
// token. The server says the same again: 0580's _client_error_context() and
// _client_error_crumbs() keep only these keys, whatever a client sends.

// The context allowlist. _client_error_context() is the server's twin, and
// errorCore.test.mjs holds the two identical.
export const ERROR_CONTEXT_KEYS = Object.freeze([
  'op', 'code', 'surface', 'vis', 'net', 'tag', 'host', 'phase', 'group',
  'board_id', 'online', 'attempt', 'ms', 'http',
]);
export const ERROR_HTTP_KEYS = Object.freeze(['method', 'svc', 'route', 'pg', 'status', 'ms']);

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const UUID_ONLY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ctxStr(v) {
  if (typeof v !== 'string' || v.includes('@')) return undefined;
  return v.replace(UUID_RE, ':id').slice(0, 80);
}
function ctxInt(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined;
}

function httpContext(h) {
  if (!h || typeof h !== 'object') return null;
  const out = {};
  for (const k of ERROR_HTTP_KEYS) {
    const v = k === 'status' || k === 'ms' ? ctxInt(h[k]) : ctxStr(h[k]);
    if (v !== undefined) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

// The context a row may carry, the same way the server cuts it down.
export function errorContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return null;
  const out = {};
  for (const k of ERROR_CONTEXT_KEYS) {
    const v = ctx[k];
    if (v == null) continue;
    let kept;
    if (k === 'board_id') kept = typeof v === 'string' && UUID_ONLY.test(v) ? v.toLowerCase() : undefined;
    else if (k === 'online') kept = typeof v === 'boolean' ? v : undefined;
    else if (k === 'attempt' || k === 'ms') kept = ctxInt(v);
    else if (k === 'http') kept = httpContext(v) || undefined;
    else kept = ctxStr(v);
    if (kept !== undefined) out[k] = kept;
  }
  return Object.keys(out).length ? out : null;
}

// One page load's dedupe key: the same failure with a different number in it
// (a position, a size, an id) is the same failure.
export function dedupeKey(kind, message, stack) {
  const frame = (typeof stack === 'string' ? stack.split('\n')[1] : '') || '';
  const norm = (s) => String(s || '').replace(UUID_RE, '#').replace(/\d+/g, '#').slice(0, 300);
  return `${kind}|${norm(message)}|${norm(frame)}`;
}

// The crumbs a row carries. A failed request's crumb kept its address in
// memory (errorCrumbs.js); here it becomes a service and route, and the
// address goes no further.
export function crumbNames(crumbs, hosts = {}) {
  if (!Array.isArray(crumbs) || !crumbs.length) return null;
  return crumbs.slice(-25).map(({ t, k, n, u }) => {
    if (!u) return { t, k, n };
    const r = routeOf(u, hosts);
    const [method, status] = String(n).split(' ');
    return { t, k, n: `${method} ${r ? `${r.svc}/${r.route}` : 'elsewhere'} ${status || ''}`.trim().slice(0, 60) };
  });
}

// ── Failed requests ─────────────────────────────────────────────────────────

const PG_NAMES = {
  '57014': 'statement timeout', '42501': 'permission denied', '23505': 'duplicate key',
  '23503': 'foreign key', '23502': 'missing value', '23514': 'check failed', '22P02': 'invalid input',
  '42P01': 'no such table', '42883': 'no such function', '42703': 'no such column',
  '42P10': 'no unique index for on_conflict', '40001': 'serialization failure', '40P01': 'deadlock',
  '53300': 'too many connections', '53400': 'over a configured limit', 'P0001': 'raised',
  'PGRST116': 'no rows', 'PGRST202': 'no such function', 'PGRST204': 'no such column',
  'PGRST301': 'bad token', 'PGRST303': 'token expired',
};
const STATUS_NAMES = {
  0: 'network failure', 400: 'bad request', 401: 'unauthorized', 403: 'forbidden', 404: 'not found',
  405: 'method not allowed', 406: 'not acceptable', 408: 'timed out', 409: 'conflict',
  413: 'too large', 415: 'unsupported type', 422: 'unprocessable', 429: 'rate limited',
  500: 'server error', 502: 'bad gateway', 503: 'unavailable', 504: 'gateway timeout',
};
// A failed request in words: the database's code by its name, else the
// status's. serverErrors.js says the servers' failures the same way.
export function failureWords(status, pg) {
  return (pg && PG_NAMES[pg]) || STATUS_NAMES[status] || (status >= 500 ? 'server error' : 'refused');
}

// Our own telemetry. Its failures are never reported, or one bad network
// would report itself forever.
const OWN_ROUTES = new Set(['client_errors', 'analytics_events', 'error_beacon']);

// A path segment is kept only when it is a plain lowercase word: an id, a
// token, or a file's name becomes :x.
function segment(s) {
  return /^(?:[a-z][a-z_-]{0,30}|v\d)$/.test(s) ? s : ':x';
}

// A route's first `keep` segments, each a plain word or :x, then one :x for
// whatever follows. Past the route's own words, a path holds what varies: an
// id, a link's token, or a slug made from a cluster's name, which can look as
// plain as a route word does. So a later segment is never kept, however plain.
function shape(parts, keep) {
  const head = parts.slice(0, keep).map(segment);
  if (parts.length > keep) head.push(':x');
  return head.join('/') || '/';
}

// The Party Worker's hosts (partyDefaults.js), matched by shape so this
// chunk never imports partyHost.js and the chunk that holds it.
const PARTY_HOST_RE = /^soleil-boards-party\.[a-z0-9-]+\.(?:workers|partykit)\.dev$/;

// Which of our services a URL belongs to, and its route with nothing in it
// that varies. null for anyone else's server. hosts: { app, supabase, party }.
export function routeOf(url, hosts = {}) {
  let u;
  try { u = new URL(url, hosts.app ? `https://${hosts.app}` : undefined); } catch (_) { return null; }
  const parts = u.pathname.split('/').filter(Boolean);
  if (hosts.supabase && u.host === hosts.supabase) {
    const [svc, , ...rest] = parts;
    // Table and function names are the schema's, never content.
    const named = (s) => (/^[a-z_][a-z0-9_]{0,62}$/.test(s || '') ? s : ':x');
    if (svc === 'rest' && rest[0] === 'rpc') return { svc: 'rpc', route: named(rest[1]) };
    if (svc === 'rest') return { svc: 'rest', route: named(rest[0]) };
    if (svc === 'auth') {
      // A token call says which grant it was (refresh_token, pkce…) in its
      // query: the one that tells a lost session from a sign-in.
      const grant = rest[0] === 'token' ? u.searchParams.get('grant_type') : null;
      return { svc: 'auth', route: grant ? `token/${segment(grant)}` : shape(rest, 1) };
    }
    if (svc === 'storage') return { svc: 'storage', route: shape(rest, 2) };
    if (svc === 'functions') return { svc: 'functions', route: /^[a-z][a-z0-9_-]{0,62}$/.test(rest[0] || '') ? rest[0] : ':x' };
    return { svc: 'supabase', route: shape(parts, 2) };
  }
  // A signed file read: the bucket, and never the key (a person's id and the
  // file's own name).
  if (u.host.endsWith('.r2.cloudflarestorage.com')) return { svc: 'r2', route: shape(parts, 1) };
  // The Party's routes are /parties/<party>/<room>/<action>: the room is a
  // board's or a workspace's id, the action the Party's own word or two
  // (file-save, mpu/create, sign-reads).
  if ((hosts.party && u.host === hosts.party) || PARTY_HOST_RE.test(u.host)) {
    const route = parts[0] === 'parties' && parts.length > 2
      ? ['parties', segment(parts[1]), ':x', ...parts.slice(3, 5).map(segment)].join('/')
      : shape(parts, 2);
    return { svc: 'party', route };
  }
  // The Worker's: /api/<area>/<action> (and /api/v1/<resource>/:x), a chunk
  // of the app by its name (assets/AppShell, without the build's hash), or a
  // page's first segment (/c/:x).
  if ((hosts.app && u.host === hosts.app) || /(?:^|\.)soleilpictures\.com$/.test(u.host)) {
    const chunk = parts[0] === 'assets' && parts.length === 2 && /^([A-Za-z][A-Za-z0-9_-]{0,60})-[A-Za-z0-9_-]{8}\.(?:js|css)$/.exec(parts[1]);
    if (chunk) return { svc: 'worker', route: `assets/${chunk[1]}` };
    return { svc: 'worker', route: shape(parts, parts[0] === 'api' ? 3 : 1) };
  }
  return null;
}

// Every address in a message, as its service and route ('<url>' for anyone
// else's): "Failed to fetch dynamically imported module: https://…/assets/
// AppShell-x1.js" keeps saying which chunk, and a link's key, a cluster's
// name or a search in a query goes no further.
export function scrubUrls(text, hosts = {}) {
  return String(text).replace(/\bhttps?:\/\/[^\s"'<>()[\]{}]+/g, (url) => {
    const r = routeOf(url, hosts);
    return r ? `${r.svc}/${r.route}` : '<url>';
  });
}

// The error code a failed response's body names, if it names one: PostgREST's
// SQLSTATE or PGRST code, GoTrue's error_code, Storage's error. Never the
// message or the details, which can quote the row that was refused.
export function bodyCode(text) {
  if (typeof text !== 'string' || !text || text.length > 4000) return null;
  let j;
  try { j = JSON.parse(text); } catch (_) { return null; }
  if (!j || typeof j !== 'object') return null;
  for (const v of [j.code, j.error_code, j.error]) {
    if (typeof v === 'string' && /^[A-Za-z0-9_]{2,40}$/.test(v)) return v;
  }
  return null;
}

// Where a slow answer is a problem: someone is waiting on a query or a call.
// An upload, a file or an AI step is as slow as it is big.
const SLOW_MATTERS = new Set(['rest', 'rpc', 'auth', 'functions']);

// A refresh the auth server refused: the session is gone, and the person is
// signed out without asking to be.
const SESSION_LOST = new Set(['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found',
  'session_expired', 'invalid_grant']);

// The services whose 4xx is our own bug: the app built the query, so a bad
// request, a refusal or a missing table or function is ours to fix. A 4xx from
// the Worker, the Party or Storage is mostly about what was given to it: a
// link that won't unfurl, a file over the limit, a file that was deleted.
const OURS_WHEN_REFUSED = new Set(['rest', 'rpc', 'functions']);

// What a failed request is. null when it is nobody's problem: our own
// telemetry, an abort, the browser being offline, a person's own wrong code
// (the sign-in screens say so, and analytics records it), "no rows" asked of
// .single(), or a big file being slow. Otherwise the severity and the facts.
export function classifyHttpFailure(f, hosts = {}) {
  const r = routeOf(f?.url, hosts);
  if (!r || OWN_ROUTES.has(r.route)) return null;
  if (f.aborted || (f.slow && !SLOW_MATTERS.has(r.svc))) return null;
  const status = Number(f.status) || 0;
  const online = f.online !== false;
  if (status === 0 && !online) return null;
  const pg = typeof f.pg === 'string' ? f.pg : null;
  const method = String(f.method || 'GET').toUpperCase().slice(0, 7);
  const lost = r.svc === 'auth' && r.route === 'token/refresh_token' && status >= 400 && status < 500 && SESSION_LOST.has(pg);
  let severity;
  if (f.slow) severity = 'warning';
  else if (status === 0 || status >= 500 || pg === '57014') severity = 'error';
  else if (r.svc === 'auth') {
    if (status !== 429 && !lost) return null;
    severity = 'warning';
  }
  else if (status === 406 || pg === 'PGRST116') return null;
  else if ([401, 409, 413, 429].includes(status) || ['PGRST301', 'PGRST303', '23505'].includes(pg)) severity = 'warning';
  else if (status >= 400) severity = OURS_WHEN_REFUSED.has(r.svc) ? 'error' : 'warning';
  else return null;
  // A request its caller tries again (an upload's PUT, uploadRetry.js) is a
  // warning: if the tries run out, the person's toast is the error.
  if (f.retried && severity === 'error') severity = 'warning';
  const why = f.slow ? 'slow' : f.stalled ? 'stalled' : lost ? 'session lost' : failureWords(status, pg);
  const ms = Math.round(Number(f.ms) || 0);
  return {
    severity,
    message: `${method} ${r.svc}/${r.route}: ${why}${pg ? ` (${pg})` : ''}`,
    crumb: `${method} ${r.svc}/${r.route} ${f.slow ? 'slow' : status}`,
    http: { method, svc: r.svc, route: r.route, pg, status, ms },
  };
}
