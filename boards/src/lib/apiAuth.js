// /api/v1 — turning a personal access token into a real Supabase user session.
//
// This is the whole authorization model of the public API, so it is worth being
// explicit about what it is NOT: a token is not a capability, and the Worker
// does not decide what a token may touch. It resolves the token to a user,
// obtains that user's own session, and from then on every call to PostgREST is
// made AS THAT USER, under ordinary RLS.
//
// The consequence is the point: /api/v1 cannot do anything the person could not
// do in the browser. Board access, workspace membership, the card cap, the byte
// quota, every trigger — all of it applies without a single new check, because
// it is all the same code path the app uses. The alternative (service-role calls
// guarded by hand-written p_user_id checks) makes every new endpoint another
// chance to forget one, and forgetting is silent.
//
// The session itself is obtained the supported way — mint a magiclink
// server-side and immediately verify it — exactly as scoutDb.js does for the
// headless Yjs peer, and for the same reason recorded there: self-signing an
// HS256 JWT would be cheaper, but this project has partly moved to publishable
// keys, so the legacy shared secret may not be honored. generate_link returns
// the token to us rather than mailing it, so no email is ever sent.

import { scoutRpc, scoutSelect, scoutInsert } from './scoutDb.js';

const TIMEOUT_MS = 15_000;

// Access tokens last ~1h; re-resolving on every request would cost a PostgREST
// round trip and a possible refresh each time. Per-isolate, so it only helps
// bursts — which is what a script hitting the API actually produces.
const SESSION_TTL_MS = 5 * 60_000;
const _sessionCache = new Map();   // userId → { accessToken, expires }

// Hash the presented token the same way api_token_mint stored it. The plaintext
// never travels past this function — everything downstream takes the hash.
async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Resolve `Authorization: Bearer sk_live_…` to { userId, tokenId, scopes }.
//
// api_token_resolve does authentication, expiry, revocation, last_used and the
// rate-limit window in one statement — it runs on every request, so extra round
// trips here are paid by every caller.
export async function resolveApiToken(request, env) {
  const auth = request.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(\S+)$/i);
  if (!match) return { ok: false, status: 401, error: 'missing bearer token' };

  const presented = match[1];
  if (!presented.startsWith('sk_')) {
    return { ok: false, status: 401, error: 'invalid token' };
  }

  let rows;
  try {
    rows = await scoutRpc(env, 'api_token_resolve', { p_token_hash: await sha256Hex(presented) });
  } catch (_) {
    return { ok: false, status: 502, error: 'could not verify that token' };
  }
  const row = (Array.isArray(rows) ? rows : [rows])[0] || {};

  // The window comes back on every answer, refused or not, so the caller can
  // see what is left instead of discovering the limit by being refused. 0220
  // returns it from the UPDATE that already runs here — no extra round trip.
  const rate = {
    limit: Number(row.req_limit) || 1000,
    used: Number(row.req_count) || 0,
    reset: row.req_reset || null,
  };

  if (row.reason === 'rate_limited') {
    return { ok: false, status: 429, code: 'rate_limited', rate,
      error: 'rate limit exceeded — try again shortly' };
  }
  // unknown / revoked / expired all answer the same way. Distinguishing them
  // tells someone holding a stolen token which of their guesses was once real.
  if (!row.user_id) {
    return { ok: false, status: 401, code: 'invalid_token', rate, error: 'invalid token' };
  }

  return {
    ok: true,
    userId: row.user_id,
    tokenId: row.token_id,
    scopes: Array.isArray(row.scopes) ? row.scopes : ['read'],
    rate,
  };
}

// Headers that tell a caller where it stands. Sent on EVERY response, not just
// refusals — a client that can only learn its budget by being rejected has to
// hit the wall to find it, which is the one thing a rate limit should never
// require. `Retry-After` is seconds, per RFC 9110, and only meaningful on 429.
export function rateHeaders(rate, { retryAfter = false } = {}) {
  if (!rate) return {};
  const resetMs = rate.reset ? Date.parse(rate.reset) : NaN;
  const out = {
    'x-ratelimit-limit': String(rate.limit),
    'x-ratelimit-remaining': String(Math.max(0, rate.limit - rate.used)),
  };
  if (Number.isFinite(resetMs)) {
    out['x-ratelimit-reset'] = String(Math.floor(resetMs / 1000));
    if (retryAfter) {
      out['retry-after'] = String(Math.max(1, Math.ceil((resetMs - Date.now()) / 1000)));
    }
  }
  return out;
}

export function hasScope(auth, scope) {
  return Array.isArray(auth?.scopes) && auth.scopes.includes(scope);
}

async function refreshSession(env, refreshToken) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;      // expired or rotated away → caller re-mints
  return await res.json();
}

