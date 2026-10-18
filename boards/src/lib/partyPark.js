// Let a tab nobody is using put its party sockets down, and pick them up the
// moment it is used again.
//
// A party room is a Cloudflare Durable Object, billed for every second a
// socket is connected to it, whether or not anyone is looking. A tab left open
// in the background held its board's room and its workspace's presence room
// all night. Nothing is lost by letting go: the board's Y.Doc stays in memory,
// so taking the room back is the usual state-vector exchange (whatever changed
// on either side while apart), and presence shows the person as gone, which a
// tab nobody is using is.
//
// parkWhileHidden — after PARK_AFTER_MS hidden, the tab disconnects; shown, it
// reconnects. A page that LOADS hidden starts the clock too: a tab opened in
// the background, a restored session, and buildWatch's own reload of a hidden
// tab all used to stay connected until someone happened to look at them
// (2026-10-18: three such tabs held rooms for most of the day's room time).
//
// parkWhileIdle — a visible tab with no input for IDLE_PARK_MS, on a board
// where nothing has arrived from anyone else for as long, lets go of its board
// room; the next pointer, key, wheel, touch or focus takes it back. A tab
// watching someone else work stays connected for as long as they do.
//
// Neither parks while isBusy(): work a disconnect would hold up — a folder
// import writing into a cluster from this tab, an upload on the wire
// (buildWatch.js pageBusy). They look again later instead.

export const PARK_AFTER_MS = 5 * 60_000;
export const IDLE_PARK_MS = 15 * 60_000;
export const IDLE_CHECK_MS = 60_000;

function busyNow(isBusy) {
  try { return !!isBusy(); } catch (_) { return false; }
}

// park(): drop the connection. unpark(): take it back. Returns
// { isParked(), dispose() }.
export function parkWhileHidden({
  park, unpark, afterMs = PARK_AFTER_MS, isBusy = () => false,
  doc = typeof document !== 'undefined' ? document : null,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (t) => clearTimeout(t),
}) {
  if (!doc || typeof doc.addEventListener !== 'function') {
    return { isParked: () => false, dispose() {} };
  }
  let parked = false;
  let timer = null;
  const arm = () => {
    if (timer) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      if (doc.visibilityState !== 'hidden' || parked) return;
      if (busyNow(isBusy)) { arm(); return; }
      parked = true;
      try { park(); } catch (_) { /* the socket may already be gone */ }
    }, afterMs);
  };
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') {
      arm();
    } else {
      if (timer) { clearTimer(timer); timer = null; }
      if (!parked) return;
      parked = false;
      try { unpark(); } catch (_) { /* the next reconnect tries again */ }
    }
  };
  doc.addEventListener('visibilitychange', onVisibility);
  if (doc.visibilityState === 'hidden') arm();
  return {
    isParked: () => parked,
    dispose() {
      if (timer) { clearTimer(timer); timer = null; }
      try { doc.removeEventListener('visibilitychange', onVisibility); } catch (_) {}
    },
  };
}

// Is a visible, unused tab due to let go? Pure, for the tests.
export function idleParkDue({ now, lastInputAt, lastRemoteAt, afterMs = IDLE_PARK_MS }) {
  return now - Math.max(Number(lastInputAt) || 0, Number(lastRemoteAt) || 0) >= afterMs;
}

const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus'];

// park(): drop the connection. unpark(): take it back. The caller reports
// activity from others with noteRemote() (a remote Y.Doc update or awareness
// change). Returns { noteRemote(), isParked(), dispose() }.
export function parkWhileIdle({
  park, unpark, isBusy = () => false,
  afterMs = IDLE_PARK_MS, checkMs = IDLE_CHECK_MS,
  win = typeof window !== 'undefined' ? window : null,
  doc = typeof document !== 'undefined' ? document : null,
  now = () => Date.now(),
  setTick = (fn, ms) => setInterval(fn, ms), clearTick = (t) => clearInterval(t),
}) {
  if (!win || typeof win.addEventListener !== 'function' || !doc) {
    return { noteRemote() {}, isParked: () => false, dispose() {} };
  }
  let parked = false;
  let lastInputAt = now();
  let lastRemoteAt = 0;
  const onInput = () => {
    lastInputAt = now();
    if (!parked) return;
    parked = false;
    try { unpark(); } catch (_) { /* the next reconnect tries again */ }
  };
  const onVisibility = () => { if (doc.visibilityState !== 'hidden') onInput(); };
  const opts = { capture: true, passive: true };
  for (const ev of INPUT_EVENTS) win.addEventListener(ev, onInput, opts);
  doc.addEventListener('visibilitychange', onVisibility);
  const tick = setTick(() => {
    if (parked || doc.visibilityState === 'hidden') return;   // hidden is parkWhileHidden's
    if (!idleParkDue({ now: now(), lastInputAt, lastRemoteAt, afterMs })) return;
    if (busyNow(isBusy)) return;
    parked = true;
    try { park(); } catch (_) { /* the socket may already be gone */ }
  }, checkMs);
  return {
    noteRemote() { lastRemoteAt = now(); },
    isParked: () => parked,
    dispose() {
      clearTick(tick);
      for (const ev of INPUT_EVENTS) {
        try { win.removeEventListener(ev, onInput, opts); } catch (_) {}
      }
      try { doc.removeEventListener('visibilitychange', onVisibility); } catch (_) {}
    },
  };
}
