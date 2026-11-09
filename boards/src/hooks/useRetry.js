import { useCallback, useEffect, useState } from 'react';

// `[tick, retry]`: a counter to put in an effect's deps, bumped by `retry()`.
// While `failed` is true it is also bumped once when the browser comes back
// online, so a read that failed offline tries again by itself.
export function useRetry(failed = false) {
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!failed || typeof window === 'undefined') return undefined;
    const onOnline = () => setTick((n) => n + 1);
    window.addEventListener('online', onOnline, { once: true });
    return () => window.removeEventListener('online', onOnline);
  }, [failed]);
  return [tick, retry];
}

export default useRetry;
