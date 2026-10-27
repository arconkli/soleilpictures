// Reads a billing function starts before it knows it may use them, so that a
// buyer does not wait for one round trip after another while the button spins.
// Plain JS shared by the edge functions (Deno) and the node tests
// (boards/src/lib/earlyReads.test.mjs), like activateCore.mjs.
//
// The pattern: a function that has to ask getUser who the caller is starts the
// reads that need only the caller's id or address at the same time, from the
// claims of the token it was handed. Nothing they return is used until getUser
// has named the same user at the same address (claimsMatch); otherwise the
// function reads again, in its old order.

// The caller's id and address as the access token states them. The signature
// is not checked here: the gateway checks it before the function runs
// (verify_jwt), and getUser still decides who the caller is. Null for anything
// that is not a signed-in user's live token, so the public anon key, which is
// a valid JWT as well, starts nothing it could not start before.
export function tokenClaims(token, nowMs = Date.now()) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
    if (claims?.role !== 'authenticated' || typeof claims.sub !== 'string' || !claims.sub) return null;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= nowMs) return null;
    const email = typeof claims.email === 'string' && claims.email.trim() ? claims.email.toLowerCase().trim() : null;
    return { sub: claims.sub, email };
  } catch (_) {
    return null;
  }
}

// Whether reads started on tokenClaims may be used: getUser named the same
// user, at the same address (an address changed since the token was minted
// reads again).
export function claimsMatch(claims, user) {
  if (!claims || !user || typeof user.id !== 'string' || claims.sub !== user.id) return false;
  const email = typeof user.email === 'string' && user.email.trim() ? user.email.toLowerCase().trim() : null;
  return claims.email === email;
}

// A read started early. It never rejects: a request that answers before using
// it (a refused token, a bad body) must not leave a rejection unhandled behind
// it, and it can simply be dropped.
export function settle(read) {
  return Promise.resolve(read).then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
}

// The early read's answer when there is one to use, or the same read now: when
// it was not started, may not be used (null), or failed.
export async function earlyOr(started, again) {
  const s = started ? await started : null;
  return s && s.ok ? s.value : await again();
}

// The early read's answer, or its failure thrown where it is awaited, as if it
// had been started there. (Not named `settled`: verify-checkout-session has a
// `const settled` of its own in the block that awaits this.)
export async function earlyAnswer(started) {
  const s = await started;
  if (!s.ok) throw s.error;
  return s.value;
}
