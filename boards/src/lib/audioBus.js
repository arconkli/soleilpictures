// Module-level singleton so only one audio card plays at a time across the
// board. Each AudioCard calls claim(stopFn) on play and release(stopFn) on
// pause/end/unmount. Starting a new card invokes the previous owner's stopFn,
// which pauses its <audio> element. (This comment used to say "wavesurfer
// instance" — there has never been a wavesurfer in this repo.)
//
// The bus also carries a small CONTROL REGISTRY, because auditioning a pack
// means driving the transport from OUTSIDE the card: a list row's play button,
// a keyboard shortcut on the canvas, and auto-advance when a loop ends. Passing
// signal props down (the editFieldSignal pattern) does not work for those —
// they need to reach a card that may not even be the one you are hovering.

let active = null;          // the current stopFn
let activeCardId = null;    // which card owns playback
let activeSource = null;    // 'canvas' | 'list' — where the audition started
const controlsById = new Map();
const endedListeners = new Set();

// `meta` is optional so the original two-argument-free call site still works.
export function claim(stopFn, { cardId = null, source = null } = {}) {
  if (active && active !== stopFn) {
    try { active(); } catch (_) {}
  }
  active = stopFn;
  activeCardId = cardId;
  activeSource = source;
}

export function release(stopFn) {
  if (active === stopFn) {
    active = null;
    activeCardId = null;
    activeSource = null;
  }
}

// ── Control registry ────────────────────────────────────────────────────────

// An AudioCard registers { toggle, play, pause, seek, isPlaying } on mount.
export function register(cardId, controls) {
  if (!cardId || !controls) return;
  controlsById.set(cardId, controls);
}

export function unregister(cardId) {
  if (cardId) controlsById.delete(cardId);
}

export function controls(cardId) {
  return (cardId && controlsById.get(cardId)) || null;
}

export function playingCardId() {
  return activeCardId;
}

// ── Ended ───────────────────────────────────────────────────────────────────

// Auto-advance subscribes here. The `source` is what keeps it correct: a card
// started by clicking it on the CANVAS must not make the list jump to its next
// row, because the person is not looking at the list.
export function notifyEnded(cardId) {
  const payload = { cardId, source: activeSource };
  for (const fn of Array.from(endedListeners)) {
    try { fn(payload); } catch (_) {}
  }
}

export function onEnded(fn) {
  if (typeof fn === 'function') endedListeners.add(fn);
  return () => endedListeners.delete(fn);
}
