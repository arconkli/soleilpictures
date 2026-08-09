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

import { scoutRpc } from './scoutDb.js';

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
    // Set only by api_token_mint_for, so it is exactly "this is a machine,
    // confined to this workspace". A human's token has no workspace and is
    // bounded only by what that person can reach.
    workspaceId: row.workspace_id || null,
    serviceAccount: !!row.workspace_id,
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

// Mint a brand-new session for a user, from their address.
//
// Safe to call concurrently: each magiclink verify creates a SEPARATE session
// with its own refresh-token family, so two of these race harmlessly. It is
// reusing ONE refresh token twice that is dangerous — see apiUserSession.
async function freshSession(env, userId) {
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
  return await mintSession(env, email);
}

// The auth identity behind a service account.
//
// A service account has to be a REAL auth.users row, and that is the whole
// design: because it is a real user it can hold a workspace_members row, and
// because it holds one, every predicate that already exists — can_read_board,
// can_write_board, can_write_workspace — applies to it unchanged. There is no
// second authorization path to keep in step, and nothing runs as the service
// role on its behalf.
//
// It cannot be created in Postgres. generate_link (which is how every session
// in this file is minted) needs a confirmed address, and service_account_register
// runs as the calling human, who has no business writing to auth.users. So the
// identity is created here and registered in one RPC immediately afterwards.
//
// The address is real-looking but undeliverable on purpose: `email_confirm`
// means no mail is ever sent, and nothing about a machine identity should ever
// arrive in a person's inbox.
export async function createServiceAuthUser(env, { label } = {}) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('service accounts need SUPABASE_SERVICE_ROLE_KEY');
  }
  const email = `svc+${crypto.randomUUID()}@service.soleilpictures.com`;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      email,
      email_confirm: true,
      user_metadata: { service_account: true, label: String(label || '').slice(0, 80) },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const e = new Error('could not create the service identity');
    e.detail = `admin/users ${res.status}: ${detail.slice(0, 300)}`;
    throw e;
  }
  const user = await res.json();
  if (!user?.id) throw new Error('admin/users returned no id');
  return { userId: user.id, email };
}

// Undo createServiceAuthUser. Only used when registration fails after the
// identity was made — an orphaned auth user that is a member of nothing is
// harmless, but it is still litter, and it would count as a signup.
export async function deleteAuthUser(env, userId) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !userId) return false;
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => null);
  return !!res?.ok;
}

function cacheSession(userId, accessToken) {
  if (_sessionCache.size > 200) _sessionCache.clear();
  _sessionCache.set(userId, { accessToken, expires: Date.now() + SESSION_TTL_MS });
  return accessToken;
}

const nap = (ms) => new Promise((r) => setTimeout(r, ms));

