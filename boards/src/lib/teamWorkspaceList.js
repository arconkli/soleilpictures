// The workspace list a person reaches through a team (hooks/useAllWorkspaces.js).
// A team workspace is no membership row: it comes from a second read after the
// memberships, and is marked _viaTeam. Pure, so the merge can be tested.

// The memberships plus the team workspaces in rows (listMyTeamWorkspaces):
// skipped when a row has no workspace id, or the id is already listed.
export function withTeamWorkspaces(base, rows) {
  const list = base || [];
  const seen = new Set(list.map((w) => w.id));
  const extra = [];
  for (const row of rows || []) {
    const ws = row?.workspace;
    if (!ws?.id || seen.has(ws.id)) continue;
    seen.add(ws.id);
    extra.push({ ...ws, _myRole: row.role, _joinedAt: row.created_at, _viaTeam: true });
  }
  return [...list, ...extra];
}

// The memberships plus the team workspaces the list already held (prev), until
// the team read answers: a person whose current workspace comes through a team
// must not drop out of the list while the memberships reload.
export function keepTeamWorkspaces(base, prev) {
  const list = base || [];
  const seen = new Set(list.map((w) => w.id));
  const kept = [];
  for (const w of prev || []) {
    if (!w?._viaTeam || !w.id || seen.has(w.id)) continue;
    seen.add(w.id);
    kept.push(w);
  }
  return [...list, ...kept];
}
