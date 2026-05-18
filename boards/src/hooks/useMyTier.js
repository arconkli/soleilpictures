// useMyTier — fetches the caller's tier + card count from the get_my_tier RPC.
//
// Returned shape:
//   { tier, demoCardCount, subscriptionStatus, currentPeriodEnd, loading, error, refetch }
//
// tier is one of 'admin' | 'paid' | 'demo' | 'waitlist' | null. While the
// initial fetch is in flight, `loading` is true and tier is null. After the
// fetch completes, callers can branch on tier to route or render different UI.
//
// The Upgrade chip + cap-block logic in App.jsx subscribes to this for live
// counts; it also re-fetches on window focus to catch async tier flips from
// the Stripe webhook or waitlist cron.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

export function useMyTier({ userId } = {}) {
  const [data, setData] = useState({
    tier: null,
    demoCardCount: 0,
    subscriptionStatus: null,
    currentPeriodEnd: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchTier = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    try {
      const { data: rows, error } = await supabase.rpc('get_my_tier');
      if (error) throw error;
      const row = Array.isArray(rows) ? rows[0] : rows;
      setData({
        tier:               row?.tier || null,
        demoCardCount:      Number(row?.demo_card_count ?? 0),
        subscriptionStatus: row?.subscription_status || null,
        currentPeriodEnd:   row?.current_period_end || null,
      });
      setError(null);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    fetchTier();
  }, [userId, fetchTier]);

  // Re-fetch on focus so a tier flip from the Stripe webhook or
  // waitlist cron is picked up without a manual reload.
  useEffect(() => {
    if (!userId) return;
    const onFocus = () => fetchTier();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [userId, fetchTier]);

  return { ...data, loading, error, refetch: fetchTier };
}
