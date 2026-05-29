// useAdminData — the one fetch pattern every admin tab shares.
//
// Before this hook each tab re-implemented loading/error/refetch by hand,
// with three recurring bugs: (1) errors wiped rows to [] so a network blip
// read as "no data"; (2) no refresh, so live KPIs went stale until a full
// page reload; (3) debounced search / filter changes raced, letting an
// out-of-order response win.
//
//   const { data, loading, error, refreshing, lastUpdated, refresh } =
//     useAdminData(async () => { ... return result }, [dep1, dep2]);
//
//  • Keeps the PRIOR data on a transient error (error stays distinct from
//    empty — callers gate empty on !loading && !error).
//  • Request-epoch guard: only the most recently *issued* request can write
//    state, so races resolve to the latest inputs, not the latest to return.
//  • `loading` is the first-load flag; `refreshing` is true for refetches
//    once data exists (lets tabs dim rather than blank on refresh).

import { useCallback, useEffect, useRef, useState } from 'react';

export function useAdminData(fetchFn, deps = [], opts = {}) {
  const { refetchOnFocus = false } = opts;

  const [data, setData]             = useState(undefined);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Always call the freshest fetchFn (callers pass an inline closure that
  // changes every render); `deps` controls *when* we refetch.
  const fnRef = useRef(fetchFn);
  useEffect(() => { fnRef.current = fetchFn; });

  const epochRef = useRef(0);
  const hasDataRef = useRef(false);

  const run = useCallback(async () => {
    const epoch = ++epochRef.current;
    if (hasDataRef.current) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current();
      if (epoch !== epochRef.current) return;          // a newer request superseded us
      setData(result);
      hasDataRef.current = true;
      setLastUpdated(Date.now());
    } catch (e) {
      if (epoch !== epochRef.current) return;
      setError(e?.message || String(e));               // keep prior data intact
    } finally {
      if (epoch === epochRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { run(); }, [run]);

  useEffect(() => {
    if (!refetchOnFocus) return undefined;
    const onFocus = () => { run(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refetchOnFocus, run]);

  return { data, loading, error, refreshing, lastUpdated, refresh: run };
}
