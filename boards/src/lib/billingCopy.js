// Single source of truth for billing-related strings. Lives outside the
// two billing surfaces (SettingsPanel BillingTab + BillingPage) so the
// plan label, pricing, and date format only have to be edited once.

const MONTHLY_PRICE = '$25/mo';
const ANNUAL_PRICE  = '$240/yr';

export function planLabel({ tier, plan, demoCardCount } = {}) {
  if (tier === 'admin') return 'Admin · Unlimited';
  if (tier === 'paid') {
    return plan === 'annual'
      ? `Creator · Annual (${ANNUAL_PRICE})`
      : `Creator · Monthly (${MONTHLY_PRICE})`;
  }
  if (tier === 'demo') {
    const n = Number.isFinite(demoCardCount) ? demoCardCount : 0;
    return `Free Demo · ${n}/100 cards`;
  }
  return 'Waitlist · not yet active';
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
