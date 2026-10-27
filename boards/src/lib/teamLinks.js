// teamLinks.js — the Team plan's two links (Team S4), carried across the code
// step like ?wsjoin= (lib/workspaceLink.js). ?teamjoin=<token> is the team's
// link, ?teaminvite=<token> an email invite. AuthGate stashes either one on
// arrival; a join is claimed (or asked) there, an invite is accepted by App
// once it mounts (lib/teamBoot.js). Also one note App toasts after a join
// that happened before it mounted (a sign-in, a reload).

export const TEAMJOIN_PARAM = 'teamjoin';
export const TEAMINVITE_PARAM = 'teaminvite';

// AuthGate checks this key itself, so the entry chunk needn't carry this module.
export const TEAM_LINK_KEY = 'soleil.boards.pending.teamlink';
const NOTE_KEY = 'soleil.boards.team.note';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A raw param value as a lowercased UUID, or null. Never throws.
export function parseTeamToken(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim();
  return UUID_RE.test(v) ? v.toLowerCase() : null;
}

// The link a query string carries: an invite wins over a team link.
export function teamLinkFromSearch(search) {
  let params;
  try { params = new URLSearchParams(search || ''); } catch (_) { return null; }
  const invite = parseTeamToken(params.get(TEAMINVITE_PARAM));
  if (invite) return { kind: 'invite', token: invite };
  const join = parseTeamToken(params.get(TEAMJOIN_PARAM));
  if (join) return { kind: 'join', token: join };
  return null;
}

export function stashTeamLink(link) {
  const token = parseTeamToken(link && link.token);
  if (!token || !link || (link.kind !== 'join' && link.kind !== 'invite')) return;
  try { localStorage.setItem(TEAM_LINK_KEY, JSON.stringify({ kind: link.kind, token })); } catch (_) {}
}

export function readTeamLink() {
  try {
    const v = JSON.parse(localStorage.getItem(TEAM_LINK_KEY));
    if (!v || (v.kind !== 'join' && v.kind !== 'invite')) return null;
    const token = parseTeamToken(v.token);
    return token ? { kind: v.kind, token } : null;
  } catch (_) { return null; }
}

export function clearTeamLink() {
  try { localStorage.removeItem(TEAM_LINK_KEY); } catch (_) {}
}

// One line for App to toast once it has mounted. Session storage: it means
// this visit, and it is read once.
export function stashTeamNote(text) {
  if (!text || typeof text !== 'string') return;
  try { sessionStorage.setItem(NOTE_KEY, text); } catch (_) {}
}

export function takeTeamNote() {
  try {
    const v = sessionStorage.getItem(NOTE_KEY);
    sessionStorage.removeItem(NOTE_KEY);
    return typeof v === 'string' && v ? v : null;
  } catch (_) { return null; }
}
