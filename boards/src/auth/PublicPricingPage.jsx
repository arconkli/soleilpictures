// PublicPricingPage — the signed-out, crawlable pricing page at /pricing.
//
// Routed BEFORE AuthGate (in main.jsx) so prospects — and search crawlers —
// can see real pricing without an account. This makes /pricing a distinct,
// indexable page (a common sitelink) and lets people decide before signing up.
//
// It is purely presentational: NO useAuth / useMyTier (there's no session) and
// it never starts checkout itself. The CTAs funnel visitors into sign-in at /,
// after which the in-app flow (TierRouter → PricingPage / WaitlistConfirm)
// takes over with the authoritative, account-aware checkout. Signed-in users
// never reach this component — main.jsx detects a cached session and falls
// through to the account-aware PricingPage instead.
//
// All copy/prices/markup are shared with the in-app PricingPage via billingCopy
// + PricingBits, so the two surfaces can never drift.

import { useEffect, useRef, useState } from 'react';
import { logEvent, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useDwellTime } from '../hooks/useDwellTime.js';
import { useLandingEngagement } from '../hooks/useLandingEngagement.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { FeatureList, PlanToggle, CreatorPriceRow } from '../components/PricingBits.jsx';
import { CTA, CREATOR_FEATURES, DEMO_FEATURES, PRICING } from '../lib/billingCopy.js';
import { trackViewContent } from '../lib/metaPixel.js';

const SURFACE = 'public_page';

export function PublicPricingPage() {
  const [plan, setPlan] = useState('monthly'); // monthly-first: annual-default drove pricing abandons

  useEffect(() => {
    const prev = document.title;
    // The Worker already injects this title at the edge on cold load; set it
    // again so it's correct after any client navigation too.
    document.title = 'Pricing · Soleil Clusters';
    logEventOnce('pricing_view:public_page', EV.PRICING_VIEW, { surface: SURFACE });
    // Meta ViewContent — mid-funnel ad-optimization signal. Both cards default
    // to the annual plan, so report that value (mirrors the in-app PricingPage).
    trackViewContent({ content_name: 'Creator', value: PRICING.annual.billed, currency: 'USD' });
    return () => { document.title = prev; };
  }, []);
  useDwellTime(EV.PRICING_DWELL, () => ({ surface: SURFACE }));

  // Uniform lp_* engagement package; .pricing-screen is the overflow scroller.
  const scrollRef = useRef(null);
  const lp = useLandingEngagement({
    page: '/pricing', pageKind: 'pricing',
    getScrollEl: () => scrollRef.current,
  });

  const onPlanToggle = (p) => { logEvent(EV.PRICING_PLAN_TOGGLE, { plan: p, surface: SURFACE }); setPlan(p); };

  // Signed-out → sign in first; the post-auth flow handles the actual upgrade.
  // The lp CTA click beacons (logEventNow) so it survives the navigation.
  const goSignIn = (ev, pos, extra) => {
    logEvent(ev, { surface: SURFACE, ...extra });
    lp.tracker.ctaClick(pos, '/');
    window.location.assign('/');
  };

  return (
    <div className="pricing-screen" ref={scrollRef}>
      <div className="auth-glow" aria-hidden="true" />

      <header className="pricing-header">
        <a
          href="/"
          aria-label="Soleil Clusters home"
          style={{ display: 'inline-flex', textDecoration: 'none', color: 'inherit' }}
        >
          <SoleilWordmark size="display" />
        </a>
      </header>

      <div className="pricing-grid">
        {/* DEMO */}
        <article className="pricing-card pricing-card-demo">
          <div className="pricing-card-head">
            <div className="pricing-card-name">Demo</div>
            <div className="pricing-card-price">$0</div>
          </div>
          <FeatureList features={DEMO_FEATURES} />
          <button
            className="pricing-cta pricing-cta-secondary"
            data-lp-cta="demo"
            onClick={() => goSignIn(EV.PRICING_DEMO_CTA, 'demo', { tier: 'signed_out' })}
          >
            Get started free
          </button>
        </article>

        {/* CREATOR (combined monthly/annual) */}
        <article className="pricing-card pricing-card-creator">
          <div className="pricing-card-head">
            <div className="pricing-card-name">Creator</div>
            <PlanToggle plan={plan} setPlan={onPlanToggle} />
          </div>

          <CreatorPriceRow plan={plan} />

          <FeatureList features={CREATOR_FEATURES} />

          <button
            className="pricing-cta pricing-cta-primary"
            data-lp-cta="creator"
            onClick={() => goSignIn(EV.PRICING_CREATOR_INTENT, 'creator', { plan, already_paid: false })}
          >
            {CTA.getCreator}
          </button>
        </article>
      </div>

      <footer className="pricing-foot t-meta">
        Already have an account? <a className="auth-link" href="/">Sign in</a>
        <span className="welcome-foot-sep">·</span>
        <a className="auth-link" href="/legal/privacy">Privacy</a>
        <span className="welcome-foot-sep">·</span>
        <a className="auth-link" href="/legal/terms">Terms</a>
      </footer>
    </div>
  );
}
