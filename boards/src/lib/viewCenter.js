// Where each board's canvas is looking, in board coordinates — so Files' "Put
// on board" can place a file where you'll see it, even from full Files where
// the canvas isn't mounted. Session memory only.
//
// A mounted canvas registers a live reader, so the answer follows the canvas
// as it narrows when the Files panel opens; the last value it reported is the
// answer once it's gone.
const live = new Map();
const last = new Map();

const valid = (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y);

export function setViewCenter(boardId, point) {
  if (!boardId || !valid(point)) return;
  last.set(boardId, { x: point.x, y: point.y });
}

// Returns the unregister function.
export function trackViewCenter(boardId, read) {
  if (!boardId || typeof read !== 'function') return () => {};
  live.set(boardId, read);
  return () => {
    if (live.get(boardId) === read) live.delete(boardId);
  };
}

export function getViewCenter(boardId) {
  if (!boardId) return null;
  const read = live.get(boardId);
  const now = read ? read() : null;
  if (valid(now)) {
    setViewCenter(boardId, now);
    return { x: now.x, y: now.y };
  }
  return last.get(boardId) || null;
}
