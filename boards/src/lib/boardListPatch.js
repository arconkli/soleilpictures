// Fold a burst of `boards` realtime events into the workspace board map
// without a refetch, when that is safe. Pure, so node tests can pin it.
//
// Why (PERF-03): every stored-thumbnail stamp is a boards UPDATE, and every
// UPDATE made every open tab in the workspace refetch `select *` for ALL
// boards and replace every board object — which invalidated App's
// currentCards, every BoardCard's `board` prop and the sidebar tree, so the
// whole app re-rendered about a second after each thumbnail upload. An UPDATE
// of a board we already hold carries its new row; patch that one object and
// keep every other board's identity.
//
// Returns { next, refresh }. `refresh: true` means "something here a patch
// can't express — refetch the list" (an INSERT, a DELETE, a restore from
// trash, a row that left the workspace, a payload with no row). `next` is
// `prev` itself when nothing visible changed, so the caller can skip a render.
export function applyBoardEvents(prev, payloads, workspaceId) {
  let next = prev;
  for (const p of payloads || []) {
    const row = p && p.new;
    if (!p || p.eventType !== 'UPDATE' || !row || !row.id) return { next: prev, refresh: true };
    const held = next[row.id];
    // Not in the map: a restore from trash (listBoards hides deleted rows),
    // or an event that raced the initial list. The refetch is right there.
    if (!held) return { next: prev, refresh: true };
    if (workspaceId && row.workspace_id && row.workspace_id !== workspaceId) return { next: prev, refresh: true };
    if (row.deleted_at) {
      // Soft delete: listBoards would no longer return it.
      if (next === prev) next = { ...prev };
      delete next[row.id];
      continue;
    }
    // Merge, don't replace: realtime omits unchanged TOASTed columns.
    let changed = false;
    for (const k of Object.keys(row)) {
      if (!sameValue(held[k], row[k])) { changed = true; break; }
    }
    if (!changed) continue;
    if (next === prev) next = { ...prev };
    next[row.id] = { ...held, ...row };
  }
  return { next, refresh: false };
}

function sameValue(a, b) {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
  }
  return false;
}
