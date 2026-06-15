// AdWelcome — one-time, price-first offer screen shown to new demo users.
//
// Shown by TierRouter when tier==='demo' && adOfferPending. While the waitlist
// master switch is OFF (the default), the signup trigger sets that flag for
// EVERY new signup, so everyone lands here once — they SEE the Creator price and
// can buy on the spot, or step into the free workspace. Dismissing clears the
// flag (dismiss_ad_offer), so it's a one-time gate, not a recurring paywall.
//
// (When the waitlist is ON instead, only Facebook/Instagram ad-click traffic —
// detected via the fbclid appended to every ad click, while the ad campaign gate
// is on — carries the flag; organic signups hit the waitlist /welcome flow.)
// Named AdWelcome for historical reasons — it's now the universal welcome offer.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { logEvent, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useDwellTime } from '../hooks/useDwellTime.js';
import { startCheckout } from '../lib/checkout.js';
import { useAuth } from './AuthGate.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { FeatureList, PlanToggle, CreatorPriceRow } from '../components/PricingBits.jsx';
import { CREATOR_FEATURES, CTA, PRICING } from '../lib/billingCopy.js';
import { trackViewContent, trackAdLead } from '../lib/metaPixel.js';

// `onEnter` is invoked AFTER the offer flag has been cleared server-side, so the
// parent (TierRouter) can refetch tier and drop the user into the app.
export function AdWelcome({ onEnter }) {
  const { user, signOut } = useAuth();
  const [plan, setPlan]       = useState('annual');   // default to the better deal
  const [busy, setBusy]       = useState(false);      // checkout redirect in flight
  const [entering, setEntering] = useState(false);    // dismiss + enter in flight
  const [error, setError]     = useState(null);

  useEffect(() => {
    logEventOnce('ad_offer_view', EV.AD_OFFER_VIEW);
    // ViewContent — mid-funnel ad-optimization signal. Cards default to annual.
    trackViewContent({ content_name: 'Creator', value: PRICING.annual.billed, currency: 'USD' });
  }, []);
  useDwellTime(EV.AD_OFFER_DWELL);

  const onBuy = async () => {
    setError(null);
    setBusy(true);
    try {
      await startCheckout({ plan, surface: 'ad_offer' });   // redirects on success
    } catch (err) {
      setError(err?.message || String(err));
      setBusy(false);
    }
  };

  const onContinue = async () => {
    if (entering) return;
    setEntering(true);
    logEvent(EV.AD_OFFER_ENTER, { plan });
    // Ad-cohort Meta Lead (the parallel to the waitlist Lead) — fire-and-forget,
    // never blocks entering the app.
    supabase.auth.getSession().then(({ data }) => trackAdLead(data?.session)).catch(() => {});
    try { await supabase.rpc('dismiss_ad_offer'); } catch (_) { /* best-effort */ }
    try { await onEnter?.(); } catch (_) {}
  };

  return (
    <div className="pricing-screen">
      <div className="auth-glow" aria-hidden="true" />

      <header className="pricing-header">
        <SoleilWordmark size="display" />
      </header>

      <div className="surface-frosted welcome-request-card">
        <p className="waitlist-status-sub t-body">
          You're in. Step into your free workspace now — or unlock everything with
          Creator and skip the limits.
        </p>

        <article className="pricing-card pricing-card-creator">
          <div className="pricing-card-head">
            <div className="pricing-card-name">Creator</div>
            <PlanToggle plan={plan} setPlan={setPlan} disabled={busy || entering} />
          </div>

          <CreatorPriceRow plan={plan} />
          <FeatureList features={CREATOR_FEATURES} />

          {error && <div className="auth-error t-meta">{error}</div>}

          {/* Product-first for cold ad traffic: "Try it free" is the primary
              (gold) CTA so the workspace is one tap away, not a paywall dead-end
              — half of ad visitors used to bounce on this screen without ever
              entering the app. The paid offer stays visible but secondary. */}
          <div className="waitlist-status-cta-row">
            <button
              className="pricing-cta pricing-cta-primary waitlist-status-cta"
              onClick={onContinue}
              disabled={busy || entering}
            >
              {entering ? 'Starting…' : 'Try it free →'}
            </button>
            <button
              className="pricing-cta pricing-cta-secondary waitlist-status-cta"
              onClick={onBuy}
              disabled={busy || entering}
            >
              {busy ? CTA.getCreatorBusy : CTA.getCreator}
            </button>
          </div>
        </article>
      </div>

      <footer className="pricing-foot t-meta">
        Signed in as <b>{user?.email}</b>
        <span className="welcome-foot-sep">·</span>
        <button className="auth-link" onClick={() => { logEvent(EV.WELCOME_SIGNOUT); signOut(); }}>Use a different email</button>
      </footer>
    </div>
  );
}
