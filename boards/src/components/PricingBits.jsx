// Shared Creator-card internals, used by both the public PricingPage and the
// in-app PricingModal so the plan toggle, price row, and feature list are
// guaranteed identical on every surface. All copy/prices come from
// billingCopy.js — these components only own the (shared) markup + classes.
//
// The data-up-* attributes are hover-zone markers for the upsell telemetry
// (hooks/useUpsellExposure.js): feature rows report WHICH pitch line a
// prospect read, the price row and primary CTAs report hesitation. Stamped
// only on the Creator list — DEMO_FEATURES rows carry no Creator keys.

import { Stack, Files, ArrowsOutSimple, UsersThree } from '@phosphor-icons/react';
import {
  PRICING, planPerMonth, planBilling, CREATOR_FEATURES, CREATOR_FEATURE_KEYS,
  CREATOR_BENEFITS, SAVINGS_PCT_LABEL, trialPrice,
} from '../lib/billingCopy.js';

// One glyph per benefit, keyed by the STABLE up_feature_hover key rather than
// by index — so a reordered list cannot silently hand the cards icon to the
// workspace line. A key with no entry renders no icon and the row still lays
// out, which is the right failure for a fifth benefit someone adds in a hurry.
//
// Icons and not the old shared "✓": four identical ticks told the reader
// nothing except that there were four of something, and a benefit list whose
// whole measured problem is that nobody reads it cannot afford a column of
// decoration. These are thin, neutral ink, and at 17px they sit on the title's
// cap height. Gold stays on the button.
const BENEFIT_ICON = {
  cards:     Stack,
  filetypes: Files,
  storage:   ArrowsOutSimple,
  workspace: UsersThree,
};

// Render a feature string, turning `**text**` spans into <b>.
function renderEmphasis(text) {
  return text.split('**').map((seg, i) => (i % 2 === 1 ? <b key={i}>{seg}</b> : seg));
}

// The Creator benefits: icon, bold claim, one plain line under it.
//
// Why a single column and not the two it was: at 600px the two-column version
// gave each body ~28 characters of line, so every one of them ran to three
// lines of 12px grey — four paragraphs of fine print in a 2x2, which is what a
// reader skips rather than scans. Full width the same bodies are one line
// each, the four rows cost the same height as the two rows of paragraphs did,
// and there is an actual hierarchy to move down.
//
// `marked` exists because /pricing now renders this list AND a comparison
// table of the same three gates. Only one of them may carry data-up-feat or a
// single read counts twice; the page marks the card and leaves the table bare.
// data-up-feat / data-up-featkey are otherwise unchanged and still
// index-parallel, so up_feature_hover history survives this rewrite.
export function BenefitGrid({ benefits = CREATOR_BENEFITS, className = 'pricing-benefits', marked = true }) {
  return (
    <ul className={className}>
      {benefits.map((b, i) => {
        const Glyph = BENEFIT_ICON[b.key];
        return (
          <li key={b.key} {...(marked ? { 'data-up-feat': i, 'data-up-featkey': b.key } : {})}>
            <span className="pricing-benefit-i" aria-hidden="true">
              {Glyph && <Glyph size={17} weight="thin" />}
            </span>
            <span className="pricing-benefit-t">{b.title}</span>
            <span className="pricing-benefit-b">{renderEmphasis(b.body)}</span>
          </li>
        );
      })}
    </ul>
  );
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
        <span className="pricing-card-save">{SAVINGS_PCT_LABEL}</span>
      </button>
    </div>
  );
}

// The price when a trial is on the table: what it costs TODAY, large, with
// what it costs afterwards beside it. Same slot and same class as
// CreatorPriceRow so the two are interchangeable and the layout does not move
// between an eligible reader and an ineligible one.
export function TrialPriceRow({ plan }) {
  const p = trialPrice(plan);
  return (
    <div className="pricing-card-price-row" data-up-price="">
      <div className="pricing-card-price">
        {p.now}<span className="pricing-card-price-unit">{p.nowUnit}</span>
      </div>
      <div className="pricing-card-price-sub t-meta">{p.then}</div>
    </div>
  );
}

export function CreatorPriceRow({ plan }) {
  const billing = planBilling(plan);
  // On annual, show the monthly rate struck through beside the annual one. It
  // is not a fake anchor — $25 is what this plan actually costs month to
  // month — and it makes the saving legible at the price rather than only as
  // a badge on a toggle the reader may never touch. Same move as every
  // competitor's annual card, and the one place a strike-through is honest.
  const was = plan === 'annual' ? PRICING.monthly.perMonth : null;
  return (
    <div className="pricing-card-price-row" data-up-price="">
      <div className="pricing-card-price">
        {was != null && (
          <span className="pricing-card-price-was" aria-hidden="true">${was}</span>
        )}
        ${planPerMonth(plan)}<span className="pricing-card-price-unit">/mo</span>
      </div>
      <div className="pricing-card-price-sub t-meta">
        {billing.save ? <>{billing.lead} · <b>{billing.save}</b></> : <>{billing.lead}</>}
      </div>
    </div>
  );
}

export { PRICING };
