// Which workspace a person opens first on a device that has no remembered one.
//
// "Personal" means the oldest workspace the account OWNS (0400). Before 0400,
// someone who signed up from a workspace invite owned nothing: the invite was
// claimed inside the signup trigger, so the bootstrap found that membership and
// called the inviter's workspace their "Personal" one. Now they get a workspace
// of their own, and opening it first would put a brand-new invitee on an empty
// canvas instead of the work they were invited to see. So a membership that was
// created alongside the account itself, in someone else's workspace, is where
// the account starts.

export const INVITE_JOIN_WINDOW_MS = 15 * 60 * 1000;

export function invitedStartWorkspace(workspaces, user) {
  if (!user?.id || !Array.isArray(workspaces)) return null;
  const born = Date.parse(user.created_at || '');
  if (!Number.isFinite(born)) return null;
  let best = null;
  let bestAt = Infinity;
  for (const w of workspaces) {
    if (!w?.id || !w.created_by || w.created_by === user.id) continue;
    const joined = Date.parse(w._joinedAt || '');
    if (!Number.isFinite(joined) || Math.abs(joined - born) > INVITE_JOIN_WINDOW_MS) continue;
    if (joined < bestAt) { best = w; bestAt = joined; }
  }
  return best;
}
