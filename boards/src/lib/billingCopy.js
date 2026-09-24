// Single source of truth for billing-related strings: prices, plan names,
// feature lists, and CTA labels. Every pricing/upgrade/billing surface
// (PricingPage, PricingModal, WaitlistConfirm, BillingPage, SettingsPanel)
// reads from here so the numbers and copy can only be edited once and can
// never drift between the public page and the in-app modal.
//
// Display prices are mirrors of the Stripe prices configured via the
// STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL env vars in
// create-checkout-session. If those change, update PRICING below.
//
// Known remaining mirror OUTSIDE this module (cannot import JS): the MRR
// fallback cents in migration 0099's admin_stats (2500/2000). Update it too
// on any price change.

export const PLAN_NAME = 'Creator';

// Revision marker for the current pricing/upgrade copy. Threaded into the
// pricing funnel events (pricing_view, pricing_creator_intent, first_value_*)
// so conversion can be attributed before/after a copy change without an A/B
// test (traffic is far too low for one). Bump on every material copy revision.
export const COPY_REV = 'studio_v5';

import { DEMO_CARD_LIMIT } from './demoCardCap.js';
// The free-tier per-file byte caps, from the module that enforces them on the
// ingest path. gen-docs.mjs reads the same three constants for {{fact:…}}, so
// the pricing page and the docs cannot disagree about a number.
import { FREE_VIDEO_CAP, FREE_AUDIO_CAP, FREE_PDF_CAP, FREE_VIDEO_SECONDS } from './fileIngest.js';

const MB = 1024 * 1024;
const mb = (bytes) => `${Math.round(bytes / MB)} MB`;

// Root pricing object — both "per month" (shown on the cards) and "billed"
// (shown on the Billing tab) figures derive from these so they can't drift.
//   monthly: $25/mo billed monthly        → $25/mo
//   annual:  $20/mo billed annually ($240) → saves $60/yr vs monthly
export const PRICING = {
  monthly: { perMonth: 25, billed: 25,  perMonthLabel: '$25', billedLabel: '$25/mo' },
  annual:  { perMonth: 20, billed: 240, perMonthLabel: '$20', billedLabel: '$240/yr' },
};

// A referred (or collab-invited) signup is granted this many bonus cards ON TOP
// of their base cap by ensure_profile_for_new_user (migration 0163), and the
// referrer earns the same when the referee places their first genuine card. So
// a new invitee starts at DEMO_CARD_LIMIT + REFERRAL_BONUS_CARDS, not at the
// bonus alone — three surfaces used to advertise "25 free cards", which
// understated the real number by two thirds.
export const REFERRAL_BONUS_CARDS = 25;
export const REFERRED_START_CARDS = DEMO_CARD_LIMIT + REFERRAL_BONUS_CARDS;

// Savings figures exist only as arithmetic over PRICING — never typed — so a
// price change cannot leave a stale discount claim behind on any surface.
PRICING.annual.savings = `$${PRICING.monthly.perMonth * 12 - PRICING.annual.billed}/yr`;
export const SAVINGS_PCT_LABEL =
  `Save ${Math.round((1 - PRICING.annual.perMonth / PRICING.monthly.perMonth) * 100)}%`;

const MONTHLY_PRICE = PRICING.monthly.billedLabel;  // '$25/mo'
const ANNUAL_PRICE  = PRICING.annual.billedLabel;   // '$240/yr'

// The one-line price that ambient surfaces carry — the chip pill, the
// first-value banner, the approaching-limit toast. Those surfaces used to show
// no number at all: the price lived behind a click, and most of the people who
// filled a board never took it. "from" because the annual plan's per-month
// figure is the lower of the two; the modal that opens from any of these
// surfaces shows both plans. Derived, never typed, like every other label here.
export const PRICE_FROM_LABEL = `from ${PRICING.annual.perMonthLabel}/mo`;

// The dollar amount shown as "$N/mo" on the pricing cards for a given plan.
export function planPerMonth(plan) {
  return (PRICING[plan] || PRICING.annual).perMonth;
}

