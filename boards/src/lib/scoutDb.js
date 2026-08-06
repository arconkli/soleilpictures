// Scout — service-role Supabase access from the Worker / Durable Object.
//
// Mirrors the rpc() helper in worker.js (same headers, same error shape) but
// lives here so the Scout modules don't have to reach into the worker entry
// point. Everything in this file runs with the SERVICE ROLE key and therefore
// bypasses RLS — callers are responsible for scoping to the right user.
//
// The one thing the service key CANNOT do is talk to PartyKit: party/auth.ts
// validates the connection by calling PostgREST *as the user*, so a headless
// Yjs peer needs a genuine user JWT. That's what scoutSession() is for.

const TIMEOUT_MS = 15_000;

function svcHeaders(env, extra) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'content-type': 'application/json',
    accept: 'application/json',
    ...(extra || {}),
  };
}

export async function scoutRpc(env, fn, params, timeoutMs = TIMEOUT_MS) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: svcHeaders(env),
    body: JSON.stringify(params || {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`rpc ${fn} ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// PostgREST select. `query` is a raw querystring, e.g. "id=eq.x&select=*".
export async function scoutSelect(env, table, query, timeoutMs = TIMEOUT_MS) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: svcHeaders(env),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`select ${table} ${res.status}: ${text.slice(0, 300)}`);
  }
  return await res.json();
}

// PostgREST insert / upsert. Pass `onConflict` to upsert.
export async function scoutInsert(env, table, rows, { onConflict = null, returning = 'minimal' } = {}) {
  const qs = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
  const prefer = [
    onConflict ? 'resolution=merge-duplicates' : null,
    `return=${returning}`,
  ].filter(Boolean).join(',');
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${qs}`, {
    method: 'POST',
    headers: svcHeaders(env, { prefer }),
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`insert ${table} ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.body = text;
    // The demo-cap trigger raises 42501 — surface it so the caller can turn it
    // into the paywall reply instead of a generic failure. (0187)
    err.isCapHit = text.includes('42501') || /limited to \d+ cards/i.test(text);
    throw err;
  }
  if (returning === 'minimal') return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// PostgREST update. `query` is a raw filter querystring.
//
// This is how a card MOVES between boards, and the choice of verb is load-
// bearing: every trigger on card_index fires on INSERT or DELETE only (the
// demo cap 0091:485, the cached counters 0065:291 and 0074:140, the first-card
// activation signal 0080:77). Moving with UPDATE therefore consumes no cap,
// double-counts nothing, and emits no false activation event — where a
// delete-then-insert would trip all four, and would hard-fail for a user
// sitting exactly at their 100-card wall.
export async function scoutPatch(env, table, query, patch) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: svcHeaders(env, { prefer: 'return=minimal' }),
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`patch ${table} ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return true;
}

export async function scoutDelete(env, table, query) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'DELETE',
    headers: svcHeaders(env, { prefer: 'return=minimal' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`delete ${table} ${res.status}: ${text.slice(0, 300)}`);
  }
  return true;
}

// ── Auth admin ───────────────────────────────────────────────────────────────
// auth.admin.createUser over REST. Used to mint the shell account behind a chat
// handle. `email_confirm: true` so the account is immediately usable — the user
// never sees this address; it's replaced when they attach a real one.
export async function scoutCreateUser(env, { email, metadata = {} }) {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: svcHeaders(env),
    body: JSON.stringify({ email, email_confirm: true, user_metadata: metadata }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`createUser ${res.status}: ${text.slice(0, 300)}`);
  }
  return await res.json();
}

// Look up an auth user by email. Used by the claim-on-match path: if someone
// attaches an email that already has a Soleil account, we move their Scout
// board over rather than stranding it on the shell account.
export async function scoutFindUserByEmail(env, email) {
  const res = await fetch(
    `${env.SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
    { headers: svcHeaders(env), signal: AbortSignal.timeout(TIMEOUT_MS) },
  );
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  const users = body?.users || [];
  const lower = String(email).toLowerCase();
  return users.find((u) => String(u.email || '').toLowerCase() === lower) || null;
}

// ── User sessions (for the headless Yjs peer) ────────────────────────────────
//
// PartyKit authenticates by calling PostgREST with the caller's token and
// letting RLS decide (party/auth.ts:95). The service key is useless there, so
// Scout needs a real user session. We get one the supported way — mint a
// magiclink server-side and immediately verify it — then cache the refresh
// token in scout_accounts and rotate it thereafter.
//
// Deliberately NOT self-signing an HS256 JWT: this project has partly migrated
// to the new publishable-key system (party/auth.ts:20 carries an sb_publishable_
// key), so the legacy shared secret may not be honored. This path uses only
// documented endpoints and works either way.

async function mintSessionViaMagiclink(env, email) {
  const genRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: svcHeaders(env),
    body: JSON.stringify({ type: 'magiclink', email }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!genRes.ok) {
    const text = await genRes.text().catch(() => '');
    throw new Error(`generate_link ${genRes.status}: ${text.slice(0, 200)}`);
  }
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
  if (!verifyRes.ok) {
    const text = await verifyRes.text().catch(() => '');
    throw new Error(`verify ${verifyRes.status}: ${text.slice(0, 200)}`);
  }
  return await verifyRes.json();   // { access_token, refresh_token, expires_in, ... }
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
  if (!res.ok) return null;   // expired / revoked → caller re-mints
  return await res.json();
}

// Return a usable access token for `userId`, reusing the cached refresh token
// when possible. Writes the rotated token back to scout_accounts.
export async function scoutSession(env, userId, email) {
  const rows = await scoutSelect(
    env, 'scout_accounts',
    `user_id=eq.${userId}&select=refresh_token,access_token_exp`,
  ).catch(() => []);
  const cached = rows?.[0];

  let session = null;
  if (cached?.refresh_token) {
    session = await refreshSession(env, cached.refresh_token);
  }
  if (!session?.access_token) {
    session = await mintSessionViaMagiclink(env, email);
  }
  if (!session?.access_token) throw new Error('could not obtain a user session');

  const exp = new Date(Date.now() + (session.expires_in || 3600) * 1000).toISOString();
  await scoutInsert(env, 'scout_accounts', [{
    user_id: userId,
    refresh_token: session.refresh_token || cached?.refresh_token || null,
    access_token_exp: exp,
    updated_at: new Date().toISOString(),
  }], { onConflict: 'user_id' }).catch(() => {});

  return session.access_token;
}
