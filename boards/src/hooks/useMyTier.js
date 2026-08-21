// useMyTier — fetches the caller's tier + card count from the get_my_tier RPC.
//
// Returned shape:
//   { tier, demoCardCount, subscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd,
//     grantActive, grantExpiresAt, banned, bonusCardCredits, effectiveCardLimit,
//     loading, error, refetch, notePlaced }
//
// grantActive/grantExpiresAt describe an admin-issued complimentary paid grant
// (expiry null = no end date); banned is true for a suspended account.
//
// tier is one of 'admin' | 'paid' | 'demo' | 'waitlist' | null. While the
// initial fetch is in flight, `loading` is true and tier is null. After the
// fetch completes, callers can branch on tier to route or render different UI.
//
// ONE MODULE-SCOPE STORE, MANY HOOK INSTANCES. There are ~10 useMyTier call
// sites (App, UpgradeChip, TierRouter, PricingModal, Settings, …); they used
// to each hold private state, which produced three real bugs:
//   - notePlaced() fed only App's instance, so the Upgrade chip's meter (a
//     different instance) sat frozen at its mount/last-focus count all session
//     while the cap gate counted live;
//   - every instance registered its own window-focus listener → three-plus
//     identical get_my_tier RPCs on every focus;
//   - two overlapping fetches each subtracted the same `settled` delta —
//     the count transiently under-reported by 2× the unsettled cards and the
//     client gate over-admitted.
// All instances now read the same store: one fetch in flight at a time (a
// refetch requested mid-flight queues ONE trailing fetch so post-activation
// refetches never get served a stale response), one focus listener, one delta.
//
// `demoCardCount` is the server's count PLUS an optimistic local delta fed by
// notePlaced(). Without that delta the number only moved on mount and on window
// focus, so during an uninterrupted session it was stale within seconds — the
// cap gate read it, decided there was room, let the card into the Y.Doc, and the
// server trigger then refused the card_index write. The delta is a hint, not a
// source of truth — every fetch reconciles it and the server trigger remains
// the real ceiling.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { qaTierOverride } from '../lib/localMode.js';
import { DEMO_CARD_LIMIT } from '../lib/demoCardCap.js';

const EMPTY = Object.freeze({
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

const _store = {
  userId: null,
  data: EMPTY,
  placedDelta: 0,
  loading: true,
  error: null,
  inflight: null,
  refetchQueued: false,
  subs: new Set(),
};

function _emit() { for (const fn of _store.subs) fn(); }

function _reset(userId) {
  _store.userId = userId;
  _store.data = EMPTY;
  _store.placedDelta = 0;
  _store.loading = Boolean(userId);
  _store.error = null;
  _store.refetchQueued = false;
  // an in-flight fetch for the previous user resolves into a store that has
  // moved on; its writes are discarded by the userId check in _fetchTier.
  _emit();
}

async function _fetchTier() {
  if (!supabase || !_store.userId) { _store.loading = false; _emit(); return; }
  if (_store.inflight) {
    // A refetch requested mid-flight must produce FRESHER data than the
    // request already running (e.g. the post-activation refetch racing the
    // mount fetch) — queue exactly one trailing fetch.
    _store.refetchQueued = true;
    return _store.inflight;
  }
  const forUser = _store.userId;
  // Anything placed while this request is in flight must survive the
  // reconciliation — the RPC counts card_index, which the throttled sync
  // populates seconds later, so a mid-flight card is in neither number yet.
  const settled = _store.placedDelta;
  _store.inflight = (async () => {
    try {
      const { data: rows, error } = await supabase.rpc('get_my_tier');
      if (error) throw error;
      if (_store.userId !== forUser) return;   // user switched mid-flight
      const row = Array.isArray(rows) ? rows[0] : rows;
      _store.data = {
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
      };
      _store.placedDelta -= settled;
      _store.error = null;
    } catch (e) {
      if (_store.userId === forUser) _store.error = e?.message || String(e);
    } finally {
      _store.inflight = null;
      if (_store.userId === forUser) _store.loading = false;
      _emit();
      if (_store.refetchQueued) {
        _store.refetchQueued = false;
        _fetchTier();
      }
    }
  })();
  return _store.inflight;
}

function _notePlaced(n = 1) {
  const k = Number(n) || 0;
  if (!k) return;
  _store.placedDelta += k;
  _emit();
}

// One focus listener for the whole app (attached while anyone subscribes) —
// re-fetch on focus so a tier flip from the Stripe webhook or waitlist cron
// is picked up without a manual reload.
let _focusAttached = false;
function _onFocus() { if (_store.userId) _fetchTier(); }
function _syncFocusListener() {
  const want = _store.subs.size > 0;
  if (want && !_focusAttached) { window.addEventListener('focus', _onFocus); _focusAttached = true; }
  if (!want && _focusAttached) { window.removeEventListener('focus', _onFocus); _focusAttached = false; }
}

export function useMyTier({ userId } = {}) {
  // Dev/Playwright-only forced tier (no-op in production builds). Computed once.
  // Override instances still share the store's placedDelta so the local
  // harness's cap flows see counts move.
  const [override] = useState(qaTierOverride);
  const [, force] = useState(0);

  useEffect(() => {
    const fn = () => force((v) => v + 1);
    _store.subs.add(fn);
    _syncFocusListener();
    return () => {
      _store.subs.delete(fn);
      _syncFocusListener();
    };
  }, []);

  useEffect(() => {
    if (override) return;
    const uid = userId || null;
    if (_store.userId !== uid) {
      _reset(uid);
      if (uid) _fetchTier();
    } else if (uid && _store.data === EMPTY && !_store.inflight) {
      _fetchTier();
    }
  }, [override, userId]);

  const refetch = useCallback(() => { if (!override) return _fetchTier(); }, [override]);

  const base = override || _store.data;
  const loading = override ? false : _store.loading;
  const error = override ? null : _store.error;

  // Clamp at zero: a delete can only ever take the count back to the server's
  // floor, never below it. Deletes that the server has already reflected would
  // otherwise subtract twice and hand back cap room that doesn't exist.
  const demoCardCount = Math.max(0, Number(base.demoCardCount || 0) + _store.placedDelta);

  return { ...base, demoCardCount, loading, error, refetch, notePlaced: _notePlaced };
}