// The sub-line under the price on a card. Returned as structured data so the
// "Save $X/yr" emphasis renders identically everywhere without duplicating
// the markup decision.
//   annual  → { lead: 'billed annually', save: 'Save $60/yr' }
//   monthly → { lead: 'billed monthly',  save: null }
export function planBilling(plan) {
  if (plan === 'annual') return { lead: 'billed annually', save: `Save ${PRICING.annual.savings}` };
  return { lead: 'billed monthly', save: null };
}

// Canonical Creator benefits — the public wording, used on EVERY Creator
// surface. See CREATOR_BENEFITS below for the shape; this block is the rule
// the shape exists to enforce.
//
// EVERY LINE HERE MUST BE TRUE AND ENFORCED IN CODE. The previous list sold
// three things it should not have: two features that were never built, and
// "full edit access, everywhere you're invited" — which migration 0188 made
// FREE for every tier. Before adding a line, name the gate that enforces it.
//
// The real, enforced free/paid differences are exactly these three:
//   1. cards      — enforce_demo_card_cap_trg (0187): demo stops at the cap
//   2. file types — fileIngest.js routes non-standard files to 'blocked' for
//                   free owners; authorize_upload() rejects owner_not_paid
//   3. size/length— free caps video 30MB/60s, audio 50MB, PDF 50MB (uploads.js)
//
// The fourth line is not a fourth LIMIT — it is the SCOPE of those three, and
// it is the one genuinely competitive thing on this list. Migration 0187
// ("owner-pays capacity, keyed consistently to the WORKSPACE owner") re-keyed
// every gate to workspaces.created_by: enforce_demo_card_cap_trg counts across
// the owner's workspaces via board_workspace_owner(), authorize_upload() reads
// the owner's tier, authorize_image_upload() bills the owner's quota, and
// CanvasSurface's canAttemptFiles = !(ownsWorkspace && !isPaidPlan) lets a
// collaborator in someone else's workspace attempt optimistically and let the
// server decide. So one subscription raises the ceiling for everyone working in
// that workspace. Every individual competitor in this category charges per
// seat; we do not, and never said so.
//
// Say it as SCOPE, never as access or seats. "Full edit access, everywhere
// you're invited" was the line 0188 made free and this file had to delete, and
// unlimited free collaborators are free too (collab_free_editor_cap is null) —
// so the claim is that your LIMITS carry to the people you invite, not that
// inviting them is free. Both are true; only one of them is Creator's.
//
// NOTE: clusters/boards are NOT a paid difference — they were never capped.
//
// The storage figure mirrors the enforced default quota: app_config
// 'storage_quota_bytes' = 107374182400 (100 GiB), seeded in migration 0154 and
// read by _storage_quota_bytes(). gen-docs.mjs cross-checks this label against
// that migration literal at build time.
export const CREATOR_STORAGE_LABEL = '100GB';

