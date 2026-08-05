// Soleil Scout — the edge half.
//
// The bot itself is a Node service (scout/), because Photon's iMessage provider
// speaks gRPC and spawns subprocesses. What stays here is the one thing that
// genuinely belongs at the edge: turning a signed link texted to someone's
// phone into a real browser session.
//
// THE PROBLEM THIS SOLVES
// A first-time Scout user has a real Soleil account — minted behind them when
// they texted — but has never seen a login screen and has no email they'd
// recognise. Tapping the link in their thread has to land them ON their canvas,
// signed in, with no form. So the link carries a short-lived signed token, and
// this route trades it for a genuine Supabase session by minting a magiclink
// server-side and redirecting into Supabase's own verify endpoint.
//
// We do NOT invent a session format. Supabase issues the session; we only prove
// the bearer of the link is the user the bot texted.
//
// Token: base64url(JSON{u,e}) + "." + hex(HMAC)[0..32]
// Key:   SHA-256(secret + ":scout-session-v1"), mirroring emailThumbSig().

const TOKEN_TTL_MS = 30 * 60 * 1000;   // links live in a chat thread; keep them short

let secretCache = { secret: '', at: 0 };

async function scoutSecret(env) {
  if (secretCache.secret && Date.now() - secretCache.at < 300_000) return secretCache.secret;
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/app_config?key=eq.scout_session_hmac&select=value`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!res.ok) throw new Error(`scout_session_hmac fetch ${res.status}`);
  const secret = (await res.json())?.[0]?.value?.secret || '';
  if (!secret) throw new Error('scout_session_hmac missing');
  secretCache = { secret, at: Date.now() };
  return secret;
}

function b64urlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
}

async function sign(env, payload) {
  const enc = new TextEncoder();
  const secret = await scoutSecret(env);
  const keyBytes = await crypto.subtle.digest('SHA-256', enc.encode(`${secret}:scout-session-v1`));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// Constant-time compare. A fast-exit compare on a 128-bit MAC is a real oracle
// when the attacker controls the token and can retry freely.
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Mint a token for `userId`. Called by the ingest service over an authenticated
// internal route (below), not by anything user-facing.
export async function mintScoutSessionToken(env, userId, ttlMs = TOKEN_TTL_MS) {
  const payload = b64urlEncode(JSON.stringify({ u: userId, e: Date.now() + ttlMs }));
  return `${payload}.${await sign(env, payload)}`;
}

// Exported for tests: signature forgery and expiry are the two ways this route
// turns into "sign in as anyone", so they're worth asserting directly.
export async function verifyScoutSessionToken(env, token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expect = await sign(env, payload);
  if (!safeEqual(sig, expect)) return null;
  let body;
  try { body = JSON.parse(b64urlDecode(payload)); } catch (_) { return null; }
  if (!body?.u || !body?.e || Date.now() > Number(body.e)) return null;
  return body.u;
}

function landingPage(title, message) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${title}</title>`
    + `<style>body{background:#0a0a0c;color:#e8e8ea;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;`
    + `display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}`
    + `div{max-width:32rem}a{color:#d8b46a}</style>`
    + `<div><h1 style="font-size:1.25rem;font-weight:600">${title}</h1><p>${message}</p></div>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );
}

// GET /s/<token>[?board=&cards=]
//
// Trades the signed token for a real Supabase session and lands the user on
// their board. Any query params ride through to the app, so the same link that
// signs you in also frames the exact cards that just arrived.
export async function handleScoutSession(url, request, env) {
  const token = url.pathname.replace(/^\/s\//, '').replace(/\/$/, '');
  if (!token) return landingPage('Link not found', 'That link is missing its code.');

  let userId;
  try {
    userId = await verifyScoutSessionToken(env, token);
  } catch (_) {
    return landingPage('Something went wrong', 'We could not check that link. Try again in a moment.');
  }
  if (!userId) {
    return landingPage(
      'That link has expired',
      'Scout links are good for 30 minutes. Text the bot again and it will send a fresh one.',
    );
  }

  // Resolve the account's CURRENT email — a shell user who has since attached a
  // real address must get a magiclink for that address, not the synthetic one.
  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!userRes.ok) return landingPage('Account not found', 'We could not find the account for that link.');
  const email = (await userRes.json())?.email;
  if (!email) return landingPage('Account not found', 'That account has no address we can sign you in with.');

  // Where to land once Supabase has verified. Carries ?board=&cards= through so
  // the canvas frames exactly what the bot just added.
  const dest = new URL('/', url.origin);
  for (const [k, v] of url.searchParams) {
    if (k === 'board' || k === 'cards' || k === 'card') dest.searchParams.set(k, v);
  }

  const genRes = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email, options: { redirect_to: dest.toString() } }),
    signal: AbortSignal.timeout(8000),
  });
  if (!genRes.ok) return landingPage('Something went wrong', 'We could not sign you in just now. Try the link again.');

  const link = await genRes.json();
  const action = link?.action_link || link?.properties?.action_link;
  if (!action) return landingPage('Something went wrong', 'We could not sign you in just now. Try the link again.');

  // 302, and explicitly uncached: this URL is single-use on Supabase's side, so
  // a cached copy would hand the next visitor a dead link.
  return new Response(null, {
    status: 302,
    headers: { location: action, 'cache-control': 'no-store, private', 'referrer-policy': 'no-referrer' },
  });
}

// POST /api/scout/session — internal. The ingest service asks for a link to text
// someone. Gated on the service-role key, which only our own backends hold.
export async function handleScoutSessionMint(request, env) {
  const auth = request.headers.get('authorization') || '';
  const presented = auth.replace(/^Bearer\s+/i, '');
  if (!env.SUPABASE_SERVICE_ROLE_KEY || !safeEqual(presented, env.SUPABASE_SERVICE_ROLE_KEY)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'content-type': 'application/json' },
    });
  }
  let body = {};
  try { body = await request.json(); } catch (_) { /* empty */ }
  const userId = String(body.user_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(userId)) {
    return new Response(JSON.stringify({ error: 'valid user_id required' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }
  const token = await mintScoutSessionToken(env, userId);
  return new Response(JSON.stringify({ token, expires_in_ms: TOKEN_TTL_MS }), {
    status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
