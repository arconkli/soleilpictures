// Verifying a caller's Supabase JWT at the edge.
//
// There is no local signature check here on purpose: the Worker holds the anon
// key, not the JWT secret, so the only honest way to know a token is good is to
// ask Supabase. `/auth/v1/user` answers that and returns the user in the same
// round trip.
//
// This existed twice — worker-tags.js and worker-ai.js, the latter carrying a
// comment saying it mirrored the former — and was about to exist a third time
// for /api/scout/claim. Three hand-copied implementations of "who is calling"
// is how one of them quietly stops matching the others, so it lives here now
// and the callers import it.
//
// Requires SUPABASE_URL + SUPABASE_ANON_KEY. Both are public by design (the
// anon key is gated by RLS, not by secrecy) and are already [vars] in
// wrangler.toml, so no secret is involved in authenticating a user.

// Short cache keyed on the raw token. A minute is far below the token's own
// ~1h lifetime, so a revoked session cannot linger meaningfully, and it is
// per-isolate — it only helps bursts, which is exactly the hot case.
const TOKEN_CACHE_TTL_MS = 60_000;
const _tokenCache = new Map();   // token → { userId, email, expires }

// Verify a bare token. Returns { ok:true, userId, email } or { ok:false, status, error }.
export async function verifyUserToken(env, token) {
  if (!token) return { ok: false, status: 401, error: 'missing bearer token' };
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return { ok: false, status: 500, error: 'supabase env not configured' };
  }

  const cached = _tokenCache.get(token);
  if (cached && cached.expires > Date.now()) {
    return { ok: true, userId: cached.userId, email: cached.email };
  }

  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return { ok: false, status: 401, error: 'invalid token' };
  const user = await r.json().catch(() => null);
  if (!user?.id) return { ok: false, status: 401, error: 'invalid token' };

  // Unbounded growth would be a memory leak in a long-lived isolate; the whole
  // map is cheap to rebuild, so drop it wholesale rather than tracking an LRU.
  if (_tokenCache.size > 500) _tokenCache.clear();
  _tokenCache.set(token, {
    userId: user.id, email: user.email || null, expires: Date.now() + TOKEN_CACHE_TTL_MS,
  });
  return { ok: true, userId: user.id, email: user.email || null };
}

// Same, reading the token off an Authorization: Bearer header.
export async function verifyUser(request, env) {
  const auth = request.headers.get('authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, status: 401, error: 'missing bearer token' };
  return await verifyUserToken(env, match[1]);
}
