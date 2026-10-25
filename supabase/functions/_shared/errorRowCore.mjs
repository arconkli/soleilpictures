// errorRowCore.mjs — an edge function's failure, as a client_errors row.
// Pure, so node tests it (boards/src/lib/edgeErrors.test.mjs); reportError.ts
// writes it, with the service role, which 0580's insert policy requires of
// every source but the browser's. Admin, Errors lists the rows under Servers
// (0582).
//
// The servers' rules, as boards/src/lib/serverErrors.js keeps them for the
// Worker and the Party: never content. A database error is said by its code,
// never its message or details, which quote the row they refused ("Key
// (email)=(…) already exists"); a Stripe error by its type, code, status and
// the parameter it names, never its message, which can name the customer or
// the card; an auth error by its code; anything else loses its addresses,
// emails, anything quoted and anything token-shaped. Nothing is read from a
// request but its method. No user agent and no account: 0581 counts a
// function's failures, never people.
//
// A row's kind is the function's name: 0581's payments rule reads
// create-checkout-session, verify-checkout-session, stripe-webhook,
// storage-addon and team-billing by it. A card declined is the person's own
// (a warning, which no rule counts); a Stripe call we got wrong, Stripe
// failing or our keys refused is ours.
//
// Bounded per isolate: the same failure once a minute, 30 rows a minute at
// most. Shorter than the Worker's five minutes: an edge isolate lives minutes,
// and 0581 emails payments at two failures in an hour, which a five-minute
// window could hold to one.

const REPEAT_MS = 60_000;
const PER_MINUTE = 30;

// The same words as boards/src/lib/errorCore.js (failureWords), so a failure
// reads alike from every source. edgeErrors.test.mjs holds them to it.
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
export function failureWords(status, pg) {
  return (pg && PG_NAMES[pg]) || STATUS_NAMES[status] || (status >= 500 ? 'server error' : 'refused');
}

const SEVERITIES = new Set(['crash', 'error', 'warning']);
const PG_CODE = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/;
const NAMED = /^[A-Za-z0-9_.-]{1,60}$/;

// Hosts a failure may name: whose server it was, never the address.
function hostWord(host) {
  const h = String(host || '').toLowerCase();
  if (h === 'api.stripe.com' || h.endsWith('.stripe.com')) return 'stripe';
  if (h.endsWith('.supabase.co') || h.endsWith('.supabase.in')) return 'supabase';
  if (h === 'api.resend.com') return 'resend';
  if (h.endsWith('.googleapis.com')) return 'google';
  if (h.endsWith('.facebook.com')) return 'meta';
  if (h.endsWith('soleilpictures.com') || h.endsWith('.workers.dev')) return 'clusters';
  return null;
}

