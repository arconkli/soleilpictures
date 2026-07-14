// Synchronous per-board permission lookup against already-loaded data.
// Returns the highest level of access the caller has for a board:
//
//   { role: 'owner' | 'editor' | 'viewer' | 'none',
//     canEdit: boolean,
//     source:  'workspace' | 'share' | 'tier-blocked' | null }
//
// "owner" = workspace owner (workspaces.created_by === userId).
// "editor" = workspace member (workspace_members) OR per-board editor share.
// "viewer" = per-board viewer share (cascades to descendants).
//
// Cascade: per-board shares apply to the board AND every descendant
// (via boards.parent_board_id chain). A board has the HIGHEST role
// among its own share row + every ancestor's share row.
//
// Tier gates (applied AFTER the workspace-owner shortcut):
//   tier='waitlist' → blocked from everything (defensive)
//   Editor collaboration is FREE for every other tier (0188): a demo user's
//   editor share writes like anyone else's. Resources stay gated owner-pays —
//   whatever a collaborator adds charges the board owner's cap (0187).

import { useMemo } from 'react';

// Pure permission decision — same logic as the hook, but callable outside a
// React render (e.g. per-row in a loop, where calling a hook would be illegal).
// See useBoardPermission below for the param/return contract.
export function computeBoardPermission({
  board,            // board object (must have id, workspace_id, parent_board_id)
  boards,           // map of boardId → board (for ancestor lookup)
  workspace,        // current workspace object (for created_by check)
  workspaceMembers, // array of { user_id, role }
  sharedBoards,     // array of list_shared_boards rows
  userId,
  tier,             // 'admin' | 'paid' | 'demo' | 'waitlist' | null (optional)
}) {
  if (!board || !userId) {
    return { role: 'none', canEdit: false, source: null };
  }

  // Workspace owner trumps everything — applies to all tiers (demo users
  // can edit their own workspace just fine, subject to the 100-card cap
  // enforced in addCard).
  if (workspace?.created_by === userId && board.workspace_id === workspace?.id) {
    return { role: 'owner', canEdit: true, source: 'workspace' };
  }

  // tier='waitlist' — defensive block. Shouldn't reach here in practice
  // because TierRouter sends waitlist users to /welcome before the app
  // mounts, but a stale session could leak through.
  if (tier === 'waitlist') {
    return { role: 'none', canEdit: false, source: 'tier-blocked' };
  }

  // Workspace member of THE BOARD'S workspace (not necessarily the
  // currently active one — board could be from a different workspace
  // when navigating via shared links).
  const isWsMember = (workspaceMembers || []).some(m => m.user_id === userId)
    && board.workspace_id === workspace?.id;
  if (isWsMember) {
    return { role: 'editor', canEdit: true, source: 'workspace' };
  }

  // Per-board share — walk up parent chain, take the strongest role
  // we find (editor beats viewer).
  const sharedById = new Map((sharedBoards || []).map(s => [s.board_id, s]));
  let cur = board;
  let bestRole = null;
  let safety = 64;
  while (cur && safety-- > 0) {
    const hit = sharedById.get(cur.id);
    if (hit) {
      if (hit.role === 'editor') { bestRole = 'editor'; break; }
      if (!bestRole) bestRole = 'viewer';
    }
    cur = cur.parent_board_id ? boards?.[cur.parent_board_id] : null;
  }
  if (bestRole) {
    return { role: bestRole, canEdit: bestRole === 'editor', source: 'share' };
  }

  return { role: 'none', canEdit: false, source: null };
}

export function useBoardPermission(args) {
  const { board, boards, workspace, workspaceMembers, sharedBoards, userId, tier } = args;
  return useMemo(
    () => computeBoardPermission(args),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [board, boards, workspace, workspaceMembers, sharedBoards, userId, tier]
  );
}