// ── Each claim, and what it actually means ─────────────────────────────────
//
// This was four bare claims for most of the product's life, and across every
// upgrade surface almost nobody ever read one — at the wall, where the reader
// is provably motivated, not a single feature row has ever been read.
//
// The reason is visible the moment you put the old list beside a competitor's.
// "Any file type — .psd, .fig, .zip, video, audio, docs" is a list of
// extensions, not a benefit; it tells someone who just watched a file bounce
// off the canvas nothing about what would change. So every claim now carries
// one plain sentence saying what it does for you, which also gives the list
// two reading levels instead of one: the titles are SHORTER than the old
// bullets and carry the scan, the bodies are there for whoever wants them.
//
// `title` is the scan line. `body` is the explanation. `key` is the stable
// up_feature_hover key — NEVER renamed, or the scorecard loses its history.
// `**text**` marks bold spans (rendered by renderEmphasis in PricingBits).
//
// EVERY LINE, TITLE AND BODY, MUST BE TRUE AND ENFORCED IN CODE. The bodies
// are the easier place to overclaim, because they read like prose rather than
// like a specification. Before editing one, name the gate.
export const CREATOR_BENEFITS = [
  {
    key: 'cards',
    title: 'Unlimited cards',
    // enforce_demo_card_cap_trg (0187). Upgrading removes the ceiling; it
    // does not touch what is already there, which is the thing people at the
    // wall most often assume and most need told.
    // DEMO_CARD_LIMIT is what a NEW account gets, which is the right number for
    // a signed-out visitor reading /pricing and the WRONG one for a signed-in
    // reader. demoCardCap.js says so in its own header: the cap is per-user
    // since 0229, accounts predating it are grandfathered at 100, and a
    // referred signup starts at 50 + REFERRAL_BONUS_CARDS. In-app callers must
    // use creatorBenefits({ cardLimit }) below and pass the viewer's real one —
    // a paywall whose single checkable number is wrong about the reader is
    // worse than one that stays general.
    body: `The ${DEMO_CARD_LIMIT}-card ceiling comes off. Everything you have already made stays exactly where it is.`,
  },
  {
    key: 'filetypes',
    title: 'Any file type',
    // fileIngest.js routes non-standard files to route:'blocked' for a free
    // owner; authorize_upload() rejects owner_not_paid on the server.
    body: 'A .psd, a .fig, a .zip — anything at all — lands on the canvas instead of bouncing off it.',
  },
  {
    key: 'storage',
    title: 'No size limits',
    // The free per-file ceilings live in fileIngest.js and are injected here,
    // never typed: the honest way to say what this unlocks is to name the
    // walls it removes. The drive figure mirrors the enforced default quota
    // (app_config 'storage_quota_bytes', migration 0154).
    // LENGTH as well as weight. The free tier caps video duration at
    // FREE_VIDEO_SECONDS (uploads.js, lifted only for a paid owner) and that
    // half of the gate was public nowhere — so this sentence used to imply
    // size was the only video wall while a 20 MB, 90-second clip was refused.
    body: `Video past ${mb(FREE_VIDEO_CAP)} or ${FREE_VIDEO_SECONDS} seconds, audio past ${mb(FREE_AUDIO_CAP)}, a PDF past ${mb(FREE_PDF_CAP)} — all fine, on a **${CREATOR_STORAGE_LABEL}** drive.`,
  },
  {
    key: 'workspace',
    title: 'Covers your whole workspace',
    // Migration 0187 keyed every gate to workspaces.created_by, so one
    // subscription raises the ceiling for everyone working in that workspace.
    // Say it as SCOPE — the LIMITS carrying over — never as access or seats:
    // editing is free on every tier (0188) and so are unlimited collaborators
    // (collab_free_editor_cap is null). Both are true; only one is Creator's.
    body: 'Everyone you invite builds at your limits. There are no per-seat charges.',
  },
];

// The same benefits, with the cap stated as THIS viewer's rather than a new
// account's. Falls back to the generic list when the caller has no resolved
// limit — a pre-resolution useMyTier placeholder must never be rendered as a
// number, so "the 50-card ceiling" is the honest default and a wrong 100 is not.
//
// Returns the SAME array identity when there is nothing to substitute, so
// callers can keep passing it straight to BenefitGrid without re-rendering.
export function creatorBenefits({ cardLimit } = {}) {
  const n = Number(cardLimit);
  if (!Number.isFinite(n) || n <= 0 || n === DEMO_CARD_LIMIT) return CREATOR_BENEFITS;
  return CREATOR_BENEFITS.map((b) => (
    b.key === 'cards'
      ? { ...b, body: b.body.replace(`${DEMO_CARD_LIMIT}-card`, `${n}-card`) }
      : b
  ));
}

// The scan layer on its own, for the surfaces and tests that want flat text.
// Derived, so a fifth benefit cannot appear in one place and not the other.
export const CREATOR_FEATURES = CREATOR_BENEFITS.map((b) => b.title);

// Stable analytics keys, parallel to CREATOR_BENEFITS by index. The up_* hover
// telemetry records WHICH pitch line a prospect read (up_feature_hover {row,key});
// keying by these instead of the copy text means the data survives copy edits.
// Derived now — they used to be a hand-maintained parallel array, which is the
// shape billingCopy.test.mjs had to grow an assertion to police.
export const CREATOR_FEATURE_KEYS = CREATOR_BENEFITS.map((b) => b.key);

// Retired keys, kept so historical up_feature_hover rows stay readable in the
// admin scorecard. 'studio'/'edit_access' described lines that are gone;
// 'tools'/'events' described features that never existed.
export const LEGACY_FEATURE_KEYS = ['studio', 'edit_access', 'tools', 'events'];

