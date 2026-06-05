export function isLocalQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('local') === '1';
}

// Dev-only admin preview harness. Active ONLY in a DEV build with
// ?adminpreview=1 (same trust boundary as isLocalQaMode / isDocQaMode) so it can
// never affect a production build. Renders the real admin tab components with
// fixture data and no auth, so the admin UI can be screenshotted + iterated on
// visually without logging in. See ../local/AdminPreviewHarness.jsx.
export function isAdminPreviewMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('adminpreview') === '1';
}

// Dev-only doc QA harness. Active ONLY in a DEV build with ?docqa=1 (same
// trust boundary as isLocalQaMode) so it can never affect a production build.
// Mounts the real RichDocCard/DocSurface against an in-memory Y.Doc — no
// Supabase / PartyKit — so Playwright can drive real doc behaviour. Kept
// separate from ?local=1 so the existing local-mode specs are untouched.
export function isDocQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('docqa') === '1';
}

// Dev-only drag-and-drop QA bridge. Active ONLY in a DEV build with ?dndqa=1.
// Publishes the PURE drag/drop logic helpers (boardTree cycle/plan, canvas
// clamp, dragMimes coercion) on window.__soleilDndTest so Playwright logic
// specs can exercise them directly — no UI, no backend.
export function isDndQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('dndqa') === '1';
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
    // ?adoffer=1 renders the ad-sourced price-first AdWelcome screen
    // (what a Facebook/Instagram ad click sees) — e.g.
    //   /?local=1&tier=demo&adoffer=1
    adOfferPending:     q.get('adoffer') === '1',
    // First-run onboarding. Default ({seeded:false,done:false}) triggers the
    // starter-card seed + coachmark, so /?local=1&tier=demo exercises first-run.
    // &onboarded=1 simulates a user who already finished onboarding.
    onboarding: {
      seeded: q.get('seeded') === '1',
      done:   q.get('onboarded') === '1',
    },
  };
}
