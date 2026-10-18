// useStorageUsage — fetches the caller's account storage usage from the
// my_storage_usage RPC: what counts toward the drive across every workspace
// the caller OWNS (0411 — files a cluster uses, or that were never placed),
// plus uploads in flight, against the caller's OWN quota (free, trial or
// Creator, 0413) — the same numbers the upload gates decide on.
//
// Returned shape: { used, quota, remaining, isPaid, loading, error, refetch }
// (bytes; quota/remaining null until the RPC resolves). `error` is true when
// the last fetch failed, so a meter can say so instead of drawing the
// defaults as if they were real ("0 B / —"). Pass { enabled:false }
// to skip the fetch where no number will be shown.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

export function useStorageUsage({ enabled = true } = {}) {
  const [data, setData] = useState({ used: 0, quota: null, remaining: null, isPaid: false });
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);

  const fetchUsage = useCallback(async () => {
    if (!enabled || !supabase) { setLoading(false); return; }
    setError(false);
    setLoading(true);
    try {
      const { data: rows, error: rpcError } = await supabase.rpc('my_storage_usage');
      if (rpcError) throw rpcError;
      const row = Array.isArray(rows) ? rows[0] : rows;
      setData({
        used:      Number(row?.used ?? 0),
        quota:     row?.quota != null ? Number(row.quota) : null,
        remaining: row?.remaining != null ? Number(row.remaining) : null,
        isPaid:    Boolean(row?.is_paid),
      });
    } catch (_) {
      // Keep the last good numbers (if any) but flag the failure.
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    fetchUsage();
  }, [enabled, fetchUsage]);

  return { ...data, loading, error, refetch: fetchUsage };
}
