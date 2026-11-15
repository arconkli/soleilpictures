// idlePrefetch.js — download lazy chunks while the page is idle, so the first
// click on a tab does not wait for its code. One loader per idle slot, in
// order, so a burst of imports never lands on top of the first paint. Pure and
// node-testable: the window is passed in.
//
//   useEffect(() => idlePrefetch([loadUsers, loadGrants]), []);   // returns the cancel

/**
 * @param {Array<() => Promise<unknown>>} loaders  each starts one import()
 * @returns {() => void} cancel: nothing further starts after it is called
 */
export function idlePrefetch(loaders, { win = globalThis, timeout = 2000, fallbackMs = 200 } = {}) {
  const queue = (loaders || []).filter((l) => typeof l === 'function');
  let cancelled = false;
  let handle = null;
  const useIdle = typeof win?.requestIdleCallback === 'function';

  const schedule = () => {
    if (cancelled || !queue.length) return;
    handle = useIdle
      ? win.requestIdleCallback(step, { timeout })
      : win.setTimeout(step, fallbackMs);
  };
  function step() {
    handle = null;
    if (cancelled) return;
    const load = queue.shift();
    let p;
    // A failed prefetch is not an error: opening the tab tries again, and that
    // path owns the stale-deploy reload.
    try { p = load(); } catch { p = null; }
    Promise.resolve(p).then(schedule, schedule);
  }
  schedule();

  return () => {
    cancelled = true;
    if (handle == null) return;
    try {
      if (useIdle && typeof win.cancelIdleCallback === 'function') win.cancelIdleCallback(handle);
      else win.clearTimeout(handle);
    } catch { /* nothing to cancel */ }
    handle = null;
  };
}
