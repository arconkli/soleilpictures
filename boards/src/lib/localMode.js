export function isLocalQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('local') === '1';
}

// Dev-only tier override for Playwright. Active ONLY in a DEV build with
// ?local=1 (same trust boundary as isLocalQaMode), so it can never affect a
// production build. Lets specs render the tier-gated pricing/billing surfaces
// deterministically without a live Supabase backend.
//
//   /pricing?local=1&tier=paid&plan=annual&cards=42&cancel=1
//
// Returns the same shape useMyTier exposes, or null when not overriding.
export function qaTierOverride() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  if (q.get('local') !== '1') return null;
  const tier = q.get('tier');
  if (!tier) return null;
  return {
    tier,
    demoCardCount:      Number(q.get('cards') ?? 0),
    subscriptionStatus: q.get('substatus') || (tier === 'paid' ? 'active' : null),
    currentPeriodEnd:   q.get('periodend') || null,
    cancelAtPeriodEnd:  q.get('cancel') === '1',
  };
}
