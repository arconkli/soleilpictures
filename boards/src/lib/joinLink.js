// joinLink.js — carry a "join this board via invite link" intent across the
// signup roundtrip. The /share viewer's Join button navigates to
// /?join=<token> (plus attribution params); AuthGate stashes the token and,
// once a session exists, claims it via claim_collab_link and lands the user
// in the joined board. Mirrors remix.js / the PENDING_INVITE_KEY rails so it
// survives an OTP magic-link hop (new tab / cross-device) as well as
// same-tab clicks by already-signed-in users.
//
// NOTE: ?invite= is taken by single-recipient pending_invites tokens
// (AuthGate.captureInviteToken); ?join= is the multi-use collab-link param.

const JOIN_KEY = 'soleil.boards.pending.join.token';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validate a raw ?join= value. Returns the token or null — never throws.
export function parseJoinParam(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const v = raw.trim();
  return UUID_RE.test(v) ? v : null;
}

export function stashJoin(token) {
  const t = parseJoinParam(token);
  if (!t) return;
  try { localStorage.setItem(JOIN_KEY, t); } catch (_) {}
}

export function readJoin() {
  try { return parseJoinParam(localStorage.getItem(JOIN_KEY)); } catch (_) { return null; }
}

export function clearJoin() {
  try { localStorage.removeItem(JOIN_KEY); } catch (_) {}
}
