// A minimum gap between the runs a tab return sets off. Returning to the tab
// (focus, visibilitychange) fires often; a run that went less than the gap ago
// has nothing new to fetch. The first call always goes. Only tab-return calls
// go through a gate: the initial load and timers never do.

export const TAB_RETURN_MIN_GAP_MS = 60_000;

export function makeTabReturnGate(minGapMs = TAB_RETURN_MIN_GAP_MS, now = () => Date.now()) {
  let last = null;
  return function mayRun() {
    const t = now();
    if (last !== null && t - last < minGapMs) return false;
    last = t;
    return true;
  };
}