// What the free tier genuinely is. It is NOT view-only: since migration 0188 a
// free user can edit any cluster they are invited to as an editor, and
// clusters/boards themselves were never capped. The only real limit is cards.
export const DEMO_FEATURES = [
  `**${DEMO_CARD_LIMIT} cards** to build with`,
  'Unlimited clusters & boards',
  'Free collaboration — invite editors to any cluster',
];

// The Creator trial. Fourteen days, card required, offered ONLY in-product to
// accounts with a real body of work — see supabase/functions/_shared/trialCore.mjs
// for the rule the server enforces and lib/creatorTrial.js for the client twin.
// The number is a fact the docs inject ({{fact:creatorTrialDays}}) and the
// edge function puts on the Stripe session; trialCore.test.mjs asserts all
// three agree. Never type "14" anywhere else.
export const CREATOR_TRIAL_DAYS = 14;

// ── The ambient offer ───────────────────────────────────────────────────────
//
// What the three ambient surfaces — the chip pill, the first-value banner and
// the approaching-limit toast — LEAD with.
//
// Putting the price on those surfaces (prod 2026-09-15) multiplied their reach
// several times over and inverted the targeting: nearly everyone reached now
// has a real body of work, where historically more empty accounts had seen a
// price than every committed user combined. What those surfaces did not carry
// is the trial. `creatorTrial` was referenced in exactly one rendering
// component — PricingModal — so the offer was only discoverable by clicking
// through, and a small fraction of the people who saw a price ever saw it.
//
// A price is a request; a trial is an invitation. At a price that is 2–3.6×
// every individual competitor, leading with the request and hiding the
// invitation is the worst available ordering. So when the viewer is eligible,
// the invitation goes first.
//
// IN-PRODUCT ONLY. Both /pricing pages keep leading with the price — that is
// what makes this an invitation extended to someone who has built something
// rather than a "START FREE TRIAL" banner, and it is the standing decision
// recorded in supabase/functions/_shared/trialCore.mjs.
//
// MEASUREMENT NOTE, because this WILL be misread: on a trial-eligible viewer
// the trial label REPLACES the price on the pill, so that impression stamps no
// `price_seen` row. A dip in "share of committed users who have seen a price"
// after this ships is the trial working, not reach regressing. The honest
// exposure denominator is `up_chip_view`, which carries both `price_shown` and
// `trial_shown` so the two offers stay separable.
export const TRIAL_FROM_LABEL = `${CREATOR_TRIAL_DAYS} days free`;

// The pill renders TRIAL_FROM_LABEL or PRICE_FROM_LABEL into its own span
// rather than taking a single composed string, because the two carry different
// classes — a fact reads as quiet ink beside the count, an offer does not.
// Eligibility is the CALLER's decision (creatorTrial.js); this module stays
// pure copy and must never grow a second opinion about who qualifies.

// The first-value banner's body. Highest-dwell surface in the product (9.2 s
// median, several times the wall's), which is why it carries a full sentence
// rather than a label.
export function firstValueSentence(trialOffer) {
  const lead = 'Creator is the complete studio — unlimited cards, any file type, any size.';
  return trialOffer
    ? `${lead} Yours free for ${CREATOR_TRIAL_DAYS} days.`
    : `${lead} Everything your work deserves, ${PRICE_FROM_LABEL}.`;
}

// The approaching-limit toast. Keeps the referral alternative on both variants:
// earning free cards is a real route to the same outcome and costs nothing to
// offer beside the paid one.
export function nearCapSentence({ count, limit, trialOffer } = {}) {
  const head = `You're at ${count}/${limit} cards.`;
  return trialOffer
    ? `${head} Creator lifts the cap — free for ${CREATOR_TRIAL_DAYS} days, or invite friends to earn more free ones.`
    : `${head} Creator lifts the cap, ${PRICE_FROM_LABEL} — or invite friends to earn more free ones.`;
}

