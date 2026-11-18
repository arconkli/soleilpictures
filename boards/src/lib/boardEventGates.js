// Which realtime `boards` events are worth a re-read. Pure.
//
// Without replica identity full, an UPDATE payload's `old` holds only the key,
// so these compare payload.new against what the caller already holds, never
// against `old`.

// list_shared_boards column <- boards column, for every field the shared list
// shows or uses (App.jsx builds the boards map from these). updated_at is left
// out on purpose: it moves on every write and only orders an idle prefetch.
const SHARED_FIELDS = [
  ['board_name', 'name'],
  ['parent_board_id', 'parent_board_id'],
  ['board_view', 'view', 'canvas'],
  ['board_cover', 'cover', 'neutral'],
  ['source_workspace_id', 'workspace_id'],
  ['scheduled_date', 'scheduled_date'],
  ['scheduled_end', 'scheduled_end'],
  ['day_label', 'day_label'],
  ['sched_status', 'sched_status'],
  ['sched_version', 'sched_version'],
  ['sched_published_at', 'sched_published_at'],
  ['day_type', 'day_type'],
  ['day_start', 'day_start'],
  ['day_end', 'day_end'],
  ['day_place', 'day_place'],
  ['day_types', 'day_types'],
];

const ISO = /^\d{4}-\d\d-\d\dT/;

const same = (a, b) => {
  const x = a ?? null;
  const y = b ?? null;
  if (x === y) return true;
  if (typeof x === 'object' || typeof y === 'object') {
    try {
      const px = typeof x === 'string' ? JSON.parse(x) : x;
      const py = typeof y === 'string' ? JSON.parse(y) : y;
      return JSON.stringify(px) === JSON.stringify(py);
    } catch (_) { return false; }
  }
  // The same moment can be written two ways (+00:00 and Z).
  if (typeof x === 'string' && typeof y === 'string' && ISO.test(x) && ISO.test(y)) {
    return Date.parse(x) === Date.parse(y);
  }
  return String(x) === String(y);
};

// True when the shared list should be read again for this UPDATE. `cached` is
// the list's row for that board. Not on the list: read, unless the board sits in
// a workspace you belong to (memberWorkspaceIds, a Set), because
// list_shared_boards leaves those out (`not is_workspace_member(b.workspace_id)`,
// 0901) so such an UPDATE can't add it. A board moved into another workspace
// carries a workspace_id you aren't a member of, so it still reads. A column missing from the payload can't be compared and is skipped.
// A trashed board (deleted_at set) drops off the list, so that reads too.
export function sharedBoardUpdateNeedsRefetch(cached, newRow, memberWorkspaceIds) {
  if (!newRow) return true;
  if (!cached) {
    return !(memberWorkspaceIds && memberWorkspaceIds.size
      && newRow.workspace_id && memberWorkspaceIds.has(newRow.workspace_id));
  }
  if (newRow.deleted_at) return true;
  for (const [listKey, boardKey, fallback] of SHARED_FIELDS) {
    if (!(boardKey in newRow)) continue;
    const incoming = newRow[boardKey] ?? (fallback ?? null);
    if (!same(cached[listKey], incoming)) return true;
  }
  return false;
}

// True when the name trie should reload for this boards event. `names` is a
// Map(board id -> the name the trie was built with). Insert and delete always
// reload; an update reloads when the name differs or the board is unknown to
// the trie. A trashed board isn't in the trie: if it was, reload to drop it.
export function trieBoardEventNeedsReload(eventType, newRow, names) {
  if (eventType !== 'UPDATE') return true;
  if (!newRow || !newRow.id || !names) return true;
  const known = names.has(newRow.id);
  if (newRow.deleted_at) return known;
  if (!known) return true;
  if (!('name' in newRow)) return false;
  return String(names.get(newRow.id) ?? '') !== String(newRow.name ?? '');
}
