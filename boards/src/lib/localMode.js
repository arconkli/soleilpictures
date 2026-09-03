import { DEMO_CARD_LIMIT } from './demoCardCap.js';

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

// Dev-only collaborative-note QA harness. Active ONLY in a DEV build with
// ?noteqa=1 (same trust boundary as isDocQaMode). Mounts the real NoteCard
// against a fresh in-memory Y.Doc + note card Y.Map so Playwright can drive
// genuine co-typing / write-through / seed behaviour without a backend.
// See ../local/NoteQaHarness.jsx.
export function isNoteQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('noteqa') === '1';
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

// Dev-only snap/alignment-guide QA bridge. Active ONLY in a DEV build with
// ?alignqa=1 (same trust boundary as isArrowQaMode). Publishes the PURE snap
// helpers (target build, computeSnap, computeResizeSnap) + a seeded layout on
// window.__soleilAlignTest so Playwright can verify guide culling / dedup /
// equal-size resize without a backend. See ../local/AlignQaHarness.jsx.
export function isAlignQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('alignqa') === '1';
}

// Dev-only Grid QA bridge. Active ONLY in a DEV build with ?gridqa=1 (same trust
// boundary as isAlignQaMode). Publishes the PURE grid-layout (fraction tree,
// shared-edge divider resize, split/merge) + grid-sequence (spatial order, label
// resolution) helpers + deterministic seeds on window.__soleilGridTest so
// Playwright can verify the Grid math without a backend. See ../local/GridQaHarness.jsx.
export function isGridQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('gridqa') === '1';
}

// Dev-only Schedule QA bridge. Active ONLY in a DEV build with ?schedqa=1
// (same trust boundary as isGridQaMode). Publishes the PURE schedule date
// math + slot-key grammar + calendar layout + graft helpers on
// window.__soleilSchedTest so Playwright can verify the Schedule math without
// a backend. See ../local/SchedQaHarness.jsx.
export function isSchedQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('schedqa') === '1';
}

// Dev-only first-run guided-tour QA harness. Active ONLY in a DEV build with
// ?tourqa=1 (same trust boundary as isAlignQaMode). Mounts the real
// <OnboardingTour> over fake data-tour anchors, driven by the real tour engine,
// and publishes fire/skip/getState on window.__soleilTourTest so Playwright can
// verify step advancement + anchoring without a backend. See ../local/TourQaHarness.jsx.
export function isTourQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('tourqa') === '1';
}

// Dev-only power-reveal QA harness. Active ONLY in a DEV build with
// ?revealqa=1 (same trust boundary as isTourQaMode). Mounts the real
// FeedbackProvider/FeedbackOverlay and fires the real POWER_REVEALS registry
// toasts (copy + action labels) so the reveal surface can be eyeballed and
// screenshotted without a signed-in session. See ../local/RevealQaHarness.jsx.
export function isRevealQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('revealqa') === '1';
}

// Dev-only photo-adjustment QA bridge. Active ONLY in a DEV build with
// ?imgeditqa=1 (same trust boundary as isDndQaMode). Publishes the PURE
// imageAdjust helpers (buildFilterCss / buildTransform / isAdjusted / …) on
// window.__soleilImgEditTest so Playwright can verify the filter-string math
// directly — no backend, no UI. See main.jsx's branch.
export function isImageEditQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('imgeditqa') === '1';
}

// Dev-only presence/collaboration QA harness. Active ONLY in a DEV build with
// ?presenceqa=1 (same trust boundary as isAlignQaMode). Mounts the real
// <CanvasPresence> against a fake awareness (lib/presenceQa.js) so Playwright
// can inject hundreds of synthetic peers and assert the at-scale caps:
// cursor cull/cap, selection-rule cap, and the no-render-storm guarantee.
// See ../local/PresenceQaHarness.jsx.
export function isPresenceQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('presenceqa') === '1';
}

// Dev-only READ-ONLY board harness. Active ONLY in a DEV build with ?roqa=1
// (same trust boundary as isPresenceQaMode). Renders the local Home board with
// canEdit=false + isPublic=true, i.e. exactly what a /share visitor sees, so
// the view-only interaction rules — clean-tap opens a board cover, a board
// link, or an image fullscreen; drag pans instead of moving a card — are
// testable without a real share token or a signed-in session.
export function isReadOnlyQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('roqa') === '1';
}

