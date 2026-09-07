// castAwareness — show the cast to the presence layer, and to nobody else.
//
// A read-side proxy over the real y-awareness. getStates() returns the real
// peers UNION the synthetic ones; everything else falls through. It satisfies
// the same small contract as presenceQa.js's makeFakeAwareness — getStates(),
// meta.get(id).lastUpdated, on/off('change') — which is deliberate: those are
// exactly the four things CanvasPresence touches, and pinning both shims to one
// contract means a change to the presence layer breaks both together rather
// than leaving this one quietly wrong.
//
// ── Why synthetic peers cannot escape ──────────────────────────────────────
// setLocalStateField is forwarded to the real awareness UNCHANGED, and nothing
// here ever writes a synthetic state into it. The cast exists only in the value
// returned by getStates(). So there is no code path by which a fake
// collaborator reaches the network — not "we remember not to", but "there is no
// call that would".
//
// This proxy is handed ONLY to CanvasPresence and PresenceStack. The note
// editor gives the real awareness object to TipTap's CollaborationCursor, which
// needs far more of the Yjs Awareness surface than this implements, so a global
// swap would break collaborative typing.

// Synthetic peers don't fire awareness events, so the proxy runs its own clock.
// ~10Hz: fast enough for LiveCursor's Catmull-Rom interpolator (80ms render
// delay) to smooth into continuous motion, slow enough to be nothing.
const TICK_MS = 100;

// `realAwareness` may be null: the room may not have connected yet, and the
// offline harness has no awareness at all. The cast still renders in both
// cases, which is what you want — a shot should not depend on a socket — and
// every real call below is null-safe rather than guarded once at the top.
export function makeCastAwareness(realAwareness, getSyntheticStates) {
  const real = realAwareness || null;
  const listeners = new Set();
  let timer = null;

  const emit = () => {
    for (const fn of [...listeners]) {
      try { fn(); } catch (_) { /* one bad listener must not stop the others */ }
    }
  };

  const start = () => {
    if (timer || typeof setInterval !== 'function') return;
    timer = setInterval(emit, TICK_MS);
  };
  const stop = () => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  };

  // Synthetic clientIds are far outside y-awareness's range, so a real peer can
  // never be shadowed by a fake one. Real states are written LAST regardless,
  // so if that assumption ever broke, the real person still wins.
  const proxy = {
    get clientID() { return real?.clientID ?? 0; },

    getStates() {
      const merged = new Map();
      let synthetic = [];
      try { synthetic = getSyntheticStates?.() || []; } catch (_) { synthetic = []; }
      for (const s of synthetic) merged.set(s.clientId, s.state);
      const live = real?.getStates?.();
      if (live) for (const [id, state] of live) merged.set(id, state);
      return merged;
    },

    // CanvasPresence reads meta to pick the freshest entry per user id. A
    // synthetic peer is always "just updated" so it never ages out of the
    // grace window; anything else falls through to the real meta.
    meta: {
      get(clientId) {
        const m = real?.meta?.get?.(clientId);
        if (m) return m;
        return { lastUpdated: Date.now() };
      },
    },

    on(event, fn) {
      real?.on?.(event, fn);
      if (event === 'change') { listeners.add(fn); start(); }
    },
    off(event, fn) {
      real?.off?.(event, fn);
      if (event === 'change') {
        listeners.delete(fn);
        if (!listeners.size) stop();
      }
    },

    // Write paths are pass-through. The cast is never written into them.
    setLocalStateField(...args) { return real?.setLocalStateField?.(...args); },
    setLocalState(...args) { return real?.setLocalState?.(...args); },
    getLocalState() { return real?.getLocalState?.(); },

    // For teardown when capture ends mid-session.
    destroy() { stop(); listeners.clear(); },
  };

  return proxy;
}

export { TICK_MS };