// ── The /pricing page ───────────────────────────────────────────────────────
//
// The page was built on .pricing-screen — `position: fixed; inset: 0;
// justify-content: center`, a declaration block it shares with .welcome-screen
// and .app-error-panel. It was, structurally, the error screen with two plan
// cards in it. Its visitors arrive almost entirely from /vs/pureref and the
// other comparison pages, which are built on the public shell with a real
// published board in a browser frame, a comparison and an FAQ — so the second
// page of the journey looked like a login box, and the number they came for
// was sitting in it.
//
// The copy lives here rather than in the JSX for the reason the header of this
// file gives, and for one more: publicClaims.test.mjs now scans the pricing
// surfaces, and prose typed into a component used to escape every lint we have.
//
// WHAT THIS PAGE LEADS WITH, and why it is not the price. The number is stated
// plainly and high — people arriving at a pricing page came for it, and hiding
// it is the worse read. But the ACTION is free-to-start. The page has never
// produced a purchase; its visitors arrive from pages promising "Free Demo
// tier — no credit card, no trial clock"; and its "Get Creator" button already
// only sent a signed-out visitor to sign-in, because there is no way to check
// out without an account. Leading with the free start makes an existing
// behaviour honest rather than changing one.
//
// The trial is NOT on this page, unchanged from the standing decision above —
// and it is moot here besides: eligibility needs a real body of work, which a
// signed-out visitor does not have.
export const PRICING_PAGE = {
  h1: 'Start free. Pay when you outgrow it.',
  // Every number in this sentence is injected, none typed.
  // ONE line, because the two plan cards are directly beneath it and they say
  // the rest better than a sentence can. This used to carry the whole offer —
  // both prices, the cap, the collaborator rule and two promises about what
  // free is not — which made the first thing on a pricing page a paragraph to
  // work through rather than a number to compare.
  subhead:
    `The free plan is a real plan, not a countdown. ${PLAN_NAME} lifts its three limits for ${PRICING.monthly.billedLabel}.`,
  startFree: 'Start free',
  startFreeSub: 'No credit card. Nothing to install.',
  // The frame beneath the hero.
  //
  // It shows OUR board: the Clusters brand book — approved marks, the palette
  // with its hex codes, the wordmark spec, a DO'S and a DON'TS grid, the
  // annotations we drew on it while arguing about the dotted line. Every other
  // page on this site frames a customer-shaped showcase moodboard. On the one
  // page asking someone to pay us, the board on screen should be the one we
  // actually run the company on.
  //
  // `slug` names the render shipped in public/landing/. `href` is where the
  // frame goes when clicked, and it is a SHARE link rather than a /c/ slug
  // because this board is shared, not published — it has no place in the
  // sitemap and no business being crawled; it just has to be openable. Both
  // halves are checked by pricingPage.test.mjs, which is the only thing
  // standing between a rename and a broken image or a dead frame.
  shot: {
    slug: 'clusters-logo',
    href: '/share/3b2d89f2-9c1d-48af-8b89-2517b1b49712',
    // What the frame's fake address bar reads. A share URL's token is noise in
    // a browser chrome, so the bar shows the board, which is what a real one
    // would show a person who had it open.
    bar: 'clusters.soleilpictures.com/share/clusters-logo',
    caption: 'Our own brand book, built in Clusters — open it live and pan around.',
  },
  // The comparison BELOW the two plan cards, which is a different job from the
  // cards and has to say so in its title. It used to be headed "What Creator
  // changes" — the same promise the Creator card now makes 800px above it, in
  // more detail — and the only thing it uniquely carries is the FREE column:
  // the actual per-file ceilings a free account runs into, which no card
  // states. That is what it is for and what it is now called.
  paidHeading: 'Both plans, line by line',
  // Three rows, because three is the number of enforced differences. If a
  // fourth ever appears here it has to name the code that enforces it, exactly
  // as CREATOR_FEATURES does.
  paidBody:
    'Three differences, and nothing else. Everything absent from this table is on ' +
    'both plans — clusters, collaborators, editing, sharing, exports, version ' +
    'history, the API.',
  // The third row covers size AND length; "three" stays true only because that
  // row says both. If a fourth gate is ever added in code, this sentence and
  // the table are the two places that have to change with it.
  // The fourth CREATOR_FEATURES line. It is NOT a limit, so it has no row in
  // the table above — but it is the one genuinely competitive thing on the
  // list (migration 0187 keyed every gate to the workspace OWNER, and every
  // individual plan in this category charges per seat), so it gets said out
  // loud rather than left to the FAQ. Keyed 'workspace' to match.
  workspaceNote: `One ${PLAN_NAME} plan covers the whole workspace — everyone you invite builds at your limits, and there are no per-seat charges.`,
  // The free plan as a card, so the page can put the two side by side and let
  // someone compare them in one look. `price` is not a number from PRICING —
  // there is no free SKU and never will be — so it is stated here and the
  // publicClaims lint reads it like any other public price claim.
  freeCardName: 'Free',
  freeCardPrice: '$0',
  freeCardUnit: 'forever',
  freeCardSub: 'No card, no clock, no expiry.',
  // The Creator card's one-liner, beneath the price. The four benefits say
  // what it unlocks; this says what it costs you to stop.
  paidCardSub: 'Cancel any time — your cards stay yours.',
  closing: 'Start with the free plan.',
  closingSub: `Upgrade when the ${DEMO_CARD_LIMIT}th card is in your way, not before.`,
};

