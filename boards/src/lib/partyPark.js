// Let a hidden tab put its party sockets down, and pick them up when it is
// shown again.
//
// A party room is a Cloudflare Durable Object, billed for every second a
// socket is connected to it, whether or not anyone is looking. A tab left open
// in the background held its board's room and its workspace's presence room
// all night. After PARK_AFTER_MS hidden, the tab disconnects; the moment it is
// shown it reconnects. Nothing is lost by it: the board's Y.Doc stays in
// memory, so the reconnect is the usual state-vector exchange (whatever
// changed on either side while apart), and presence shows the person as gone,
// which a tab nobody is looking at is.
//
// Only a page that BECOMES hidden starts the clock. A handle created in a tab
// that is already hidden (a folder import writing into a cluster in the
// background) stays connected until the tab has been shown and hidden again.

export const PARK_AFTER_MS = 5 * 60_000;

// park(): drop the connection. unpark(): take it back. Returns
// { isParked(), dispose() }.
export function parkWhileHidden({
  park, unpark, afterMs = PARK_AFTER_MS,
  doc = typeof document !== 'undefined' ? document : null,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t),
}) {
  if (!doc || typeof doc.addEventListener !== 'function') {
    return { isParked: () => false, dispose() {} };
  }
  let parked = false;
  let timer = null;
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') {
      if (timer) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        if (doc.visibilityState !== 'hidden' || parked) return;
        parked = true;
        try { park(); } catch (_) { /* the socket may already be gone */ }
      }, afterMs);
    } else {
      if (timer) { clearTimer(timer); timer = null; }
      if (!parked) return;
      parked = false;
      try { unpark(); } catch (_) { /* the next reconnect tries again */ }
    }
  };
  doc.addEventListener('visibilitychange', onVisibility);
  return {
    isParked: () => parked,
    dispose() {
      if (timer) { clearTimer(timer); timer = null; }
      try { doc.removeEventListener('visibilitychange', onVisibility); } catch (_) {}
    },
  };
}
