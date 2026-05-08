// Debounced hover-prefetch hook.
//
// Returns event handlers to spread onto a hoverable element. The
// `prefetcher` callback runs after `delay` ms of continuous hover (or
// focus). If the user leaves before the timer fires, nothing
// happens — so casual mouse-sweeps over a sidebar don't trigger
// fetches for every row.
//
// Delay: 80ms by default. This is well under the 250ms entity-link
// popover delay (so prefetch wins) but above typical mouse-sweep
// speed (~30ms per row when scanning a list).

import { useCallback, useEffect, useRef } from 'react';

const HOVER_DELAY = 80;

export function useHoverPrefetch(prefetcher, { delay = HOVER_DELAY } = {}) {
  const timer = useRef(null);
  const fnRef = useRef(prefetcher);
  // Keep the latest prefetcher in a ref so we don't churn the
  // memoized handlers on every render — pretty common to pass an
  // inline arrow function here.
  useEffect(() => { fnRef.current = prefetcher; }, [prefetcher]);

  const enter = useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      try { fnRef.current?.(); } catch (_) {}
    }, delay);
  }, [delay]);

  const leave = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  useEffect(() => () => leave(), [leave]);

  return {
    onMouseEnter: enter,
    onMouseLeave: leave,
    onFocus: enter,
    onBlur: leave,
  };
}
