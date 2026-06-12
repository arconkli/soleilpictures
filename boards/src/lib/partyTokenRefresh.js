// partyTokenRefresh.js — decides WHEN a party socket should run a cheap
// "refresh-connect" cycle (disconnect + connect on the SAME provider, which
// re-evaluates its async params/query and so bakes a fresh JWT into the
// socket URL — no provider destroy, no Y.Doc resync, no React churn).
//
// Pure + dependency-injected so the policy is unit-testable without a
// browser: callers hand in token getters, connection/gesture probes, the
// refresh action and (in tests) fake timers/clock.
//
// Policy:
//  - A cycle is considered only when the socket is NOT healthy. A live
//    connection keeps working on a rotated token (the party server validates
//    auth at the WebSocket upgrade only), so auth events on a healthy socket
//    are no-ops — the old destroy+rebuild on every TOKEN_REFRESHED/SIGNED_IN
//    pair was a full state resync + render burst that landed mid-gesture.
//  - The cycle fires only when the CURRENT session token differs from the
//    token baked into the socket's URL (getLastUsedToken). Same token =
//    network trouble, not auth — the provider's native backoff handles it.
//  - Debounced (TOKEN_REFRESHED + SIGNED_IN fire back-to-back within tens of
//    ms), cooled down (≥cooldownMs between cycles — a 401 loop re-triggers
//    on every close, so a skipped window self-heals on the next one),
//    deferred while a canvas gesture is active (bounded — after
//    maxGestureDeferMs it fires anyway), and sat out for resetSitOutMs after
//    a board-reset signal (that flow remounts the whole provider; piling a
//    cycle on top recreated the "closed before connection established"
//    storm).

export function createStaleTokenReconnector({
  getFreshToken,
  getLastUsedToken,
  isConnected,
  isGestureActive = () => false,
  refresh,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  debounceMs = 750,
  cooldownMs = 5000,
  gestureRetryMs = 250,
  maxGestureDeferMs = 1500,
  resetSitOutMs = 2000,
} = {}) {
  let disposed = false;
  let timer = null;
  let lastCycleAt = 0;
  let sitOutUntil = 0;
  let deferStartedAt = 0;

  const fire = async () => {
    timer = null;
    if (disposed) return;
    const t = now();
    if (t < sitOutUntil) return;
    if (isConnected()) return;                                 // healthy: nothing to do
    if (lastCycleAt && t - lastCycleAt < cooldownMs) return;   // next close re-triggers
    let fresh = '';
    try { fresh = (await getFreshToken()) || ''; } catch (_) { return; }
    if (disposed || !fresh) return;
    if (fresh === getLastUsedToken()) return;                  // not an auth problem
    if (isConnected()) return;                                 // reconnected while awaiting
    if (isGestureActive()) {
      if (!deferStartedAt) deferStartedAt = t;
      if (now() - deferStartedAt < maxGestureDeferMs) {
        timer = setTimer(fire, gestureRetryMs);                // let the gesture settle
        return;
      }
    }
    deferStartedAt = 0;
    lastCycleAt = now();
    refresh();
  };

  const schedule = () => {
    if (disposed || timer) return;
    deferStartedAt = 0;
    timer = setTimer(fire, debounceMs);
  };

  return {
    onAuthEvent: schedule,
    onConnectionClose: schedule,
    noteResetSignal() { sitOutUntil = now() + resetSitOutMs; },
    dispose() { disposed = true; if (timer) { clearTimer(timer); timer = null; } },
  };
}