async function mintSession(env, email) {
  const genRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!genRes.ok) throw new Error(`generate_link ${genRes.status}`);
  const link = await genRes.json();
  const hashed = link?.hashed_token || link?.properties?.hashed_token;
  if (!hashed) throw new Error('generate_link returned no hashed_token');

  const verifyRes = await fetch(`${env.SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!verifyRes.ok) throw new Error(`verify ${verifyRes.status}`);
  return await verifyRes.json();
}

// An access token for `userId`, reusing the cached refresh token where possible.
//
// The rotated refresh token is written back to api_sessions, which is why that
// table exists: refresh tokens are single-use, so keeping the newest one is the
// difference between one magiclink per user and one per request.
export async function apiUserSession(env, userId) {
  const cached = _sessionCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.accessToken;

  const rows = await scoutSelect(
    env, 'api_sessions', `user_id=eq.${userId}&select=refresh_token`,
  ).catch(() => []);

  let session = null;
  if (rows?.[0]?.refresh_token) session = await refreshSession(env, rows[0].refresh_token);

  if (!session?.access_token) {
    const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!userRes.ok) throw new Error('could not resolve the account for that token');
    const email = (await userRes.json())?.email;
    if (!email) throw new Error('that account has no address to sign in with');
    session = await mintSession(env, email);
  }
  if (!session?.access_token) throw new Error('could not obtain a user session');

  await scoutInsert(env, 'api_sessions', [{
    user_id: userId,
    refresh_token: session.refresh_token || rows?.[0]?.refresh_token || null,
    access_token_exp: new Date(Date.now() + (session.expires_in || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }], { onConflict: 'user_id' }).catch(() => {});

  if (_sessionCache.size > 200) _sessionCache.clear();
  _sessionCache.set(userId, {
    accessToken: session.access_token,
    expires: Date.now() + SESSION_TTL_MS,
  });
  return session.access_token;
}

// ── PostgREST, as the user ───────────────────────────────────────────────────
//
// Note the anon key in `apikey` alongside the USER's bearer token: that pairing
// is what makes PostgREST evaluate RLS as this person. Passing the service key
// here would silently disable every policy and turn the API into a way to read
// anyone's boards, which is the single worst thing this file could do — so the
// service key is deliberately not reachable from these helpers.

function userHeaders(accessToken, env, extra) {
  return {
    apikey: env.SUPABASE_ANON_KEY,
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
    accept: 'application/json',
    ...(extra || {}),
  };
}

export async function userSelect(env, token, table, query) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: userHeaders(token, env),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await restError(res, `select ${table}`);
  return await res.json();
}

export async function userRpc(env, token, fn, params) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: userHeaders(token, env),
    body: JSON.stringify(params || {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await restError(res, `rpc ${fn}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function userInsert(env, token, table, rows, { returning = 'representation' } = {}) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: userHeaders(token, env, { prefer: `return=${returning}` }),
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await restError(res, `insert ${table}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function userPatch(env, token, table, query, patch) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: userHeaders(token, env, { prefer: 'return=representation' }),
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await restError(res, `patch ${table}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Turn a PostgREST failure into something safe to hand a stranger.
//
// RLS denials arrive as 401/403 and a cap hit as a trigger exception; both are
// the user's answer, not a server fault, so they keep a status the caller can
// act on rather than collapsing into a 500.
//
// WHAT CHANGED AND WHY. This used to build `"select boards 400: {…raw body…}"`
// and worker-api.js returned that message verbatim for any non-5xx — so
// constraint names, column names and internal SQL detail went straight out to
// whoever held a token. Now the raw body is kept for the log only, and the
// caller gets a curated message plus a stable `code` it can branch on.
//
// The exception is a message WE wrote. Our own RAISEs ("Demo accounts are
// limited to 100 cards…") are written for a person and are the whole reason a
// 402 is useful, so those pass through — minus Postgres's own RLS text, which
// names the table and tells the caller nothing they can use.
const RAISED_BY_US = new Set(['P0001', '42501', '22023', '54000', '53400', '23505', '23514']);

async function restError(res, what) {
  const raw = await res.text().catch(() => '');
  let body = null;
  try { body = raw ? JSON.parse(raw) : null; } catch (_) { /* HTML error page */ }
  const pgMessage = typeof body?.message === 'string' ? body.message : '';
  const pgCode = typeof body?.code === 'string' ? body.code : '';

  let status = 500;
  let code = 'upstream_error';
  let message = 'something went wrong on our end';

  if (res.status === 401 || res.status === 403) {
    status = 403; code = 'forbidden'; message = 'your account cannot do that';
  } else if (res.status === 404) {
    status = 404; code = 'not_found'; message = 'not found';
  } else if (res.status === 409) {
    status = 409; code = 'conflict'; message = 'that conflicts with something that already exists';
  } else if (res.status === 400 || res.status === 422) {
    status = 400; code = 'bad_request'; message = 'that request was not valid';
  }

  if (RAISED_BY_US.has(pgCode) && pgMessage && !/row-level security/i.test(pgMessage)) {
    message = pgMessage;
    if (/limited to \d+ cards|over[_ ]quota|storage|cap\b/i.test(pgMessage)) {
      status = 402; code = 'limit_reached';
    } else if (pgCode === '42501') {
      status = 403; code = 'forbidden';
    } else {
      status = 400; code = 'bad_request';
    }
  }

  const err = new Error(message);
  err.status = status;
  err.code = code;
  // Never returned to the caller — worker-api.js logs this and sends `message`.
  err.detail = `${what} ${res.status}: ${raw.slice(0, 300)}`;
  return err;
}
