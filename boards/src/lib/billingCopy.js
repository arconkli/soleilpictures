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
export const COPY_REV = 'studio_v2';

import { DEMO_CARD_LIMIT } from './demoCardCap.js';

// Root pricing object — both "per month" (shown on the cards) and "billed"
// (shown on the Billing tab) figures derive from these so they can't drift.
//   monthly: $25/mo billed monthly        → $25/mo
//   annual:  $20/mo billed annually ($240) → saves $60/yr vs monthly
export const PRICING = {
  monthly: { perMonth: 25, billed: 25,  perMonthLabel: '$25', billedLabel: '$25/mo' },
  annual:  { perMonth: 20, billed: 240, perMonthLabel: '$20', billedLabel: '$240/yr' },
};

// Savings figures exist only as arithmetic over PRICING — never typed — so a
// price change cannot leave a stale discount claim behind on any surface.
PRICING.annual.savings = `$${PRICING.monthly.perMonth * 12 - PRICING.annual.billed}/yr`;
export const SAVINGS_PCT_LABEL =
  `Save ${Math.round((1 - PRICING.annual.perMonth / PRICING.monthly.perMonth) * 100)}%`;

const MONTHLY_PRICE = PRICING.monthly.billedLabel;  // '$25/mo'
const ANNUAL_PRICE  = PRICING.annual.billedLabel;   // '$240/yr'

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

// Canonical Creator feature list — the public PricingPage wording, used on
// EVERY Creator surface. `**text**` marks bold spans (rendered by FeatureList).
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
// NOTE: clusters/boards are NOT a paid difference — they were never capped.
//
// The storage figure mirrors the enforced default quota: app_config
// 'storage_quota_bytes' = 107374182400 (100 GiB), seeded in migration 0154 and
// read by _storage_quota_bytes(). gen-docs.mjs cross-checks this label against
// that migration literal at build time.
export const CREATOR_STORAGE_LABEL = '100GB';
export const CREATOR_FEATURES = [
  'Unlimited cards — build without a ceiling',
  'Any file type — .psd, .fig, .zip, video, audio, docs',
  `No size limits, on your own **${CREATOR_STORAGE_LABEL}** drive`,
];

// Stable analytics keys, parallel to CREATOR_FEATURES by index. The up_* hover
// telemetry records WHICH pitch line a prospect read (up_feature_hover {row,key});
// keying by these instead of the copy text means the data survives copy edits.
// Keep this array in lockstep with CREATOR_FEATURES (billingCopy.test.mjs asserts it).
export const CREATOR_FEATURE_KEYS = ['cards', 'filetypes', 'storage'];

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

// CTA labels — one place so "Get Creator" / "Manage billing" stay consistent.
// `subscribeShort` is the compact contextual label used in tight spots (the
// WaitlistConfirm skip row), composed with the live per-month price.
export const CTA = {
  getCreator: `Get ${PLAN_NAME}`,
  getCreatorBusy: 'Opening checkout…',
  manageBilling: 'Manage billing →',
  manageBillingBusy: 'Opening…',
  subscribeShort: (plan) => `Subscribe — $${planPerMonth(plan)}/mo`,
};

// Compact byte label for the cap-hit summary ("233 MB", "1.4 GB"). Local to
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

// capHitSummary — the cap-hit modal's opening line, in the user's own numbers.
//
// The exposure telemetry is unambiguous that the abstract feature list goes
// unread at this moment: zero feature rows were read on any of the real
// cap-hitter's exposures. Someone who has just been stopped already knows what
// they want; naming what they've built beats describing the product.
//
// Every field is optional and every clause degrades away rather than printing a
// zero — a user with no uploads should not be told "0 B of your files".
export function capHitSummary({ cards, clusters, storageBytes } = {}) {
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
export function planLabel({ tier, plan, demoCardCount, grantBacked, cardLimit } = {}) {
  if (tier === 'admin') return 'Admin · Unlimited';
  if (tier === 'paid') {
    // Comped via an admin grant (no paying Stripe sub) — say so honestly.
    if (grantBacked) return `${PLAN_NAME} · Complimentary`;
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

export function formatPeriodEnd(dateLike, { cancel } = {}) {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return {
    label: cancel ? 'Ends' : 'Renews',
    value: d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
  };
}
