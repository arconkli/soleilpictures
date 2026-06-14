// worker-ring.js — signed "ring" cookie for the staging-preview pipeline.
//
// The prod Worker mints this cookie (POST /api/ring/join) after verifying the
// caller is ring-eligible (am_i_ring_eligible RPC). On every subsequent
// request, isRingCanary() verifies the cookie WITHOUT any Supabase round-trip
// (pure WebCrypto HMAC) — the gate must stay cheap because it runs on the hot
// path before serving/proxying. A valid cookie ⇒ the prod Worker proxies the
// request to the staging Worker (the latest build). See proxyToStaging in
// worker.js.
//
// Value format:  <payloadB64url>.<sigB64url>
//   payload    = "canary|<uid>|<expEpochSeconds>"
//   sig        = HMAC-SHA256(payload, RING_COOKIE_SECRET)
// Rotating RING_COOKIE_SECRET invalidates every ring cookie at once — the
// global "kick everyone back to prod" lever.

const RING_COOKIE_NAME = 'soleil_ring';
const RING_LABEL = 'canary';
const MAX_AGE_SEC = 7 * 24 * 60 * 60; // 7 days — short enough that revoked
                                      // eligibility self-heals within a week.

function bytesToB64url(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

// Constant-time compare of two equal-length byte arrays.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Mint a fresh signed cookie value. `uid` is embedded for traceability only
// (the HMAC is the real gate). Returns { value, exp, maxAge }.
export async function mintRingCookieValue(env, uid, nowSec = Math.floor(Date.now() / 1000)) {
  const exp = nowSec + MAX_AGE_SEC;
  const payload = `${RING_LABEL}|${uid || ''}|${exp}`;
  const payloadBytes = new TextEncoder().encode(payload);
  const key = await hmacKey(env.RING_COOKIE_SECRET);
  const sig = await crypto.subtle.sign('HMAC', key, payloadBytes);
  return { value: `${bytesToB64url(payloadBytes)}.${bytesToB64url(sig)}`, exp, maxAge: MAX_AGE_SEC };
}

// Verify the request's soleil_ring cookie. True iff the signature is valid,
// the label is "canary", and it hasn't expired. Never throws.
export async function isRingCanary(request, env) {
  try {
    if (!env || !env.RING_COOKIE_SECRET) return false;
    const cookie = request.headers.get('cookie') || '';
    const m = cookie.match(/(?:^|;\s*)soleil_ring=([^;]+)/);
    if (!m) return false;
    const dot = m[1].indexOf('.');
    if (dot <= 0) return false;
    const payloadBytes = b64urlToBytes(m[1].slice(0, dot));
    const gotSig = b64urlToBytes(m[1].slice(dot + 1));
    const key = await hmacKey(env.RING_COOKIE_SECRET);
    const expectedSig = new Uint8Array(await crypto.subtle.sign('HMAC', key, payloadBytes));
    if (!timingSafeEqual(expectedSig, gotSig)) return false;
    const [label, , expStr] = new TextDecoder().decode(payloadBytes).split('|');
    if (label !== RING_LABEL) return false;
    const exp = parseInt(expStr, 10);
    return Number.isFinite(exp) && exp >= Math.floor(Date.now() / 1000);
  } catch (_) {
    return false;
  }
}

export function ringSetCookieHeader(value, maxAge = MAX_AGE_SEC) {
  return `${RING_COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function ringClearCookieHeader() {
  return `${RING_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export { RING_COOKIE_NAME, MAX_AGE_SEC };
