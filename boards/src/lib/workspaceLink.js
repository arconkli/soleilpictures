// workspaceLink.js — carry a "join this whole workspace" intent across the
// signup roundtrip. A workspace invite link (0450) is /?wsjoin=<token>;
// AuthGate stashes the token and, once a session exists, claims it via
// claim_workspace_invite_link. Mirrors joinLink.js so it survives an OTP
// magic-link hop (new tab / cross-device) as well as same-tab clicks.
//
// NOTE: three different params. ?invite= is a single-recipient pending_invites
// token, ?join= is a collab link (one cluster), ?wsjoin= is the whole workspace.

const WSJOIN_KEY = 'soleil.boards.pending.wsjoin.token';

export const WSJOIN_PARAM = 'wsjoin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validate a raw ?wsjoin= value. Returns the token or null — never throws.
export function parseWsJoinParam(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const v = raw.trim();
  return UUID_RE.test(v) ? v : null;
}

export function stashWsJoin(token) {
  const t = parseWsJoinParam(token);
  if (!t) return;
  try { localStorage.setItem(WSJOIN_KEY, t); } catch (_) {}
}

export function readWsJoin() {
  try { return parseWsJoinParam(localStorage.getItem(WSJOIN_KEY)); } catch (_) { return null; }
}

export function clearWsJoin() {
  try { localStorage.removeItem(WSJOIN_KEY); } catch (_) {}
}

// The shareable link for a token, or null for an invalid one.
export function workspaceInviteUrl(token, origin) {
  const t = parseWsJoinParam(token);
  if (!t) return null;
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/?${WSJOIN_PARAM}=${t}`;
}

// Someone who just joined a workspace by its link (at sign-in, or by the join
// card) is marked for this tab, so the workspace can note where they landed
// once it has opened (components/setup/SetupInWorkspace). Session storage: it
// means this visit, and it is read once.
export function joinedFlagKey(uid) {
  return `soleil.setup.joined.${uid}`;
}

export function markJoined(uid, workspaceId) {
  if (!uid || !workspaceId) return;
  try { sessionStorage.setItem(joinedFlagKey(uid), workspaceId); } catch (_) { /* the landing just goes unnoted */ }
}
