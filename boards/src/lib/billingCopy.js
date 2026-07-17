// Single source of truth for billing-related strings: prices, plan names,
// feature lists, and CTA labels. Every pricing/upgrade/billing surface
// (PricingPage, PricingModal, WaitlistConfirm, BillingPage, SettingsPanel)
// reads from here so the numbers and copy can only be edited once and can
// never drift between the public page and the in-app modal.
//
// Display prices are mirrors of the Stripe prices configured via the
// STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL env vars in
// create-checkout-session. If those change, update PRICING below.

export const PLAN_NAME = 'Creator';

// Revision marker for the current pricing/upgrade copy. Threaded into the
// pricing funnel events (pricing_view, pricing_creator_intent, first_value_*)
// so conversion can be attributed before/after a copy change without an A/B
// test (traffic is far too low for one). Bump on every material copy revision.
export const COPY_REV = 'studio_v1';

import { DEMO_CARD_LIMIT } from './demoCardCap.js';

// Root pricing object — both "per month" (shown on the cards) and "billed"
// (shown on the Billing tab) figures derive from these so they can't drift.
//   monthly: $25/mo billed monthly        → $25/mo
//   annual:  $20/mo billed annually ($240) → saves $60/yr vs monthly
export const PRICING = {
  monthly: { perMonth: 25, billed: 25,  perMonthLabel: '$25', billedLabel: '$25/mo' },
  annual:  { perMonth: 20, billed: 240, perMonthLabel: '$20', billedLabel: '$240/yr', savings: '$60/yr' },
};

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
// Completeness/identity leads ("the complete studio") — selling a professional
// creative toolkit converts better than leading with storage/limits, which
// reads like a hosting plan. Storage and edit access stay, as support.
export const CREATOR_FEATURES = [
  'The **complete studio** — unlimited clusters, boards & files',
  'Any file, any size — your own **100GB** drive',
  "Full **edit access**, everywhere you're invited",
  'Every creative tool, unlocked',
  'All Virtual + Social events',
];

// Demo is intentionally minimal: it's a 100-card sandbox, and visitors only
// get View Mode (no editing of boards shared by others). Nothing else to list.
export const DEMO_FEATURES = [
  'Unlimited visitors with **View Mode only**',
  '**100 cards** to explore the workspace',
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

export function planLabel({ tier, plan, demoCardCount, grantBacked } = {}) {
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
    return `Free Demo · ${n}/${DEMO_CARD_LIMIT} cards`;
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

export function formatPeriodEnd(dateLike, { cancel } = {}) {
  if (!dateLike) return null;
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  return {
    label: cancel ? 'Ends' : 'Renews',
    value: d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
  };
}
