// Shared Creator-card internals, used by both the public PricingPage and the
// in-app PricingModal so the plan toggle, price row, and feature list are
// guaranteed identical on every surface. All copy/prices come from
// billingCopy.js — these components only own the (shared) markup + classes.
//
// The data-up-* attributes are hover-zone markers for the upsell telemetry
// (hooks/useUpsellExposure.js): feature rows report WHICH pitch line a
// prospect read, the price row and primary CTAs report hesitation. Stamped
// only on the Creator list — DEMO_FEATURES rows carry no Creator keys.

import { PRICING, planPerMonth, planBilling, CREATOR_FEATURES, CREATOR_FEATURE_KEYS } from '../lib/billingCopy.js';

// Render a feature string, turning `**text**` spans into <b>.
function renderEmphasis(text) {
  return text.split('**').map((seg, i) => (i % 2 === 1 ? <b key={i}>{seg}</b> : seg));
}

export function FeatureList({ features = CREATOR_FEATURES, className = 'pricing-features' }) {
  const isCreator = features === CREATOR_FEATURES;
  return (
    <ul className={className}>
      {features.map((f, i) => (
        <li
          key={i}
          {...(isCreator ? { 'data-up-feat': i, 'data-up-featkey': CREATOR_FEATURE_KEYS[i] } : {})}
        >
          {renderEmphasis(f)}
        </li>
      ))}
    </ul>
  );
}

// Monthly | Annual pills. The annual pill carries a prominent savings badge so
// the better deal reads at a glance.
export function PlanToggle({ plan, setPlan, disabled }) {
  return (
    <div className="pricing-card-toggle" role="tablist" aria-label="Billing interval">
      <button
        role="tab"
        aria-selected={plan === 'monthly'}
        className={`pricing-toggle-pill ${plan === 'monthly' ? 'is-active' : ''}`}
        data-up-toggle="monthly"
        onClick={() => setPlan('monthly')}
        disabled={disabled}
      >
        Monthly
      </button>
      <button
        role="tab"
        aria-selected={plan === 'annual'}
        className={`pricing-toggle-pill ${plan === 'annual' ? 'is-active' : ''}`}
        data-up-toggle="annual"
        onClick={() => setPlan('annual')}
        disabled={disabled}
      >
        Annual
        <span className="pricing-card-save">Save 20%</span>
      </button>
    </div>
  );
}

export function CreatorPriceRow({ plan }) {
  const billing = planBilling(plan);
  return (
    <div className="pricing-card-price-row" data-up-price="">
      <div className="pricing-card-price">
        ${planPerMonth(plan)}<span className="pricing-card-price-unit">/mo</span>
      </div>
      <div className="pricing-card-price-sub t-meta">
        {billing.save ? <>{billing.lead} · <b>{billing.save}</b></> : <>{billing.lead}</>}
      </div>
    </div>
  );
}

export { PRICING };