// The comparison, built from the three gates that actually exist:
// enforce_demo_card_cap_trg (0187), fileIngest's route:'blocked' for a free
// owner, and the per-file byte caps in fileIngest.js. Sizes are imported, not
// typed, so a cap change cannot leave a stale promise on the pricing page.
export const PLAN_COMPARISON = [
  {
    key: 'cards',
    label: 'Cards',
    demo: `${DEMO_CARD_LIMIT}`,
    creator: 'Unlimited',
  },
  {
    key: 'filetypes',
    label: 'File types',
    demo: 'Images, video, audio, PDFs',
    creator: 'Any file — .psd, .fig, .zip, anything',
  },
  {
    // Keyed 'storage' rather than 'size' so up_feature_hover's key space stays
    // continuous with CREATOR_FEATURE_KEYS across every surface — this row IS
    // the storage line, stated as the limit it actually is.
    key: 'storage',
    // "and length", because video is capped on BOTH and only one was ever
    // stated. A free owner refused a 20 MB, 90-second clip had been told by
    // this very table that 30 MB was the wall.
    label: 'Per-file size and length',
    demo: `Video ${mb(FREE_VIDEO_CAP)} or ${FREE_VIDEO_SECONDS}s · audio ${mb(FREE_AUDIO_CAP)} · PDF ${mb(FREE_PDF_CAP)}`,
    creator: `No limit, on a ${CREATOR_STORAGE_LABEL} drive`,
  },
];

// The questions people actually arrive with, given where they arrive from.
// Answers are the same ones content/docs/account/plans.md gives — that page is
// the canonical version and both are linted by publicClaims.
export const PRICING_FAQ = [
  {
    q: 'What is actually limited on the free plan?',
    a: 'Three things and only three — how many cards you can have, which file types you can upload, ' +
       `and how big or long a single file can be (video stops at ${mb(FREE_VIDEO_CAP)} or ${FREE_VIDEO_SECONDS} seconds, ` +
       `audio at ${mb(FREE_AUDIO_CAP)}, PDFs at ${mb(FREE_PDF_CAP)}). Clusters, collaborators and editing are not limited.`,
  },
  {
    q: 'Do the people I invite need to pay?',
    a: 'No. Editors are free on every plan, and always were. ' +
       `What ${PLAN_NAME} does is carry YOUR limits to them: everything they add counts against the ` +
       'workspace owner, so one plan raises the ceiling for everyone working in that workspace. There are no per-seat charges.',
  },
  {
    q: `What happens when I reach ${DEMO_CARD_LIMIT} cards?`,
    a: 'You are told, and asked to upgrade. Nothing you have already made is removed, hidden or locked — ' +
       'you simply cannot add more until you free some room or upgrade.',
  },
  {
    q: 'Can I cancel?',
    a: 'Any time, from Settings → Billing, and you keep access until the end of the period you have paid for. ' +
       'Afterwards everything over the free allowance stays exactly where it is; you just cannot add more.',
  },
  {
    q: 'Do I need to install anything?',
    a: 'No. Clusters runs in the browser on desktop, laptop and tablet, and the same board opens on all of them. ' +
       'You can add it to a phone home screen as a web app.',
  },
];

