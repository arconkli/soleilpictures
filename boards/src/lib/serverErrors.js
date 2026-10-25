// serverErrors.js — a failure on our own servers, as a client_errors row.
//
// errorReporting.js is the browser's half. This is the servers': the Worker's
// route catch and its unguarded tail, /api/v1's 5xx, every cron and background
// job, and a public page served without data it asked for; the Party Worker
// builds its rows here too. Rows are written with the service role, because
// 0580's insert policy lets anon write only source 'client', and 0580's trigger
// shapes and fingerprints them like any other row, so Admin, Errors lists them
// under Servers (0582).
//
// Never content, as errorCore.js: a route is its template (routeOf); a failed
// database call is said as what was called, its status and the code its body
// names, never the body, which can quote the row it refused; any other message
// or stack loses its addresses, emails, anything token-shaped and anything
// quoted (a JSON parse error quotes what it was given). Nothing is read from a
// request but its method, host and path. No user agent: a crawler that finds a
// broken route has found it for everyone, and 0582 hides rows with a crawler's
// agent.
//
// Bounded per isolate: the same failure is written once per five minutes, and
// an isolate writes at most 30 rows a minute, so a route failing under load
// cannot flood the table. 0580's per-fingerprint cap is the second fence.
//
// Pure apart from reportServerError's fetch: serverErrors.test.mjs.

import { errorContext, routeOf, scrubUrls, dedupeKey, failureWords } from './errorCore.js';

export const SERVER_SOURCES = Object.freeze(['worker', 'party']);
const SEVERITIES = new Set(['crash', 'error', 'warning']);
const REPEAT_MS = 5 * 60_000;
const PER_MINUTE = 30;
const WRITE_TIMEOUT_MS = 5_000;

// Which deployment answered: a workers.dev host is a preview version (or the
// Party Worker, whose only host is one), a local host is wrangler dev, and
// anything else is production. A cron has no request and only ever runs on the
// deployed version, so no host is production too.
export function serverEnv(hostname, { workersDevIsProd = false } = {}) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return 'prod';
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost')) return 'dev';
  if (h.endsWith('.workers.dev')) return workersDevIsProd ? 'prod' : 'preview';
  return 'prod';
}

