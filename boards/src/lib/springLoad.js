// Spring-loaded folders, as in Finder: hold a dragged file or folder over a
// folder, the Back button or a step of the path, and after a moment Files goes
// there — still mid-drag, so you can let go in the place you sprang to.
//
// Two pieces, both free of React:
//   createSpring  the hold timer — one armed target at a time.
//   drag session  one internal drag (files or folders out of Files): who is
//                 listening, and whether it ended in a drop. It is needed
//                 because springing swaps the list under the pointer, so the
//                 tile the drag started on is unmounted and React's onDragEnd
//                 never fires. Native listeners on the source node and the
//                 window see the end instead.

export const SPRING_DELAY = 700;

// The hold timer. `onArm(key|null)` reports which target is armed, so the
// target can show it (a blink) — null once it fires or is let go of.
export function createSpring({
  delay = SPRING_DELAY,
  onArm = null,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
} = {}) {
  let armedKey = null;
  let timer = null;
  const disarm = () => {
    if (timer != null) clearTimer(timer);
    timer = null;
    if (armedKey != null) { armedKey = null; onArm?.(null); }
  };
  return {
    // Arm `key`; `fire` runs if the drag is still over it after `delay`. A
    // second enter on the same key (dragover repeats) keeps the first timer.
    enter(key, fire) {
      if (armedKey === key) return;
      disarm();
      armedKey = key;
      onArm?.(key);
      timer = setTimer(() => {
        timer = null;
        armedKey = null;
        onArm?.(null);
        fire?.();
      }, delay);
    },
    leave(key) { if (armedKey === key) disarm(); },
    cancel: disarm,
    get armed() { return armedKey; },
  };
}

// ── The drag session ─────────────────────────────────────────────────────
const listeners = new Set();
let session = null;

export function onDragSession(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function dragSession() { return session; }

// At dragstart. `sourceEl` is the node the drag started on; `info` says what
// is being dragged ({ kind: 'files' | 'folders', sourceBoardId }).
export function beginDragSession(sourceEl, info = {}, win = (typeof window !== 'undefined' ? window : null)) {
  if (session) endDragSession(false);
  const s = { ...info, dropped: false, cleanup: null };
  session = s;
  const end = () => { if (session === s) endDragSession(s.dropped); };
  // A drop runs the target's own handler first (bubble phase), then the
  // session ends — so the handler still sees the drag as live.
  const onDrop = () => { s.dropped = true; setTimeout(end, 0); };
  // Mouse events are held for the whole of an HTML5 drag: the first one after
  // it is proof it ended, even when the source node — and its dragend — went.
  const onMove = () => end();
  try { sourceEl?.addEventListener?.('dragend', end); } catch (_) {}
  win?.addEventListener?.('drop', onDrop, true);
  win?.addEventListener?.('dragend', end, true);
  win?.addEventListener?.('mousemove', onMove, true);
  win?.addEventListener?.('pointermove', onMove, true);
  s.cleanup = () => {
    try { sourceEl?.removeEventListener?.('dragend', end); } catch (_) {}
    win?.removeEventListener?.('drop', onDrop, true);
    win?.removeEventListener?.('dragend', end, true);
    win?.removeEventListener?.('mousemove', onMove, true);
    win?.removeEventListener?.('pointermove', onMove, true);
  };
  listeners.forEach((fn) => { try { fn({ type: 'start', session: s }); } catch (_) {} });
  return s;
}

export function endDragSession(dropped = false, win = (typeof window !== 'undefined' ? window : null)) {
  const s = session;
  if (!s) return;
  session = null;
  try { s.cleanup?.(); } catch (_) {}
  // The side channels dragover reads (ListSurface, CanvasSurface) end with it.
  try { if (win) { win.__soleilFilesDrag = null; win.__soleilBoardDrag = null; } } catch (_) {}
  listeners.forEach((fn) => { try { fn({ type: 'end', dropped: !!dropped, session: s }); } catch (_) {} });
}