// Is ANY dev-only QA harness driving this pageload?
//
// Why this exists: the e2e suite drives the real app with a real analytics
// client, and `?local=1&tier=demo&cards=N` produces events that are shaped
// exactly like a real user's. Those rows reached the production analytics table
// — playwright.config.js only supplies fake Supabase credentials as a FALLBACK
// (`process.env.X || fake`) and sets reuseExistingServer, so a dev server
// already running with the real .env.local gets reused and the fixtures are
// written straight to production. The result was an upsell funnel where roughly
// half the recent rows were a robot replaying `cards=60`, which is not a funnel
// anyone can read.
//
// Every predicate here is import.meta.env.DEV-guarded, so this is always false
// in a production build and the stamp can never suppress a real user's event.
// Analytics uses it to mark rows `synthetic: true` rather than to drop them:
// several specs assert on the intercepted request body, so the event still has
// to be SENT — it just has to be labelled.
// KEEP IN SYNC with the predicates above — a param that is spelled differently
// here than in its is*QaMode() reader silently stops labelling that harness's
// rows, which is the one failure this list exists to prevent. ('imageeditqa'
// was exactly that: isImageEditQaMode reads ?imgeditqa, so its rows went to
// production unlabelled.)
const QA_MODE_PARAMS = [
  'local', 'adminpreview', 'docqa', 'noteqa', 'thumbqa', 'dndqa', 'arrowqa',
  'alignqa', 'gridqa', 'schedqa', 'tourqa', 'revealqa', 'imgeditqa',
  'presenceqa', 'shareqa', 'roqa',
];
export function isAnyQaMode() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search);
    return QA_MODE_PARAMS.some((k) => q.get(k) === '1');
  } catch (_) { return false; }
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
// &cards / &limit also drive upsell eligibility (lib/upsellEligibility.js), so
// every branch of the pitch-targeting rule is reachable from a URL:
//   /?local=1&tier=demo&cards=0            → suppressed, no_cards
//   /?local=1&tier=demo&cards=45           → eligible (invested), chip visible
//   /?local=1&tier=demo&cards=95           → eligible, urgent pressure
//   /?local=1&tier=demo&cards=45&limit=200 → suppressed (45/200 is only 22%)
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
    bonusCardCredits:   0,
    // ?limit=100 exercises the grandfathered (pre-0229) cohort; the default is
    // what a new account gets.
    effectiveCardLimit: Number(q.get('limit') ?? DEMO_CARD_LIMIT),
    subscriptionStatus: q.get('substatus') || (tier === 'paid' ? 'active' : null),
    currentPeriodEnd:   q.get('periodend') || null,
    cancelAtPeriodEnd:  q.get('cancel') === '1',
    // ?adoffer=1 marks the one-time ad-offer flag (AdWelcome itself is gone —
    // instant_entry arm B skips the gate — so this now only exercises the
    // arm-B dismiss/skip effect in TierRouter).
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

// Dev-only force-show for the CAP-HIT wall, with a synthetic refused-file count.
// Active ONLY in a DEV build with ?local=1 (same trust boundary as
// qaTierOverride). Returns the count to claim was refused, or 0 when not forcing:
//   /?local=1&tier=demo&capwall=28
//
// This seam exists because the real path is unreachable from the harness: the
// cap-hit modal is opened by App.jsx's soleil:card-index-capped listener, and
// App.jsx early-returns to LocalBoardsApp in QA mode, so neither that listener
// nor pitchCapWall ever mounts here. Without the seam the wall's copy — the one
// screen where the reader is provably motivated — would ship with no render
// coverage at all. Like qaForceFirstValue this is a RENDER seam, not a gate
// seam: it proves the modal says the right thing, never who should see it.
export function qaForceCapWall() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return 0;
  const q = new URLSearchParams(window.location.search);
  if (q.get('local') !== '1') return 0;
  // Bounded like the 0198 upsell guards: an unbounded digit run here would be a
  // free integer overflow into whatever reads the rendered number.
  const raw = q.get('capwall');
  if (!raw || !/^\d{1,4}$/.test(raw)) return 0;
  return Number(raw);
}

// Dev-only force-show for the over-cap IMPORT dialog — the question a folder
// drop asks before it uploads anything. Active ONLY in a DEV build with
// ?local=1 (same trust boundary as qaTierOverride). Returns { n, take, count,
// limit } to render, or null when not forcing:
//   /?local=1&tier=demo&importask=76,50,0,50      (files, take, count, limit)
//
// Same reason qaForceCapWall exists: the real path runs through App.jsx's
// preflightImport, and App.jsx early-returns to LocalBoardsApp in QA mode, so
// the dialog would otherwise ship with no render coverage. A RENDER seam, not a
// gate seam — it proves the dialog says the right thing and that its three
// buttons are reachable, never who should see it.
export function qaForceImportAsk() {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search);
  if (q.get('local') !== '1') return null;
  const raw = q.get('importask');
  // Bounded like qaForceCapWall: an unbounded digit run is a free integer
  // overflow into whatever renders the number.
  if (!raw || !/^\d{1,4}(,\d{1,4}){3}$/.test(raw)) return null;
  const [n, take, count, limit] = raw.split(',').map(Number);
  if (take > n) return null;
  return { n, take, over: n - take, count, limit };
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
