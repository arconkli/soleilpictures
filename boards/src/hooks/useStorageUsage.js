// useStorageUsage — fetches the caller's account storage usage from the
// my_storage_usage RPC (migration 0154). Sums live R2 bytes across all
// workspaces the caller OWNS and returns the configured quota.
//
// Returned shape: { used, quota, remaining, isPaid, loading, refetch }
// (bytes; quota/remaining null until the RPC resolves). Pass { enabled:false }
// to skip the fetch for tiers that don't have a quota (demo/waitlist).

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

export function useStorageUsage({ enabled = true } = {}) {
  const [data, setData] = useState({ used: 0, quota: null, remaining: null, isPaid: false });
  const [loading, setLoading] = useState(enabled);

  const fetchUsage = useCallback(async () => {
    if (!enabled || !supabase) { setLoading(false); return; }
    try {
      const { data: rows, error } = await supabase.rpc('my_storage_usage');
      if (error) throw error;
      const row = Array.isArray(rows) ? rows[0] : rows;
      setData({
        used:      Number(row?.used ?? 0),
        quota:     row?.quota != null ? Number(row.quota) : null,
        remaining: row?.remaining != null ? Number(row.remaining) : null,
        isPaid:    Boolean(row?.is_paid),
      });
    } catch (_) {
      /* leave defaults — the meter just won't render meaningful numbers */
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    fetchUsage();
  }, [enabled, fetchUsage]);

  return { ...data, loading, refetch: fetchUsage };
}
