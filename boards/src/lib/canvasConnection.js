// Whether the open cluster's live room is reachable, for the canvas: the doc
// footer's save tracker (lib/docSaveStatus.js) read for the whole session of a
// board, and boiled down to what a tray or a card says about the connection.
//
//   state    live | offline | reconnecting | error, and `saved` for 3 s after one
//            of those three recovers (the room holds every change again)
//   pending  a change made here isn't proven stored yet
//   kept     this device holds a draft of the changes (doc._soleilKept)
//   live     the room's socket is open and synced
//   liveSince  ms it last became live, null while it isn't
//   everLive   the room has been live at least once this session (a first, slow
//              connect says "Connecting…" and is not a recovery)
//
// View-only and ended access are the doc footer's to say: they map to `live`.

import { acquireSaveTracker, saveLine } from './docSaveStatus.js';

export const RECOVERED_MS = 3000;   // how long `saved` shows after a recovery
const POLL_MS = 500;

const systemClock = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id),
};

const BAD = new Set(['offline', 'reconnecting', 'error']);
const FIELDS = ['state', 'pending', 'kept', 'live', 'liveSince', 'everLive'];

// `ydoc`: the cluster's Y.Doc; its `_soleilRoom` is the live room, which may
// come later and is replaced when useYBoard remounts. `win`, `isOnline`,
// `clock` and `acquire` are the parts a test replaces.
export function watchCanvasConnection({
  ydoc, boardId = null, onChange = null, clock = systemClock,
  win = typeof window !== 'undefined' ? window : null,
  isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  acquire = acquireSaveTracker,
} = {}) {
  const { tracker, release } = acquire(ydoc, { boardId });
  let online = isOnline();
  let wasBad = false;
  let recoveredUntil = 0;
  let recoverTimer = null;
  let pollTimer = null;
  let liveSince = null;
  let room = null;
  let disposed = false;
  let out = null;

  const compute = () => {
    const now = clock.now();
    const kept = ydoc?._soleilKept !== false;
    const line = saveLine(tracker.get(), { online, now, kept });
    const isLive = !!(room && room.wsconnected && room.synced);
    if (isLive) { if (liveSince == null) liveSince = now; } else liveSince = null;
    let state;
    if (BAD.has(line.state)) {
      state = line.state;
      // A slow first connect is not a trouble to recover from: it never ends in `saved`.
      const firstConnect = line.state === 'reconnecting' && !tracker.get().everLive;
      if (!firstConnect) wasBad = true;
      recoveredUntil = 0;
    } else {
      state = 'live';
      if (line.state === 'saved' && wasBad) {
        wasBad = false;
        recoveredUntil = now + RECOVERED_MS;
        recoverTimer = clock.set(() => { recoverTimer = null; update(); }, RECOVERED_MS);
      } else if (line.state === 'viewonly' || line.state === 'ended') {
        wasBad = false;
      }
      if (recoveredUntil > now) state = 'saved';
    }
    return { state, pending: !!tracker.get().pending, kept, live: isLive, liveSince, everLive: !!tracker.get().everLive };
  };
  function update() {
    if (disposed) return;
    const next = compute();
    const changed = !out || FIELDS.some((k) => out[k] !== next[k]);
    out = next;
    if (changed) onChange?.(out);
  }

  // The room may not exist yet, and a remount replaces it.
  const pollRoom = () => {
    const r = ydoc?._soleilRoom || null;
    if (r && r !== room) { room = r; tracker.setRoom(r); }
    update();
  };
  const poll = () => { pollTimer = clock.set(() => { pollRoom(); poll(); }, POLL_MS); };

  const goOnline = () => { online = true; update(); };
  const goOffline = () => { online = false; update(); };
  win?.addEventListener?.('online', goOnline);
  win?.addEventListener?.('offline', goOffline);
  const unsub = tracker.subscribe(update);

  room = ydoc?._soleilRoom || null;
  if (room) tracker.setRoom(room);
  out = compute();   // the first state is read, not announced
  poll();

  return {
    get: () => out,
    dispose() {
      if (disposed) return;
      disposed = true;
      clock.clear(pollTimer);
      if (recoverTimer != null) clock.clear(recoverTimer);
      unsub();
      win?.removeEventListener?.('online', goOnline);
      win?.removeEventListener?.('offline', goOffline);
      release();
    },
  };
}