// What a message or a stack may say.
export function scrubServerText(text, hosts = {}) {
  return scrubUrls(String(text ?? ''), hosts)
    .replace(/[^\s@"'<>()[\]{},;:]+@[^\s@"'<>()[\]{},;:]+\.[a-z]{2,}/gi, '<email>')
    .replace(/"[^"\n]{1,400}"/g, '"…"')
    .replace(/[A-Za-z0-9_-]{32,}/g, '<token>');
}

// "rpc get_share_meta 503: {…}", the shape the Worker's database helpers and
// scoutDb.js throw ("select boards 400: …", "createUser 500: …"): what was
// called, its status, and the code its body names (PostgREST's SQLSTATE or
// PGRST code, GoTrue's error_code). The rest of the body is never read.
const CALL_RE = /^([A-Za-z_]{2,30}(?: [a-z_][a-z0-9_]{0,62})?) ([1-5]\d\d): ?([\s\S]*)$/;
export function failedCall(text) {
  const m = CALL_RE.exec(String(text ?? ''));
  if (!m) return null;
  const c = /"(?:code|error_code)"\s*:\s*"([A-Za-z0-9_]{2,40})"/.exec(m[3]);
  return { what: m[1], status: Number(m[2]), code: c ? c[1] : null };
}
const callWords = (f) => `${failureWords(f.status, f.code)}${f.code ? ` (${f.code})` : ''}`;

// SQLSTATEs that are the database answering what it was asked: a function's
// own raise (P0001, and P0002, which PostgREST answers with a 500: a revoked
// link, an unpublished board), input from the URL that isn't valid (22xxx: a
// malformed id), or no row. bundleRefusal.js reads the same codes for the
// party's answer; this asks only whether we have something to fix.
const ANSWERED = /^(?:P0\d{3}|22[0-9A-Z]{3}|PGRST116)$/;

// Whether a failed read is ours to fix: a timeout, a network failure, a
// database or a gateway failing, a function missing or refused to anon (a
// migration's grants). Never the database's answer: the page falls back by
// design. The status alone decides nothing.
export function isOurFailure(e) {
  const name = e?.name || '';
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  const f = failedCall(e?.message);
  return !(f?.code && ANSWERED.test(f.code));
}

// A failed read, in a few words: "timed out", "statement timeout (57014)",
// "unavailable", or a network failure's own (scrubbed) words.
function readFailure(e, hosts) {
  const name = e?.name || '';
  if (name === 'TimeoutError' || name === 'AbortError') return 'timed out';
  const f = failedCall(e?.message);
  if (f) return callWords(f);
  return scrubServerText(e?.message ?? '', hosts).trim().slice(0, 120) || (name && name !== 'Error' ? name : 'failed');
}

// What a thrown error says: a failed call by what was called and why, anything
// else scrubbed.
function errorWords(raw, hosts) {
  const f = failedCall(raw);
  return f ? `${f.what}: ${callWords(f)}` : scrubServerText(raw, hosts).trim();
}

export function makeServerErrorState() {
  return { seen: new Map(), minute: 0, count: 0 };
}

const clamp = (s, n) => (s == null || s === '' ? null : String(s).slice(0, n));

// The row for one server failure, or null when the same failure was written in
// the last five minutes, or this isolate has written its 30 this minute.
//
//   source   'worker' | 'party'
//   kind     route (a request threw) | api (/api/v1 answered 5xx) | job (a
//            cron or background job failed) | degraded (a page went out
//            without a read it asked for) | the Party's own words
//   error    what was thrown
//   request  the Request it happened on, for its method, host and route
//   status, code, ms, phase, op, attempt   what the context says
//   job      a job's name; what  what failed (a degraded read, a room's step),
//            which the message leads with
//   boardId  the board a room's failure is about: its id, never its name
export function serverErrorRow(info, state, now = Date.now()) {
  if (!info || !SERVER_SOURCES.includes(info.source)) return null;
  const kind = String(info.kind || 'error').slice(0, 40);
  const e = info.error;
  let url = null;
  try { url = info.request?.url ? new URL(info.request.url) : null; } catch (_) { url = null; }
  const hosts = { app: url?.host, supabase: info.supabaseHost, party: info.partyHost };
  const where = url ? routeOf(url.href, hosts) : null;
  const route = where?.route || null;
  // /api/v1 curates what it tells the caller (normalizeApiError) and keeps
  // what failed in .detail.
  const raw = String((kind === 'api' && typeof e?.detail === 'string' && e.detail)
    || e?.message || (typeof e === 'string' ? e : ''));
  const call = failedCall(raw);

  const method = info.request?.method;
  // A 5xx answered with nothing thrown says its route: 0580 groups by the
  // message, and "server error" alone would put every route in one group.
  const answered = `${method || 'GET'} ${route ? `/${route}` : 'a request'}: ${failureWords(Number(info.status) || 500)}`;
  let message;
  if (kind === 'degraded') message = `${info.what || 'a read'}: ${readFailure(e, hosts)}`;
  else {
    const head = kind === 'job' ? (info.job || 'job') : info.what;
    const said = errorWords(raw, hosts);
    message = head ? `${head}: ${said || 'failed'}` : (said || answered);
  }
  message = message.slice(0, 300);
  // A stack's first line is its message again, body and all: it is replaced
  // by the row's own, and only the frames are kept.
  let stack = null;
  if (kind !== 'degraded' && typeof e?.stack === 'string') {
    const frames = e.stack.split('\n').filter((l) => /^\s+at /.test(l));
    if (frames.length) stack = scrubServerText([`${e?.name || 'Error'}: ${message}`, ...frames].join('\n'), hosts);
  }

  // Once per five minutes, the same failure on the same route.
  const key = `${info.source}|${route || ''}|${dedupeKey(kind, message, stack)}`;
  if (state.seen.has(key) && state.seen.get(key) > now - REPEAT_MS) return null;
  const minute = Math.floor(now / 60_000);
  if (state.minute !== minute) { state.minute = minute; state.count = 0; }
  if (state.count >= PER_MINUTE) return null;
  state.count += 1;
  if (state.seen.size > 500) state.seen.clear();
  state.seen.set(key, now);

  const http = route || info.status != null
    ? { method, svc: where?.svc || info.source, route, status: info.status, ms: info.ms }
    : null;
  return {
    source: info.source,
    kind,
    severity: SEVERITIES.has(info.severity) ? info.severity : (kind === 'degraded' ? 'warning' : 'error'),
    name: clamp(kind === 'degraded' ? null : e?.name, 80),
    message,
    stack: clamp(stack, 4000),
    path: route ? (route === '/' ? '/' : `/${route}`) : null,
    release: clamp(info.release, 40),
    env: url ? serverEnv(url.hostname, { workersDevIsProd: info.source === 'party' }) : 'prod',
    user_agent: null,
    context: errorContext({
      op: info.op || kind,
      code: info.code || call?.code,
      phase: info.phase,
      tag: info.job || info.what,
      board_id: info.boardId,
      attempt: info.attempt,
      ms: info.ms,
      http,
    }),
  };
}

const STATE = makeServerErrorState();

// What a guard caught, for the 5xx it answered with: the Worker's and the
// Party's front doors record every 5xx once, and add the error when a guard
// left one here. Keyed by the Request, which every handler is handed as it
// came in.
const CAUGHT = new WeakMap();
export function answeredWith(request, error, extra) {
  if (request && typeof request === 'object') CAUGHT.set(request, { error, ...extra });
}
export function answerOf(request) {
  return (request && typeof request === 'object' && CAUGHT.get(request)) || {};
}

// Write one failure, in ctx.waitUntil when there is a ctx; the promise is
// returned for a caller with none (a cron job) to wait on. Never throws, never
// rejects, and gives up on the write after five seconds: recording a failure
// must not be what fails a request, or what holds one open.
export function reportServerError(env, ctx, info) {
  try {
    let supabaseHost;
    try { supabaseHost = new URL(env?.SUPABASE_URL).host; } catch (_) { supabaseHost = undefined; }
    if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) return Promise.resolve();
    const row = serverErrorRow({ supabaseHost, ...info }, STATE);
    if (!row) return Promise.resolve();
    const p = fetch(`${env.SUPABASE_URL}/rest/v1/client_errors`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
        prefer: 'return=minimal',
      },
      body: JSON.stringify([row]),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    }).then(() => {}, () => {});
    if (ctx?.waitUntil) ctx.waitUntil(p);
    return p;
  } catch (_) {
    return Promise.resolve();
  }
}

// A background job, watched: a rejection becomes a row, then is thrown on, so
// the Workers log keeps it as before. A job that catches its own failure (so
// the rest of its run goes on) reports it there instead, and waits for the
// write, since a cron has no ctx to keep it alive past the job's end.
export function watchJob(env, ctx, job, promise, { source = 'worker', release, report = reportServerError } = {}) {
  return Promise.resolve(promise).catch((error) => {
    report(env, ctx, { source, kind: 'job', job, error, release });
    throw error;
  });
}
