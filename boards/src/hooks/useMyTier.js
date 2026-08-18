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
//
// `demoCardCount` is the server's count PLUS an optimistic local delta fed by
// notePlaced(). Without that delta the number only moved on mount and on window
// focus, so during an uninterrupted session it was stale within seconds — the
// cap gate read it, decided there was room, let the card into the Y.Doc, and the
// server trigger then refused the card_index write. In the telemetry the server
// does the blocking far more often than the client does, which is precisely
// backwards: the client gate exists to refuse a card BEFORE it is drawn. The
// delta is a hint, not a source of truth — every fetch reconciles it and the
// server trigger remains the real ceiling.

import { useCallback, useEffect, useRef, useState } from 'react';
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
    // (per-user since 0229: pre-0229 accounts are grandfathered at 100, new ones
    // start at DEMO_CARD_LIMIT). The cap gates and the Upgrade pill read it.
    // This is a PLACEHOLDER only — `tier` is null until the RPC lands, and every
    // consumer gates on a resolved tier, so a grandfathered user never flashes
    // the new-account number.
    bonusCardCredits: 0,
    effectiveCardLimit: DEMO_CARD_LIMIT,
  });
  const [loading, setLoading] = useState(!override);
  const [error, setError] = useState(null);

  // Cards created (or removed) locally since the last successful fetch. State,
  // not a ref, so the Upgrade chip's meter moves as the user works instead of
  // sitting on a number from page load. The ref mirror lets the async fetch
  // read the value it is about to reconcile without re-creating itself.
  const [placedDelta, setPlacedDelta] = useState(0);
  const placedDeltaRef = useRef(0);
  placedDeltaRef.current = placedDelta;

  const notePlaced = useCallback((n = 1) => {
    const k = Number(n) || 0;
    if (!k) return;
    setPlacedDelta(d => d + k);
  }, []);

  const fetchTier = useCallback(async () => {
    if (override) { setLoading(false); return; }
    if (!supabase) { setLoading(false); return; }
    // Anything placed while this request is in flight must survive the
    // reconciliation — the RPC counts card_index, which the throttled sync
    // populates seconds later, so a mid-flight card is in neither number yet.
    const settled = placedDeltaRef.current;
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
      setPlacedDelta(d => d - settled);
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

  // Clamp at zero: a delete can only ever take the count back to the server's
  // floor, never below it. Deletes that the server has already reflected would
  // otherwise subtract twice and hand back cap room that doesn't exist.
  const demoCardCount = Math.max(0, Number(data.demoCardCount || 0) + placedDelta);

  return { ...data, demoCardCount, loading, error, refetch: fetchTier, notePlaced };
}
