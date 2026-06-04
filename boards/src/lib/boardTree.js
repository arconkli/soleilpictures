// Pure helpers for the board hierarchy (boards.parent_board_id is the
// source of truth). No React, no Supabase — safe to unit-test in isolation
// and to call from any drop surface. The canvas `kind:'board'` card is a
// DERIVED MIRROR of this hierarchy (one card per child on the parent's
// canvas); planCanvasReconcile computes the add/remove set to keep that
// mirror honest after a reparent.
//
// Cycle logic is ported from docState.js movePage's isDescendantOf
// (docState.js:311-316) but generalized over the boards map and hardened
// with a visited-set so a pre-existing cycle in the data can't hang us.

export function getBoard(boards, id) {
  if (!boards || id == null) return null;
  return boards[id] || null;
}

// True when `ancestorId` lies on the parent chain of `nodeId` (inclusive of
// nodeId itself). Equivalently: nodeId is in ancestorId's subtree.
export function isDescendantOf(boards, nodeId, ancestorId) {
  if (nodeId == null || ancestorId == null) return false;
  const visited = new Set();
  let cur = nodeId;
  while (cur != null) {
    if (cur === ancestorId) return true;
    if (visited.has(cur)) return false; // defend against data that already loops
    visited.add(cur);
    const b = getBoard(boards, cur);
    if (!b) return false;
    cur = b.parent_board_id ?? null;
  }
  return false;
}

// Moving `childId` under `targetId` creates a cycle when the target IS the
// child or sits anywhere in the child's subtree.
export function wouldCreateCycle(boards, childId, targetId) {
  if (!childId || !targetId) return false;
  if (childId === targetId) return true;
  return isDescendantOf(boards, targetId, childId);
}

// Decide which of childIds can move under targetId (targetId === null means
// move to workspace root). Offenders are skipped with a reason rather than
// failing the whole batch, so a multi-select drag does as much as it legally
// can and the UI can report what it couldn't.
//   reasons: missing | self | target-missing | cross-workspace | cycle | same-parent
export function planReparent(boards, childIds, targetId) {
  const movable = [];
  const skipped = [];
  const seen = new Set();
  const target = targetId ? getBoard(boards, targetId) : null;
  for (const rawId of childIds || []) {
    if (!rawId || seen.has(rawId)) continue;
    seen.add(rawId);
    const child = getBoard(boards, rawId);
    if (!child) { skipped.push({ id: rawId, reason: 'missing' }); continue; }
    if (targetId && rawId === targetId) { skipped.push({ id: rawId, reason: 'self' }); continue; }
    if (targetId && !target) { skipped.push({ id: rawId, reason: 'target-missing' }); continue; }
    if (targetId && target.workspace_id !== child.workspace_id) { skipped.push({ id: rawId, reason: 'cross-workspace' }); continue; }
    if (targetId && wouldCreateCycle(boards, rawId, targetId)) { skipped.push({ id: rawId, reason: 'cycle' }); continue; }
    if ((child.parent_board_id ?? null) === (targetId ?? null)) { skipped.push({ id: rawId, reason: 'same-parent' }); continue; }
    movable.push(rawId);
  }
  return { movable, skipped };
}

// Given a board's current canvas cards, compute how to heal the derived
// `kind:'board'` mirror:
//   addIds         — child boards of boardId with no board-card yet (matches
//                    App.jsx's reconcile-drift effect at ~1191).
//   removeCardKeys — board-cards whose referenced board still exists but is
//                    no longer a child of boardId (a stale mirror left behind
//                    after that board was reparented away). Cards whose board
//                    is GONE are intentionally NOT removed here — those are
//                    hidden at the render layer (isOrphanRef) to avoid the
//                    sync re-add render loop documented in App.jsx.
// Card keys equal the referenced board id for kind:'board' cards.
export function planCanvasReconcile(boards, boardId, cards) {
  const placed = new Set();
  for (const c of (cards || [])) {
    if (c && c.kind === 'board' && c.id != null) placed.add(c.id);
  }
  const addIds = [];
  for (const b of Object.values(boards || {})) {
    if (!b) continue;
    if ((b.parent_board_id ?? null) === boardId && !placed.has(b.id)) addIds.push(b.id);
  }
  const removeCardKeys = [];
  for (const cardBoardId of placed) {
    const ref = getBoard(boards, cardBoardId);
    if (ref && (ref.parent_board_id ?? null) !== boardId) removeCardKeys.push(cardBoardId);
  }
  return { addIds, removeCardKeys };
}