// What a message may say.
export function scrubEdgeText(text) {
  return String(text ?? '')
    .replace(/\bhttps?:\/\/([^/\s"'<>()[\]{}]+)[^\s"'<>()[\]{}]*/g, (_, host) => `<${hostWord(host) || 'url'}>`)
    .replace(/[^\s@"'<>()[\]{},;:]+@[^\s@"'<>()[\]{},;:]+\.[a-z]{2,}/gi, '<email>')
    .replace(/"[^"\n]{1,400}"/g, '"…"')
    .replace(/\b(?:cus|sub|pi|ch|in|cs|si|pm|seti|evt|prod|price|promo|re|txn|ii|il)_[A-Za-z0-9]{6,}\b/g, '<stripe id>')
    .replace(/[A-Za-z0-9_-]{32,}/g, '<token>');
}

const clamp = (s, n) => (s == null || s === '' ? null : String(s).slice(0, n));
const named = (s) => (typeof s === 'string' && NAMED.test(s) ? s : null);

// What was thrown, in words, how bad, and the code it carries.
export function describeEdgeError(e) {
  if (e == null) return { words: null, code: null, severity: null, name: null };
  const name = typeof e?.name === 'string' ? e.name : null;
  if (name === 'TimeoutError' || name === 'AbortError') return { words: 'timed out', code: null, severity: null, name };

  // Stripe's: type, code, status, the parameter. A decline is the person's.
  const type = named(e?.type);
  if (type && /^Stripe[A-Za-z]*Error$/.test(type)) {
    const code = named(e?.code) || named(e?.decline_code);
    const status = Number.isInteger(e?.statusCode) ? e.statusCode : null;
    const param = named(e?.param);
    const sort = type.replace(/^Stripe/, '').replace(/Error$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    const words = ['stripe', `${sort || 'unknown'} error`, code, status, param && `(${param})`].filter(Boolean).join(' ');
    return { words, code, severity: type === 'StripeCardError' ? 'warning' : null, name: type };
  }

  // The database's: what supabase-js answers with ({ message, details, hint,
  // code }, or a PostgrestError). An Error that merely carries a code (a
  // socket's EPIPE) is not one.
  const code = typeof e?.code === 'string' ? e.code : null;
  if (code && PG_CODE.test(code) && (name === 'PostgrestError' || 'details' in e || 'hint' in e || !(e instanceof Error))) {
    return { words: `${PG_NAMES[code] || 'database error'} (${code})`, code, severity: null, name: 'PostgrestError' };
  }

  // Auth's (AuthApiError and kin): its code and status.
  if (name && /^Auth[A-Za-z]*Error$/.test(name)) {
    const status = Number.isInteger(e?.status) ? e.status : null;
    return { words: ['auth', named(e?.code) || failureWords(status ?? 500), status].filter(Boolean).join(' '),
      code: named(e?.code), severity: null, name };
  }

  const raw = typeof e === 'string' ? e : (typeof e?.message === 'string' ? e.message : '');
  const words = scrubEdgeText(raw).trim().slice(0, 200) || (name && name !== 'Error' ? name : null);
  return { words, code: null, severity: null, name };
}

export function makeEdgeErrorState() {
  return { seen: new Map(), minute: 0, count: 0 };
}

// The row for one failure in the function `fn`, or null when it was written
// in the last minute, or this isolate has written its 30 this minute.
//
//   error    what was thrown, or the { error } a call answered with
//   what     what failed ("insert discount_redemptions", "mirror
//            subscription"): it leads the message, and is the context's tag
//   status   the answer the function gave, for a request; ms, phase, op, code
//   request  the Request, for its method alone
//   severity overrides what the error says (a decline is a warning)
export function edgeErrorRow(fn, info, state, now = Date.now()) {
  const kind = typeof fn === 'string' && /^[a-z][a-z0-9-]{1,39}$/.test(fn) ? fn : null;
  if (!kind || !info) return null;
  const e = info.error;
  const d = describeEdgeError(e);
  const status = Number.isInteger(info.status) ? info.status : null;
  const method = typeof info.request?.method === 'string' ? info.request.method : null;
  const what = clamp(info.what, 60);
  // A 5xx answered with nothing handed over says only that: 0580 groups by
  // the message, and the function's name is the kind already.
  const said = d.words || (status ? `answered ${status}: ${failureWords(status)}` : 'failed');
  const message = (what ? `${what}: ${said}` : said).slice(0, 300);

  // A stack's first line is its message again: replaced, and only its frames
  // kept (a database error has none worth keeping).
  let stack = null;
  if (d.name !== 'PostgrestError' && typeof e?.stack === 'string') {
    const frames = e.stack.split('\n').filter((l) => /^\s+at /.test(l)).slice(0, 12);
    if (frames.length) stack = scrubEdgeText([`${d.name || 'Error'}: ${message}`, ...frames].join('\n'));
  }

  // A number is the same failure, in the message or in where it was thrown.
  const key = `${kind}|${message}|${(stack || '').split('\n')[1] || ''}`.replace(/\d+/g, '#');
  if (state.seen.has(key) && state.seen.get(key) > now - REPEAT_MS) return null;
  const minute = Math.floor(now / 60_000);
  if (state.minute !== minute) { state.minute = minute; state.count = 0; }
  if (state.count >= PER_MINUTE) return null;
  state.count += 1;
  if (state.seen.size > 500) state.seen.clear();
  state.seen.set(key, now);

  const severity = SEVERITIES.has(info.severity) ? info.severity : (d.severity || 'error');
  const context = {
    op: clamp(info.op, 80) || kind,
    code: clamp(info.code, 80) || d.code || undefined,
    phase: clamp(info.phase, 80) || undefined,
    tag: what || undefined,
    ms: Number.isFinite(info.ms) ? Math.round(info.ms) : undefined,
    http: status || method ? { method: method || undefined, svc: 'functions', route: kind, status: status || undefined } : undefined,
  };
  for (const k of Object.keys(context)) if (context[k] === undefined) delete context[k];
  if (context.http) for (const k of Object.keys(context.http)) if (context.http[k] === undefined) delete context.http[k];
  return {
    source: 'edge',
    kind,
    severity,
    name: clamp(d.name, 80),
    message,
    stack: clamp(stack, 4000),
    path: `/functions/v1/${kind}`,
    release: null,
    env: 'prod',
    user_agent: null,
    context,
  };
}
