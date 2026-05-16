// Per-board zoom + pan persistence. Saves the user's viewing position
// per board id so reopening a board resumes where they left off
// instead of always snapping back to the default (zoom 1, pan 40/60).
//
// localStorage, per-machine. Cross-device sync would need a Supabase-
// backed alternative; not implemented yet because zoom/pan is a UI
// preference that rarely needs to follow the user across machines.

const KEY_PREFIX = 'soleil.boards.view.';

// Returns { zoom, pan: { x, y } } or null if no saved view (or saved
// payload is malformed). Caller falls back to the default on null.
export function loadBoardView(boardId) {
  if (!boardId || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY_PREFIX + boardId);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (typeof v?.zoom !== 'number') return null;
    if (typeof v?.pan?.x !== 'number' || typeof v?.pan?.y !== 'number') return null;
    return { zoom: v.zoom, pan: { x: v.pan.x, y: v.pan.y } };
  } catch (_) { return null; }
}

export function saveBoardView(boardId, view) {
  if (!boardId || typeof localStorage === 'undefined') return;
  if (!view || typeof view.zoom !== 'number') return;
  try {
    localStorage.setItem(KEY_PREFIX + boardId, JSON.stringify({
      zoom: view.zoom,
      pan: { x: view.pan?.x ?? 0, y: view.pan?.y ?? 0 },
      t: Date.now(),
    }));
  } catch (_) {}
}

export function clearBoardView(boardId) {
  if (!boardId || typeof localStorage === 'undefined') return;
  try { localStorage.removeItem(KEY_PREFIX + boardId); } catch (_) {}
}
