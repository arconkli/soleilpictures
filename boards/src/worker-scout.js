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

import { normalizeHandle, isTextablePhone } from './lib/phone.js';
import { verifyUser } from './lib/workerAuth.js';

const TOKEN_TTL_MS = 30 * 60 * 1000;   // links live in a chat thread; keep them short

// Pins WHICH consent wording someone agreed to. Bump this whenever the caption
// in ScoutSignupBox changes, so past rows keep pointing at what they were
// actually shown rather than at today's text.
// v2 (2026-08-07) dropped the platform sentence and trimmed to consent only.
const CONSENT_VERSION = 'v2';

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

// Stable pseudonym for a client IP, for rate limiting only.
//
// The raw address is never stored. Keyed off the same app_config secret with a
// DIFFERENT label, so a leaked hash can't be replayed against the session
// signer and vice versa.
async function ipHash(env, ip) {
  if (!ip) return null;
  const enc = new TextEncoder();
  const secret = await scoutSecret(env);
  const keyBytes = await crypto.subtle.digest('SHA-256', enc.encode(`${secret}:scout-ip-v1`));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(String(ip)));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
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

const jsonRes = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

// POST /api/scout/signup — the /scout landing page's phone box.
//
// The one endpoint in this product that is public, unauthenticated, and has a
// side effect on someone's PHONE. It deliberately does very little itself: it
// normalizes, hashes the IP, and hands everything to scout_request_invite,
// where the caps live. Putting the limits in the RPC rather than here means
// they hold no matter which caller reaches them, and they're enforced inside
// the same transaction that inserts the row (so two simultaneous submits can't
// both pass a count check).
//
// It never sends anything. The bot drains the queue on its own schedule —
// see scout/src/invites.js and the header of migration 0210 for why.
export async function handleScoutSignup(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405);

  let body = {};
  try { body = await request.json(); } catch (_) { /* empty */ }

  // cf-ipcountry makes non-US numbers safe to normalize: without it a UK mobile
  // typed in national form reads as a US number and we'd text a stranger.
  const country = request.headers.get('cf-ipcountry') || null;
  const phone = normalizeHandle(body.phone, country && country !== 'XX' ? country : null);

  if (!isTextablePhone(phone)) {
    return jsonRes({ error: "That doesn't look like a mobile number. Include the country code if you're outside the US." }, 400);
  }

  // Only the campaign fields, and only as strings — this lands in a jsonb
  // column, and echoing an arbitrary client object into the database is how you
  // end up storing whatever someone felt like posting.
  const utm = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer']) {
    const v = body[k];
    if (typeof v === 'string' && v) utm[k] = v.slice(0, 200);
  }

  let hashed = null;
  try {
    hashed = await ipHash(env, request.headers.get('cf-connecting-ip'));
  } catch (_) {
    // No secret configured yet — rate limiting degrades, the signup still works.
  }

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/scout_request_invite`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      p_phone: phone,
      p_source: typeof body.source === 'string' ? body.source.slice(0, 60) : 'scout_landing',
      p_ip_hash: hashed,
      p_country: country,
      p_utm: utm,
      p_consent_version: CONSENT_VERSION,
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // 53400 = the per-IP limit. Everything else is ours, not theirs.
    if (detail.includes('53400') || detail.includes('too many requests')) {
      return jsonRes({ error: 'Too many numbers from this connection. Try again in an hour.' }, 429);
    }
    return jsonRes({ error: 'We could not save that just now. Try again in a moment.' }, 502);
  }

  const row = (await res.json().catch(() => null))?.[0] || {};

  // `status` here is the SIGNUP's state, and it is what the page renders. It
  // says 'pending' until the bot has actually sent something, so the success
  // copy can never claim a text went out that didn't.
  return jsonRes({
    status: row.status === 'sent' ? 'texted' : 'queued',
    is_new: row.is_new !== false,
  });
}

// POST /api/scout/claim — a shell account attaches a real email address.
//
// THE PROBLEM THIS SOLVES
// Someone who texts Scout before they have ever visited the site gets a real
// account minted behind them, carrying a synthetic scout.soleilpictures.com
// address they would not recognise. If they later sign up on the web with their
// own email they end up with a SECOND account, and the photos they texted are
// stranded in the first one. Nothing merges them.
//
// No existing account has a phone number on file, so an inbound handle can
// never be matched to a person — the shell account is unavoidable. The fix is
// to let them adopt the account they already have rather than start another:
// same user row, same workspace, same board, real address.
//
// WHY THIS DOES NOT SET THE ADDRESS DIRECTLY
// It hands the change to Supabase's own email-change flow, which mails a
// confirmation to the NEW address and only applies it when that link is
// followed. Writing the address straight in would let anyone standing at this
// endpoint attach an email they do not control — and since the address is what
// sharing, invites and sign-in all key on, that is an account takeover with
// extra steps. is_shell therefore clears later, when the app calls
// scout_settle_shell and finds the address is genuinely no longer synthetic —
// never on this route's say-so.
export async function handleScoutClaim(request, env) {
  if (request.method !== 'POST') return jsonRes({ error: 'method not allowed' }, 405);

  const auth = await verifyUser(request, env);
  if (!auth.ok) return jsonRes({ error: auth.error }, auth.status || 401);

  let body = {};
  try { body = await request.json(); } catch (_) { /* empty */ }
  const email = String(body.email || '').trim().toLowerCase();
  // Deliberately loose. Real validation is the confirmation mail: an address
  // that passes a regex but does not exist simply never gets confirmed.
  if (!email || email.length > 254 || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
    return jsonRes({ error: 'That does not look like an email address.' }, 400);
  }

  // Only a shell account may take this path. A real account reaching here would
  // be an ordinary change-of-address, which belongs in account settings with
  // the checks that flow has — not in a route whose whole purpose is that the
  // caller has never seen a login screen.
  const stateRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/scout_accounts?user_id=eq.${auth.userId}&select=is_shell`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!stateRes.ok) return jsonRes({ error: 'We could not check that just now.' }, 502);
  const state = (await stateRes.json().catch(() => null))?.[0];
  if (!state) return jsonRes({ error: 'not a scout account' }, 403);
  if (state.is_shell === false) return jsonRes({ error: 'already claimed' }, 409);

  // Is the address already spoken for? Ask before attempting the change, so the
  // answer is a clean "use the code instead" rather than a Supabase error.
  //
  // The response says only that this address cannot be used HERE. It never
  // confirms an account exists: this endpoint is reachable by anyone holding a
  // link texted to a phone, and turning it into an email-enumeration oracle
  // would be a worse leak than the problem it solves.
  const takenRes = await fetch(
    `${env.SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (takenRes.ok) {
    const users = (await takenRes.json().catch(() => null))?.users || [];
    if (users.some((u) => String(u.email || '').toLowerCase() === email && u.id !== auth.userId)) {
      return jsonRes({ conflict: true }, 200);
    }
  }

  const upd = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${auth.userId}`, {
    method: 'PUT',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    // email_confirm omitted ON PURPOSE — see the header. Supabase mails the new
    // address and holds the change until it is confirmed.
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(8000),
  });
  if (!upd.ok) {
    const detail = await upd.text().catch(() => '');
    // Supabase's own uniqueness check, in case the lookup above raced it.
    if (detail.includes('already been registered') || detail.includes('email_exists')) {
      return jsonRes({ conflict: true }, 200);
    }
    return jsonRes({ error: 'We could not send the confirmation. Try again in a moment.' }, 502);
  }

  return jsonRes({ status: 'confirm_sent', email }, 200);
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
