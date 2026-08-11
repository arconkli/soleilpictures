// useMyTier — fetches the caller's tier + card count from the get_my_tier RPC.
//
// Returned shape:
//   { tier, demoCardCount, subscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd,
//     grantActive, grantExpiresAt, banned, bonusCardCredits, effectiveCardLimit,
//     loading, error, refetch }
//
// grantActive/grantExpiresAt describe an admin-issued complimentary paid grant
// (expiry null = no end date); banned is true for a suspended account.
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
import { qaTierOverride } from '../lib/localMode.js';
import { DEMO_CARD_LIMIT } from '../lib/demoCardCap.js';

export function useMyTier({ userId } = {}) {
  // Dev/Playwright-only forced tier (no-op in production builds). Computed once.
  const [override] = useState(qaTierOverride);
  const [data, setData] = useState(() => override || {
    tier: null,
    demoCardCount: 0,
    subscriptionStatus: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    grantActive: false,
    grantExpiresAt: null,
    banned: false,
    adOfferPending: false,
    onboarding: {},
    // The server returns effective_card_limit = card_cap_base + bonus_card_credits
    // (per-user since 0227: pre-0227 accounts are grandfathered at 100, new ones
    // start at DEMO_CARD_LIMIT). The cap gates and the Upgrade pill read it.
    // This is a PLACEHOLDER only — `tier` is null until the RPC lands, and every
    // consumer gates on a resolved tier, so a grandfathered user never flashes
    // the new-account number.
    bonusCardCredits: 0,
    effectiveCardLimit: DEMO_CARD_LIMIT,
  });
  const [loading, setLoading] = useState(!override);
  const [error, setError] = useState(null);

  const fetchTier = useCallback(async () => {
    if (override) { setLoading(false); return; }
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
        cancelAtPeriodEnd:  Boolean(row?.cancel_at_period_end),
        grantActive:        Boolean(row?.grant_active),
        grantExpiresAt:     row?.grant_expires_at || null,
        banned:             Boolean(row?.banned),
        adOfferPending:     Boolean(row?.ad_offer_pending),
        // First-run onboarding state { seeded, done } — drives the starter-card
        // seed + first-card coachmark in App.jsx. {} for users predating the flag.
        onboarding:         row?.onboarding || {},
        bonusCardCredits:   Number(row?.bonus_card_credits ?? 0),
        effectiveCardLimit: Number(row?.effective_card_limit ?? DEMO_CARD_LIMIT),
      });
      setError(null);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [override]);

  useEffect(() => {
    if (override) { setLoading(false); return; }
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    fetchTier();
  }, [override, userId, fetchTier]);

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
