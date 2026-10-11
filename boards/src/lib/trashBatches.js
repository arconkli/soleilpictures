// Group the trash into what the person actually deleted.
//
// Since 0396, deleting a cluster trashes it and every cluster inside it as one
// batch: they all carry the same deleted_at, and restore_board brings the batch
// back together. Listing every row would bury the cluster someone deleted under
// the sub-clusters that went with it, so the trash shows one row per batch root
// with a count of what is inside it. A row belongs to a batch when its parent is
// also in the trash with the very same deleted_at; a sub-cluster deleted on its
// own earlier keeps its own deleted_at and so stays its own row.

export function groupTrashBatches(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const byId = new Map(list.map((r) => [r.id, r]));
  const inSameBatch = (r) => {
    const p = r?.parent_board_id ? byId.get(r.parent_board_id) : null;
    return !!p && !!r.deleted_at && p.deleted_at === r.deleted_at;
  };
  const rootOf = (r) => {
    let cur = r;
    const seen = new Set();
    while (inSameBatch(cur) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parent_board_id);
    }
    return cur;
  };
  const inside = new Map();
  for (const r of list) {
    if (!inSameBatch(r)) continue;
    const root = rootOf(r);
    inside.set(root.id, (inside.get(root.id) || 0) + 1);
  }
  return list
    .filter((r) => !inSameBatch(r))
    .map((board) => ({ board, inside: inside.get(board.id) || 0 }));
}