// CTA labels — one place so "Get Creator" / "Manage billing" stay consistent.
// `subscribeShort` is the compact contextual label used in tight spots (the
// WaitlistConfirm skip row), composed with the live per-month price.
export const CTA = {
  getCreator: `Get ${PLAN_NAME}`,
  getCreatorBusy: 'Opening checkout…',
  tryCreator: `Try ${PLAN_NAME} free for ${CREATOR_TRIAL_DAYS} days`,
  // The compact form, for the banner button and the toast action — spots
  // where the full sentence wraps. The day count is already in the copy
  // beside both of them, so it is not lost.
  tryCreatorShort: `Try ${PLAN_NAME} free`,
  manageBilling: 'Manage billing →',
  manageBillingBusy: 'Opening…',
  subscribeShort: (plan) => `Subscribe — $${planPerMonth(plan)}/mo`,
};

// The one line under the trial button: what happens to the card, and when.
// Honest about the card (it is required — that is the model that protects the
// brand from tire-kickers and the one that converts) and about the charge.
// ── The in-app offer's "what you're on now" row ────────────────────────────
//
// /pricing works because it puts two plans beside each other and lets someone
// compare. The modal could never do that — it showed one card, priced, with no
// statement of the thing being left behind — so it asked for a decision while
// showing only one side of it.
//
// It can do better than the page, in fact: in-app we know the reader's REAL
// numbers, so the free column is not a specimen plan but theirs, with the
// count they are actually carrying. `limit` is the viewer's own effective cap,
// never DEMO_CARD_LIMIT — see creatorBenefits for why that distinction has
// already bitten once.
export function currentPlanRow({ cards, limit } = {}) {
  const n = Number(cards);
  const cap = Number(limit);
  const known = Number.isFinite(n) && n >= 0 && Number.isFinite(cap) && cap > 0;
  return {
    name: 'Free',
    label: 'Your plan today',
    // Null rather than a guess: useMyTier's pre-fetch placeholders would
    // otherwise render "0/100" at a reader holding 42 cards, and the fraction
    // is the one number on this row they can check.
    detail: known ? `${n} of ${cap} cards` : null,
  };
}

// The price when the trial is on offer. The number people are deciding about
// today is zero, and the modal used to state $25 and mention the trial only on
// the button — leading with the request and hiding the offer. Both halves are
// here because stating one without the other is how a trial becomes a
// surprise charge, which is the worst available outcome for this product.
export function trialPrice(plan) {
  const p = PRICING[plan] || PRICING.monthly;
  return {
    now: '$0',
    nowUnit: `for ${CREATOR_TRIAL_DAYS} days`,
    then: `then ${p.billedLabel}`,
  };
}

export function trialNote(plan) {
  const p = PRICING[plan] || PRICING.monthly;
  return `Card required, nothing charged for ${CREATOR_TRIAL_DAYS} days. Then ${p.billedLabel} — cancel before the trial ends and you pay nothing.`;
}

