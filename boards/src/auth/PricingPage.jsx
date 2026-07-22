// PricingPage — two cards, Demo (free) + Creator (combined Monthly/Annual
// with a toggle). Mirrors screenshot 2 of the launch spec.
//
// Demo CTA  → /waitlist (back to the socials form)
// Creator CTA → startCheckout() → Stripe Checkout
//
// Available signed-in to anyone; tier='waitlist' uses it to skip the
// wait, tier='demo' uses it to upgrade. Already-paid users (paid/admin)
// see "Manage billing" → Stripe Customer Portal instead of a second checkout.

import { useEffect, useRef, useState } from 'react';
import { logEvent, logEventNow, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useDwellTime } from '../hooks/useDwellTime.js';
import { useUpsellExposure } from '../hooks/useUpsellExposure.js';
import { startCheckout, startPortal } from '../lib/checkout.js';
import { useAuth } from './AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { FeatureList, PlanToggle, CreatorPriceRow } from '../components/PricingBits.jsx';
import { CTA, CREATOR_FEATURES, DEMO_FEATURES, grantCopy, PRICING, COPY_REV } from '../lib/billingCopy.js';
import { trackViewContent } from '../lib/metaPixel.js';

export function PricingPage() {
  const { user, signOut } = useAuth();
  const { tier, demoCardCount, effectiveCardLimit, subscriptionStatus, grantActive, grantExpiresAt } = useMyTier({ userId: user?.id });
  const [plan, setPlan]   = useState('monthly'); // monthly-first: annual-default drove pricing abandons
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const rootRef = useRef(null);

  // up_* exposure telemetry (summary fires on tab-hide/pagehide/unmount).
  const up = useUpsellExposure({
    surface: 'page', via: 'route',
    uid: user?.id, tier,
    userState: { demoCardCount, cardLimit: effectiveCardLimit, signupAt: user?.created_at },
    getRootEl: () => rootRef.current,
  });

  useEffect(() => {
    logEventOnce('pricing_view:page', 'pricing_view', { ...up.envelope(), surface: 'page', copy_rev: COPY_REV });
    // Meta ViewContent — mid-funnel ad-optimization signal. Both cards default to
    // the annual plan, so report that value.
    trackViewContent({ content_name: 'Creator', value: PRICING.annual.billed, currency: 'USD' });
  }, [up]);
  useDwellTime(EV.PRICING_DWELL, () => ({ surface: 'page' }));

  const alreadyPaid = tier === 'paid' || tier === 'admin';
  const isDemo = tier === 'demo';
  // Comped via an admin grant (no paying sub) or an admin — nothing to manage in
  // the Stripe portal, so the Manage-billing CTA would error. Show a note instead.
  const grantBacked = tier === 'paid' && grantActive && !['active', 'trialing'].includes(subscriptionStatus || '');
  const noPortal = grantBacked || tier === 'admin';
  const grantLine = grantBacked ? grantCopy({ grantActive, grantExpiresAt }) : null;

  const onPlanToggle = (p) => {
    const t = up.planToggle(p);
    logEvent(EV.PRICING_PLAN_TOGGLE, { plan: p, surface: 'page', ...t });
    setPlan(p);
  };

  const onCreatorCta = async () => {
    setError(null);
    setBusy(true);
    up.outcome('cta', { plan });
    logEventNow(EV.PRICING_CREATOR_INTENT, {
      plan, surface: 'page', already_paid: alreadyPaid, copy_rev: COPY_REV,
      via: 'route', exposure_n: up.envelope().exposure_n, ...up.timing(),
    });
    try {
      if (alreadyPaid) await startPortal({ surface: 'page' });
      else             await startCheckout({ plan, surface: 'page' });
    } catch (err) {
      up.noteError();
      setError(err?.message || String(err));
      setBusy(false);
    }
  };

  return (
    <div className="pricing-screen" ref={rootRef}>
      <div className="auth-glow" aria-hidden="true" />

      <header className="pricing-header">
        <SoleilWordmark size="display" />
      </header>

      <div className="pricing-grid">
        {/* DEMO */}
        <article className="pricing-card pricing-card-demo">
          <div className="pricing-card-head">
            <div className="pricing-card-name">Demo</div>
            <div className="pricing-card-price">$0</div>
          </div>
          <FeatureList features={DEMO_FEATURES} />
          {isDemo ? (
            // Already a demo user — this is their current plan, not a waitlist
            // step. Show a non-actionable indicator so they don't think they
            // have to re-join the waitlist; the Creator card is the upgrade.
            <button className="pricing-cta pricing-cta-secondary" disabled>
              Your current plan
            </button>
          ) : (
            <button
              className="pricing-cta pricing-cta-secondary"
              onClick={() => {
                up.outcome('demo_cta');
                logEventNow(EV.PRICING_DEMO_CTA, { surface: 'page', tier });
                window.location.assign('/waitlist');
              }}
              disabled={busy}
            >
              Go to Waitlist
            </button>
          )}
        </article>

        {/* CREATOR (combined monthly/annual) */}
        <article className="pricing-card pricing-card-creator">
          <div className="pricing-card-head">
            <div className="pricing-card-name">Creator</div>
            {!alreadyPaid && <PlanToggle plan={plan} setPlan={onPlanToggle} disabled={busy} />}
          </div>

          {!alreadyPaid && <CreatorPriceRow plan={plan} />}

          {alreadyPaid && (
            <p className="pricing-card-price-sub t-meta" style={{ marginTop: 4 }}>
              {grantLine
                ? grantLine
                : tier === 'admin'
                  ? 'You have unlimited admin access — no subscription needed.'
                  : "You're already on Creator. Manage your plan, payment method, or cancellation below."}
            </p>
          )}

          <FeatureList features={CREATOR_FEATURES} />

          {error && <div className="auth-error t-meta">{error}</div>}

          {noPortal ? (
            // Comped grant / admin — no Stripe customer to manage.
            <button className="pricing-cta pricing-cta-secondary" disabled>
              {grantBacked ? 'Complimentary access' : 'Your current plan'}
            </button>
          ) : (
            <button
              className="pricing-cta pricing-cta-primary"
              data-up-cta="creator"
              onClick={onCreatorCta}
              disabled={busy}
            >
              {busy
                ? (alreadyPaid ? CTA.manageBillingBusy : CTA.getCreatorBusy)
                : (alreadyPaid ? CTA.manageBilling : CTA.getCreator)}
            </button>
          )}
        </article>
      </div>

      <footer className="pricing-foot t-meta">
        Signed in as <b>{user?.email}</b>
        <span className="welcome-foot-sep">·</span>
        <button className="auth-link" onClick={() => { logEvent(EV.PRICING_SIGNOUT); signOut(); }}>Use a different email</button>
      </footer>
    </div>
  );
}
