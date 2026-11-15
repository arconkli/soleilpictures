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
//  • `hasData` is true when `data` came from the CURRENT deps. Pass it to
//    AdminAsync so a failed background refresh keeps the view on screen under
//    a "couldn't refresh" strip. It is false after a filter change until the
//    new read lands, so a failed switch to 90 days never shows the 30-day data
//    under a 90-day label.
//  • fetchFn is called with { fresh }: true only when the person pressed a
//    refresh button (`refreshFresh`). First loads, the poll, the focus refetch
//    and Retry (`refresh`) pass false, so they may take the server's shared
//    ten-minute result for the heavy reports (lib/adminReport.js).
//  • `keep: { uid, key, save }` paints the numbers from the last visit at once
//    (lib/adminSnapshot.js) while the read runs: `stale` is true until fresh
//    numbers land, and stays true when the read fails, with `error` set, so
//    the "couldn't refresh" strip shows over them. `key` names every input
//    that changes the numbers; `save(result)` is what is stored, with anything
//    personal taken out. Without `keep` nothing here changes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readSnap, writeSnap } from '../../lib/adminSnapshot.js';
import { keepOf } from '../../lib/adminKeep.js';

export function useAdminData(fetchFn, deps = [], opts = {}) {
  const { refetchOnFocus = false, pollIntervalMs = null } = opts;
  const keep = keepOf(opts.keep);

  // A new key whenever deps change: what `hasData` compares the data's key to.
  const depsSeqRef = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const depsKey = useMemo(() => ++depsSeqRef.current, deps);

  // The last visit's numbers for these inputs, read once, before the first
  // paint. null without `keep`, and when nothing was kept.
  const [seed] = useState(() => (keep ? readSnap(keep.uid, keep.key) : null));

  const [data, setData]             = useState(seed ? seed.data : undefined);
  const [loading, setLoading]       = useState(!seed);
  const [refreshing, setRefreshing] = useState(!!seed);
  const [error, setError]           = useState(null);
  const [lastUpdated, setLastUpdated] = useState(seed ? seed.at : null);
  const [dataKey, setDataKey]       = useState(seed ? depsKey : 0);
  const [stale, setStale]           = useState(!!seed);

  // Always call the freshest fetchFn (callers pass an inline closure that
  // changes every render); `deps` controls *when* we refetch.
  const fnRef = useRef(fetchFn);
  const keepRef = useRef(keep);
  useEffect(() => { fnRef.current = fetchFn; keepRef.current = keep; });

  const epochRef = useRef(0);
  const hasDataRef = useRef(!!seed);
  const lastRunAtRef = useRef(0);
  // The deps key of what is on screen, fresh numbers or a snapshot.
  const shownKeyRef = useRef(seed ? depsKey : 0);

  const run = useCallback(async (fresh = false) => {
    const epoch = ++epochRef.current;
    lastRunAtRef.current = Date.now();
    // The snapshot is saved under the key the inputs had when the read began.
    const kept = keepRef.current;
    // New inputs with nothing of their own on screen: the last visit's numbers
    // for them, if any were kept. Otherwise the view waits as it always did.
    if (kept && shownKeyRef.current !== depsKey) {
      const snap = readSnap(kept.uid, kept.key);
      if (snap) {
        setData(snap.data);
        setDataKey(depsKey);
        setLastUpdated(snap.at);
        shownKeyRef.current = depsKey;
        hasDataRef.current = true;
      }
      setStale(!!snap);
    }
    if (hasDataRef.current) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const result = await fnRef.current({ fresh });
      if (epoch !== epochRef.current) return;          // a newer request superseded us
      setData(result);
      setDataKey(depsKey);
      shownKeyRef.current = depsKey;
      hasDataRef.current = true;
      setLastUpdated(Date.now());
      setStale(false);
      if (kept) {
        // Keeping the numbers is a convenience: a save that fails never fails the read.
        try { writeSnap(kept.uid, kept.key, kept.save ? kept.save(result) : result); } catch { /* not kept */ }
      }
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

  // Unmounted (signing out, leaving the view): a read still out must not save
  // a snapshot or set state, so it counts as superseded.
  useEffect(() => () => { epochRef.current += 1; }, []);

  useEffect(() => { run(); }, [run]);

  // `refresh` is handed to onClick and onRetry, which call it with an event, so
  // it takes no argument. Only `refreshFresh` asks for newly computed numbers.
  const refresh = useCallback(() => run(false), [run]);
  const refreshFresh = useCallback(() => run(true), [run]);

  // Refetch when the operator comes back to the tab — but not more often than
  // the poll would have. Without the floor, alt-tabbing replayed the whole
  // view on every focus event: on Overview that is nine multi-second RPCs, on
  // demand, as fast as you can switch windows.
  useEffect(() => {
    if (!refetchOnFocus) return undefined;
    const floor = pollIntervalMs || 30_000;
    const onFocus = () => {
      if (Date.now() - lastRunAtRef.current < floor) return;
      run();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refetchOnFocus, pollIntervalMs, run]);

  // Optional periodic auto-refresh (live dashboards). Pauses while the tab is
  // hidden so a backgrounded wall display doesn't hammer the API; fires once on
  // return to foreground via the same interval cadence.
  useEffect(() => {
    if (!pollIntervalMs) return undefined;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      run();
    }, pollIntervalMs);
    return () => clearInterval(id);
  }, [pollIntervalMs, run]);

  const hasData = data !== undefined && dataKey === depsKey;
  return { data, loading, error, refreshing, lastUpdated, hasData, stale, refresh, refreshFresh };
}