// Compact byte label for the own-work summary ("233 MB", "1.4 GB"). Local to
// billingCopy so this module stays pure and node-testable; SettingsPanel's
// meter has its own equivalent tied to its own layout.
function capBytes(n) {
  const b = Number(n);
  if (!Number.isFinite(b) || b <= 0) return null;
  const units = [['GB', 1024 ** 3], ['MB', 1024 ** 2], ['KB', 1024]];
  for (const [label, size] of units) {
    if (b >= size) {
      const v = b / size;
      return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${label}`;
    }
  }
  return `${Math.round(b)} B`;
}

// ownWorkSummary — what this person has actually built, in their own numbers.
//
// Written for the cap-hit modal, where the exposure telemetry was unambiguous
// that the abstract feature list goes unread: zero feature rows were read on
// any real cap-hitter's exposure. Someone who has just been stopped already
// knows what they want; naming what they've built beats describing the product.
//
// It now runs on every header, because that finding was never specific to the
// wall. Across every upgrade surface the feature rows go almost entirely
// unread, and the offer is the only screen in a product made of images that
// shows the reader nothing of their own. The wall was simply the one place we
// had already bothered to be specific.
//
// Every field is optional and every clause degrades away rather than printing a
// zero — a user with no uploads should not be told "0 B of your files", and the
// ambient headers pass no bytes at all rather than pay for the storage RPC.
export function ownWorkSummary({ cards, clusters, storageBytes } = {}) {
  const parts = [];
  const n = Number(cards);
  if (Number.isFinite(n) && n > 0) parts.push(`${n} card${n === 1 ? '' : 's'}`);
  const c = Number(clusters);
  if (Number.isFinite(c) && c > 0) parts.push(`${c} cluster${c === 1 ? '' : 's'}`);
  const bytes = capBytes(storageBytes);
  if (bytes) parts.push(`${bytes} of files`);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} · ${parts[parts.length - 1]}`;
}

// `cardLimit` is the caller's EFFECTIVE cap (get_my_tier().effective_card_limit
// = card_cap_base + bonus_card_credits). It must be threaded: the cap is
// per-user since migration 0229, so falling back to DEMO_CARD_LIMIT would tell
// every grandfathered account — which is every account that existed before the
// change — that its limit is the new-account one. It also silently under-reported
// referral bonuses before that.
export function planLabel({ tier, plan, demoCardCount, grantBacked, cardLimit, subscriptionStatus } = {}) {
  if (tier === 'admin') return 'Admin · Unlimited';
  if (tier === 'paid') {
    // Comped via an admin grant (no paying Stripe sub) — say so honestly.
    if (grantBacked) return `${PLAN_NAME} · Complimentary`;
    // On the trial: paid access, nothing charged yet. The renew/ends date the
    // Billing tab prints beside this is the trial end.
    if (subscriptionStatus === 'trialing') return `${PLAN_NAME} · Trial`;
    return plan === 'annual'
      ? `${PLAN_NAME} · Annual (${ANNUAL_PRICE})`
      : `${PLAN_NAME} · Monthly (${MONTHLY_PRICE})`;
  }
  if (tier === 'demo') {
    const n = Number.isFinite(demoCardCount) ? demoCardCount : 0;
    const cap = Number.isFinite(cardLimit) && cardLimit > 0 ? cardLimit : DEMO_CARD_LIMIT;
    return `Free Demo · ${n}/${cap} cards`;
  }
  return 'Waitlist · not yet active';
}

// Copy for a complimentary (admin-granted) Creator pass. `grantExpiresAt` null
// means no end date. Returns a single descriptive line, or null when there's no
// active grant to describe.
export function grantCopy({ grantActive, grantExpiresAt } = {}) {
  if (!grantActive) return null;
  if (!grantExpiresAt) return 'Complimentary Creator access — granted by Soleil, no end date.';
  const d = new Date(grantExpiresAt);
  if (Number.isNaN(d.getTime())) return 'Complimentary Creator access — granted by Soleil.';
  const when = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  return `Complimentary Creator access — granted by Soleil, through ${when}.`;
}

// The /pricing SERP description the Worker injects at the edge (ROUTE_META).
// Lives HERE, not in worker.js, so every claim is built from the same tested
// copy as the pricing surfaces and billingCopy.test.mjs can lint it against
// the banned-claims list — the previous hand-typed version sold a retired
// feature ("Edit Mode") and a never-capped one ("unlimited boards") for
// months with no test able to notice.
export const PRICING_META_DESCRIPTION =
  `Soleil Clusters pricing — start free with the Demo (${DEMO_CARD_LIMIT} cards, ` +
  `unlimited clusters, free collaborators), or go ${PLAN_NAME} ` +
  `(${PRICING.monthly.billedLabel}, or ${PRICING.annual.perMonthLabel}/mo billed annually) ` +
  `for unlimited cards, any file type, and no size limits on a ${CREATOR_STORAGE_LABEL} drive.`;

// `trial` matters: during a trial this date is the FIRST CHARGE, not a renewal.
// Calling it "Renews" is the word that turns a forgotten trial into a disputed
// charge, because it implies something already paid for is continuing.
export function formatPeriodEnd(dateLike, { cancel, trial } = {}) {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return {
    label: cancel ? 'Ends' : trial ? 'First charge' : 'Renews',
    value: d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
  };
}

// What a subscription status means to the person holding it, rather than to
// Stripe. The billing screen printed the raw word.
export function statusLabel(status) {
  switch (status) {
    case 'trialing':           return 'On trial';
    case 'active':             return 'Active';
    case 'past_due':           return 'Payment failed';
    case 'unpaid':             return 'Unpaid';
    case 'paused':             return 'Paused';
    case 'canceled':           return 'Canceled';
    case 'incomplete':         return 'Awaiting payment';
    case 'incomplete_expired': return 'Expired';
    default:                   return status || '—';
  }
}
