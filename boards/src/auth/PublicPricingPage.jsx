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
// + PricingBits + PricingPageView, so the two surfaces can never drift.
//
// Note on the primary action. It is "Start free", and the Creator button is
// beneath the comparison rather than beside it. That is not a softening of the
// offer: the price is stated in the subhead, above the fold. It is a correction
// of a mismatch — a signed-out visitor CANNOT check out from here (goSignIn is
// all the Creator button has ever done, because there is no session to bill),
// and essentially all of this page's traffic arrives from comparison pages
// whose own CTA promises a free tier with no card and no trial clock.

import { useEffect, useRef, useState } from 'react';
import { logEvent, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useDwellTime } from '../hooks/useDwellTime.js';
import { useLandingEngagement } from '../hooks/useLandingEngagement.js';
import { useUpsellExposure } from '../hooks/useUpsellExposure.js';
import { PricingPageView } from './PricingPageView.jsx';
import { CTA, PRICING, PRICING_PAGE } from '../lib/billingCopy.js';
import { trackViewContent } from '../lib/metaPixel.js';

const SURFACE = 'public_page';

export function PublicPricingPage() {
  const [plan, setPlan] = useState('monthly'); // monthly-first: annual-default drove pricing abandons

  // Uniform lp_* engagement package. The scroller is .seo-scroll now, not
  // .pricing-screen — the page scrolls rather than being centred in a fixed
  // viewport, which is the whole change.
  const scrollRef = useRef(null);
  const lp = useLandingEngagement({
    page: '/pricing', pageKind: 'pricing',
    getScrollEl: () => scrollRef.current,
  });

  // up_* exposure telemetry. The trace stays off here by the arming rule
  // (lp_trace already covers anonymous visitors on this page); feature-row
  // hovers + the exposure summary still fire.
  const up = useUpsellExposure({
    surface: SURFACE, tier: 'signed_out',
    getRootEl: () => scrollRef.current,
  });

  useEffect(() => {
    const prev = document.title;
    // The Worker already injects this title at the edge on cold load; set it
    // again so it's correct after any client navigation too.
    // Em dash to match the Worker-injected <title> (ROUTE_META) — Google
    // indexes that one; the hydrated tab should read identically.
    document.title = 'Pricing — Soleil Clusters';
    // envelope() adds copy_rev (previously missing here) + exposure_n.
    logEventOnce('pricing_view:public_page', EV.PRICING_VIEW, { ...up.envelope(), surface: SURFACE });
    // Meta ViewContent — mid-funnel ad-optimization signal. Matches the
    // monthly-first default plan (mirrors the in-app PricingPage + modal).
    trackViewContent({ content_name: 'Creator', value: PRICING.monthly.billed, currency: 'USD' });
    return () => { document.title = prev; };
  }, [up]);
  useDwellTime(EV.PRICING_DWELL, () => ({ surface: SURFACE }));

  const onPlanToggle = (p) => {
    const t = up.planToggle(p);
    logEvent(EV.PRICING_PLAN_TOGGLE, { plan: p, surface: SURFACE, ...t });
    setPlan(p);
  };

  // Signed-out → sign in first; the post-auth flow handles the actual upgrade.
  // The lp CTA click beacons (logEventNow) so it survives the navigation; the
  // up_* summary beacons from the pagehide the navigation causes.
  const goSignIn = (ev, pos, extra) => {
    up.outcome(pos === 'creator' ? 'cta' : 'demo_cta', { plan: extra?.plan });
    logEvent(ev, { surface: SURFACE, ...extra });
    lp.tracker.ctaClick(pos, '/');
    window.location.assign('/');
  };

  return (
    <PricingPageView
      scrollRef={scrollRef}
      plan={plan}
      onPlanToggle={onPlanToggle}
      ctaProps={lp.ctaProps}
      onFaqOpen={(i, q) => lp.faqOpen(i, q)}
      freeCta={{
        label: PRICING_PAGE.startFree,
        onClick: () => goSignIn(EV.PRICING_DEMO_CTA, 'demo', { tier: 'signed_out' }),
      }}
      creatorCta={{
        label: CTA.getCreator,
        onClick: () => goSignIn(EV.PRICING_CREATOR_INTENT, 'creator', { plan, already_paid: false }),
      }}
      footer={
        <div className="pp-foot t-meta">
          Already have an account? <a className="auth-link" href="/">Sign in</a>
          <span className="welcome-foot-sep">·</span>
          <a className="auth-link" href="/legal/privacy">Privacy</a>
          <span className="welcome-foot-sep">·</span>
          <a className="auth-link" href="/legal/terms">Terms</a>
        </div>
      }
    />
  );
}
