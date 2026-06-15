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

// Dev-only board-thumbnail QA harness. Active ONLY in a DEV build with
// ?thumbqa=1 (same trust boundary as isDocQaMode). Renders fixture boards
// through the real renderThumbnailBlob at tile + OG sizes so the thumbnail
// look can be screenshotted + iterated on visually without a backend.
// See ../local/ThumbQaHarness.jsx.
export function isThumbQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('thumbqa') === '1';
}

// Dev-only drag-and-drop QA bridge. Active ONLY in a DEV build with ?dndqa=1.
// Publishes the PURE drag/drop logic helpers (boardTree cycle/plan, canvas
// clamp, dragMimes coercion) on window.__soleilDndTest so Playwright logic
// specs can exercise them directly — no UI, no backend.
export function isDndQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('dndqa') === '1';
}

// Dev-only arrow-geometry QA bridge. Active ONLY in a DEV build with ?arrowqa=1
// (same trust boundary as isDndQaMode). Publishes the PURE arrow routing helpers
// + a seeded crowded layout + a clearance assertion on window.__soleilArrowTest,
// and mounts the seeded board, so Playwright can verify arrows never cross cards
// (both the pure geometry and the rendered DOM paths). No backend, no UI chrome.
export function isArrowQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('arrowqa') === '1';
}

// Dev-only override for the public-share engagement prompt's dwell trigger.
// Active ONLY in a DEV build with ?shareqa=1 (same trust boundary as
// qaTierOverride), so the 30s threshold can never be shortened in production.
// Lets Playwright exercise the dwell-triggered prompt without waiting:
//   /share/<token>?shareqa=1&promptms=300
// Returns the override in ms, or null when not overriding.
export function qaSharePromptMs() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  if (q.get('shareqa') !== '1') return null;
  const ms = Number(q.get('promptms'));
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

// Dev-only kill switch for the public-share sub-board prefetch. Active ONLY
// in a DEV build with ?shareqa=1&prefetch=0 — lets the Playwright nav spec
// observe a genuinely uncached sub-board fetch (progress shimmer,
// cached:false) without racing the idle prefetch.
export function qaShareNoPrefetch() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  return q.get('shareqa') === '1' && q.get('prefetch') === '0';
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

// Dev-only force-show for the first-value upgrade banner. Active ONLY in a DEV
// build with ?local=1 (same trust boundary as qaTierOverride). Lets specs render
// the banner deterministically without simulating a genuine card placement:
//   /?local=1&tier=demo&firstvalue=1
// The banner stays demo-gated at the render site, so &tier=paid still won't show it.
export function qaForceFirstValue() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  const q = new URLSearchParams(window.location.search);
  return q.get('local') === '1' && q.get('firstvalue') === '1';
}

// Dev-only waitlist-status override. Active ONLY in a DEV build with ?local=1
// (same trust boundary as qaTierOverride). Lets us preview each branch of the
// WaitlistConfirm status page without an authenticated waitlist_entries row
// (the mocked local user has no Supabase session, so the real query returns
// nothing). Returns the status to stub, or undefined when not overriding:
//   pending  → "On the waitlist" + pay-to-skip box   (the canonical screen)
//   rejected → "wasn't approved" + pay-to-skip CTA
//   none     → "No application yet" / pick-a-path
//   /waitlist/status?local=1&tier=waitlist&wlstatus=pending
export function qaWaitlistStatus() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return undefined;
  const q = new URLSearchParams(window.location.search);
  if (q.get('local') !== '1') return undefined;
  return q.get('wlstatus') || undefined;
}
