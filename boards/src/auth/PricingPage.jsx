// PricingPage — the account-aware /pricing, for anyone signed in.
//
// Renders the SAME page as the signed-out route (PricingPageView); everything
// that differs is behaviour, not layout. Creator CTA → startCheckout(), or
// startPortal() for an account that already has a plan. tier='waitlist' uses
// this page to skip the wait; tier='demo' uses it to upgrade; paid/admin see
// "Manage billing" → the Stripe Customer Portal rather than a second checkout.
//
// It had ZERO views in the thirty days before this rewrite — nothing in the
// signed-in app links here, and BillingTab owns manage-billing. The route
// stays because WelcomePage, WaitlistConfirm and PricingSuccess all still
// assign('/pricing'), and because a third design is how two surfaces drift.

import { useEffect, useRef, useState } from 'react';
import { logEvent, logEventNow, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useDwellTime } from '../hooks/useDwellTime.js';
import { useUpsellExposure } from '../hooks/useUpsellExposure.js';
import { startCheckout, startPortal } from '../lib/checkout.js';
import { checkoutErrorMessage } from '../lib/checkoutErrors.js';
import { useAuth } from './AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { PricingPageView } from './PricingPageView.jsx';
import { CTA, grantCopy, PRICING, COPY_REV } from '../lib/billingCopy.js';
import { trackViewContent } from '../lib/metaPixel.js';
import { markPriceSeen } from '../lib/upsellLatches.js';
import { stampUpgradePrompt } from '../lib/upgradePrompts.js';

export function PricingPage() {
  const { user, signOut } = useAuth();
  const { tier, demoCardCount, effectiveCardLimit, subscriptionStatus, grantActive, grantExpiresAt } = useMyTier({ userId: user?.id });
  const [plan, setPlan]   = useState('monthly'); // monthly-first: annual-default drove pricing abandons
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const rootRef = useRef(null);

  // up_* exposure telemetry (summary fires on tab-hide/pagehide/unmount).
  // Card counts gate on a RESOLVED tier — useMyTier's pre-fetch placeholders
  // must never be recorded as measured values (null until real).
  const up = useUpsellExposure({
    surface: 'page', via: 'route',
    uid: user?.id, tier,
    userState: tier != null
      ? { demoCardCount, cardLimit: effectiveCardLimit, signupAt: user?.created_at }
      : { signupAt: user?.created_at },
    getRootEl: () => rootRef.current,
  });

  useEffect(() => {
    logEventOnce('pricing_view:page', EV.PRICING_VIEW, { ...up.envelope(), surface: 'page', copy_rev: COPY_REV });
    // Meta ViewContent — mid-funnel ad-optimization signal. Matches the
    // monthly-first default plan (the annual value survived the monthly-first
    // flip here and made this surface report 10× the modal's value for the
    // identical view).
    trackViewContent({ content_name: 'Creator', value: PRICING.monthly.billed, currency: 'USD' });
  }, [up]);
  // First price impression for this account on this device (see PricingModal).
  useEffect(() => {
    if (!user?.id || tier !== 'demo') return;
    if (markPriceSeen(user.id, 'page')) {
      logEvent(EV.PRICE_SEEN, { surface: 'page', count: demoCardCount, limit: effectiveCardLimit });
      stampUpgradePrompt({ price_seen_at: new Date().toISOString(), price_seen_surface: 'page' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, tier]);
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
    // Only a real upgrade click is a CTA outcome — an already-paid user's
    // "Manage billing" must not inflate the scorecard's CTA rate.
    if (!alreadyPaid) up.outcome('cta', { plan });
    logEventNow(EV.PRICING_CREATOR_INTENT, {
      plan, surface: 'page', already_paid: alreadyPaid, copy_rev: COPY_REV,
      via: 'route', exposure_n: up.envelope().exposure_n, ...up.timing(),
    });
    try {
      if (alreadyPaid) await startPortal({ surface: 'page' });
      else             await startCheckout({ plan, surface: 'page' });
    } catch (err) {
      up.noteError();
      setError(checkoutErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <PricingPageView
      scrollRef={rootRef}
      plan={plan}
      onPlanToggle={onPlanToggle}
      onFaqOpen={null}
      // A signed-in demo account is ALREADY on the free plan, so there is no
      // free action to offer and the hero/closing bands drop away with it. A
      // waitlist account still has somewhere to go.
      freeCta={isDemo || alreadyPaid ? null : {
        label: 'Go to Waitlist',
        onClick: (pos = 'demo') => {
          up.outcome('demo_cta');
          logEvent(EV.PRICING_DEMO_CTA, { surface: 'page', pos, tier });
          window.location.assign('/waitlist');
        },
      }}
      showPlanToggle={!alreadyPaid}
      showPrice={!alreadyPaid}
      stateLine={alreadyPaid ? (
        <p className="pricing-card-price-sub t-meta" style={{ marginTop: 4 }}>
          {grantLine
            || (tier === 'admin'
              ? 'You have unlimited admin access — no subscription needed.'
              : "You're already on Creator. Manage your plan, payment method, or cancellation below.")}
        </p>
      ) : null}
      error={error}
      creatorCta={{
        label: noPortal
          ? (grantBacked ? 'Complimentary access' : 'Your current plan')
          : busy
            ? (alreadyPaid ? CTA.manageBillingBusy : CTA.getCreatorBusy)
            : (alreadyPaid ? CTA.manageBilling : CTA.getCreator),
        onClick: noPortal ? undefined : onCreatorCta,
        disabled: busy || noPortal,
        busy,
      }}
      footer={
        <div className="pp-foot t-meta">
          Signed in as <b>{user?.email}</b>
          <span className="welcome-foot-sep">·</span>
          <button
            className="auth-link"
            onClick={() => { logEvent(EV.PRICING_SIGNOUT, { surface: 'page' }); signOut(); }}
          >
            Use a different email
          </button>
        </div>
      }
    />
  );
}