// An access token for `userId`. ONE refresh per user per hour, at any
// concurrency.
//
// WHAT THIS USED TO DO AND WHY IT DOES NOT SCALE. api_sessions holds a single
// refresh token per user, and the only cache was `_sessionCache` — which is
// per ISOLATE. Cloudflare spreads a burst across many isolates, so a client
// opening 32 parallel connections produced 32 cold isolates that all read the
// SAME refresh token and all tried to rotate it. Refresh tokens are single-use:
// one wins, the other 31 fall back to minting a magiclink (two admin API calls
// each), and Supabase's refresh-token REUSE DETECTION can respond to the
// collision by revoking the entire family — which in this project has already
// meant every user of an account being thrown back to an OTP prompt. A bulk
// migration is exactly the traffic shape that triggers it, continuously.
//
// So the durable cache moved into Postgres next to the refresh token, and
// api_session_begin (0221) hands out either a live access token or the
// exclusive right to go and get one. The per-isolate cache stays in front of it
// because it still absorbs the common burst without any round trip at all.
export async function apiUserSession(env, userId) {
  const cached = _sessionCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.accessToken;

  for (let attempt = 0; attempt < 3; attempt++) {
    const rows = await scoutRpc(env, 'api_session_begin', { p_user_id: userId, p_skew: 120 })
      .catch(() => null);
    const s = (Array.isArray(rows) ? rows : [rows])?.[0] || {};

    // Somebody already did the work and it is still good.
    if (s.access_token) return cacheSession(userId, s.access_token);

    if (s.claimed) {
      try {
        // We hold the claim, so we are the only caller that may rotate this
        // refresh token. Fall back to a fresh mint when it has expired or been
        // rotated away.
        let session = s.refresh_token ? await refreshSession(env, s.refresh_token) : null;
        if (!session?.access_token) session = await freshSession(env, userId);
        if (!session?.access_token) throw new Error('could not obtain a user session');

        await scoutRpc(env, 'api_session_store', {
          p_user_id: userId,
          p_access_token: session.access_token,
          p_refresh_token: session.refresh_token || null,
          p_expires_in: session.expires_in || 3600,
        }).catch(() => { /* the token is still usable; the next caller re-mints */ });

        return cacheSession(userId, session.access_token);
      } catch (e) {
        // Hand the claim back rather than making every other caller wait out
        // the full 20s window for a refresh that already failed.
        await scoutRpc(env, 'api_session_release', { p_user_id: userId }).catch(() => {});
        throw e;
      }
    }

    // Another caller holds the claim. Give it a moment — it is about to publish
    // a token that this request can use.
    await nap(200 * (attempt + 1));
  }

  // The claim holder is slow or died. Mint our own rather than fail the
  // request: a fresh magiclink is its own session, so it cannot collide with
  // whatever they are doing. Deliberately NOT reusing the stored refresh token
  // here — that is the collision this whole function exists to avoid.
  const session = await freshSession(env, userId);
  if (!session?.access_token) throw new Error('could not obtain a user session');
  await scoutRpc(env, 'api_session_store', {
    p_user_id: userId,
    p_access_token: session.access_token,
    p_refresh_token: session.refresh_token || null,
    p_expires_in: session.expires_in || 3600,
  }).catch(() => {});
  return cacheSession(userId, session.access_token);
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

// `onConflict` names the unique constraint to upsert on, and turns this into
// INSERT … ON CONFLICT DO UPDATE. Still one statement and still under RLS: the
// policy's USING clause governs the update half, so an upsert cannot reach a row
// the caller could not have written directly.
export async function userInsert(env, token, table, rows,
  { returning = 'representation', onConflict = null } = {}) {
  const qs = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  const prefer = onConflict
    ? `return=${returning},resolution=merge-duplicates`
    : `return=${returning}`;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${qs}`, {
    method: 'POST',
    headers: userHeaders(token, env, { prefer }),
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await restError(res, `insert ${table}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// DELETE as the user. Separate from scoutDelete (lib/scoutDb.js), which runs as
// the service role — this one is subject to the table's RLS policy, which is the
// only acceptable way to remove a row on someone's behalf.
export async function userDelete(env, token, table, query) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'DELETE',
    headers: userHeaders(token, env, { prefer: 'return=minimal' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw await restError(res, `delete ${table}`);
  return true;
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

// THE single place a PostgREST failure becomes an answer.
//
// It has to be shared, because the API reaches Postgres two different ways and
// the second one used to bypass this entirely:
//
//   · AS THE USER   — userSelect/userRpc/userInsert/userPatch, here in this file.
//   · AS THE SERVICE ROLE — lib/scoutDb.js, used by every card mutation, because
//     cards live in a Y.Doc and the triple write cannot run under RLS.
//
// scoutDb throws its own shape (`insert card_index 403: {…raw body…}` with
// err.body), and worker-api.js returned e.message verbatim for any 4xx. So the
// single most common failure in the whole product — hitting the card cap —
// answered with the raw PostgREST envelope, the table name and the SQLSTATE,
// under status 403 and code `bad_request`, while the documentation promised
// 402 `limit_reached`. Fixing it in one path and not the other is how that
// happened; hence one function, called from both.
export function describeUpstreamError(httpStatus, rawBody) {
  let body = null;
  try { body = rawBody ? JSON.parse(rawBody) : null; } catch (_) { /* not JSON */ }
  const pgMessage = typeof body?.message === 'string' ? body.message : '';
  const pgCode = typeof body?.code === 'string' ? body.code : '';

  // A non-JSON body is not Postgres answering — it is something in front of it.
  // Supabase sits behind Cloudflare, whose WAF returns an HTML block page for a
  // query string that looks like SQL injection (`or 1=1 --`). Reporting that as
  // "your account cannot do that" sends someone to debug permissions that are
  // fine, so it gets a status and a code that point outward instead.
  if (rawBody && !body && /^\s*<(!doctype|html)/i.test(rawBody)) {
    return {
      status: 502,
      code: 'upstream_rejected',
      message: 'that request was rejected before it reached the database — try rewording it',
    };
  }

  let status = 500;
  let code = 'upstream_error';
  let message = 'something went wrong on our end';

  if (httpStatus === 401 || httpStatus === 403) {
    status = 403; code = 'forbidden'; message = 'your account cannot do that';
  } else if (httpStatus === 404) {
    status = 404; code = 'not_found'; message = 'not found';
  } else if (httpStatus === 409) {
    status = 409; code = 'conflict'; message = 'that conflicts with something that already exists';
  } else if (httpStatus === 400 || httpStatus === 422) {
    status = 400; code = 'bad_request'; message = 'that request was not valid';
  }

  // A message WE wrote. Our own RAISEs ("Demo accounts are limited to 100
  // cards…") are written for a person and are the whole reason a 402 is useful,
  // so those pass through — minus Postgres's own RLS text, which names the
  // table and tells the caller nothing they can act on.
  if (RAISED_BY_US.has(pgCode) && pgMessage && !/row-level security/i.test(pgMessage)) {
    message = pgMessage;
    if (/limited to \d+ cards|over[_ ]quota|quota|storage|\bcap\b/i.test(pgMessage)) {
      status = 402; code = 'limit_reached';
    } else if (pgCode === '42501') {
      status = 403; code = 'forbidden';
    } else if (pgCode === '23505' && /object_identifiers/.test(pgMessage)) {
      // Two things racing for one identifier. The unique index is the guard the
      // upsert path relies on, so a caller hitting it needs the same code it
      // would have got from the check, not a constraint name it cannot act on.
      status = 409; code = 'identifier_conflict';
      message = 'that identifier already belongs to another object in this workspace';
    } else {
      status = 400; code = 'bad_request';
    }
  }

  return { status, code, message };
}

// Any error on its way out of a route, made safe to hand a stranger.
//
// Errors arrive in three shapes and only the first is already curated:
//   1. fail(status, code, message) from worker-api.js — ours, deliberate, clean.
//   2. a scoutDb throw carrying .body — raw PostgREST text.
//   3. anything else — a bug, a timeout, a parse failure.
// Nothing that has not been through here should ever reach a response body.
export function normalizeApiError(e) {
  if (e?.code && e?.status) return { status: e.status, code: e.code, message: e.message };
  if (typeof e?.body === 'string') return describeUpstreamError(e.status || 500, e.body);
  return { status: e?.status || 500, code: 'internal_error', message: 'something went wrong on our end' };
}

async function restError(res, what) {
  const raw = await res.text().catch(() => '');
  const { status, code, message } = describeUpstreamError(res.status, raw);
  const err = new Error(message);
  err.status = status;
  err.code = code;
  // Never returned to the caller — worker-api.js logs this and sends `message`.
  err.detail = `${what} ${res.status}: ${raw.slice(0, 300)}`;
  return err;
}
