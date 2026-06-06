// PricingModal — in-app upgrade UI. Wraps the same Creator-card content
// as the public PricingPage (via the shared PricingBits), but in a modal
// shell so demo users can upgrade without leaving their workspace.
//
// Three presentations:
//   • header={null}         → generic upgrade prompt
//   • header="cap-hit"      → "You've reached your 100-card demo limit"
//   • header="shared-edit"  → "Editing shared boards is a Creator feature"
//
// Already-paid users (paid/admin) get the "Manage billing" path to the
// Stripe Customer Portal instead of a second checkout.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lockScroll, unlockScroll } from './Modal.jsx';
import { logEvent, logEventNow, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useDwellTime } from '../hooks/useDwellTime.js';
import { startCheckout, startPortal } from '../lib/checkout.js';
import { useAuth } from '../auth/AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { FeatureList, PlanToggle, CreatorPriceRow } from './PricingBits.jsx';
import { CTA, CREATOR_FEATURES, PRICING } from '../lib/billingCopy.js';
import { trackViewContent } from '../lib/metaPixel.js';

export function PricingModal({ onClose, header = null, surface = 'modal' }) {
  const { user } = useAuth();
  const { tier } = useMyTier({ userId: user?.id });
  const [plan, setPlan]   = useState('annual');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const redirectingRef = useRef(false);   // suppress abandon while a checkout redirect is in flight

  useEffect(() => {
    logEventOnce(`pricing_view:modal:${header || 'generic'}`, 'pricing_view', { surface: 'modal', header });
    // Meta ViewContent — mid-funnel ad-optimization signal. Defaults to annual.
    trackViewContent({ content_name: 'Creator', value: PRICING.annual.billed, currency: 'USD' });
  }, [header]);
  useDwellTime(EV.PRICING_DWELL, () => ({ surface: 'modal', header }));

  const alreadyPaid = tier === 'paid' || tier === 'admin';
  const onPlanToggle = (p) => { logEvent(EV.PRICING_PLAN_TOGGLE, { plan: p, surface: 'modal' }); setPlan(p); };

  const onCta = async () => {
    setError(null);
    setBusy(true);
    redirectingRef.current = true;
    logEventNow(EV.PRICING_CREATOR_INTENT, { plan, surface, already_paid: alreadyPaid });
    try {
      if (alreadyPaid) await startPortal({ surface });
      else             await startCheckout({ plan, surface });
    } catch (err) {
      redirectingRef.current = false;
      setError(err?.message || String(err));
      setBusy(false);
    }
  };

  // Closing without a redirect in flight = abandon.
  const handleClose = () => {
    if (!redirectingRef.current) logEvent(EV.PRICING_ABANDON, { header, plan, surface: 'modal' });
    onClose?.();
  };

  // Escape-to-close + body scroll-lock. This modal keeps its own
  // upgrade-backdrop DOM (its z-index can't move onto <Modal> without a CSS
  // reshuffle), so it shares Modal's ref-counted scroll lock directly.
  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;
  useEffect(() => {
    lockScroll();
    const onKey = (e) => { if (e.key === 'Escape') handleCloseRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); unlockScroll(); };
  }, []);

  return createPortal(
    <div className="upgrade-backdrop" onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="upgrade-modal">
        <button className="upgrade-close" onClick={handleClose} aria-label="Close">×</button>

        <div className="upgrade-intro">
          {header === 'cap-hit' ? (
            <>
              <div className="upgrade-eyebrow t-eyebrow">100-CARD DEMO LIMIT</div>
              <h2 className="upgrade-title">You've filled up your demo workspace.</h2>
              <p className="upgrade-sub t-body">Upgrade to Creator for unlimited cards, boards, and edits on other people's boards.</p>
            </>
          ) : header === 'shared-edit' ? (
            <>
              <div className="upgrade-eyebrow t-eyebrow">EDIT ACCESS REQUIRED</div>
              <h2 className="upgrade-title">Editing shared boards is a Creator feature.</h2>
              <p className="upgrade-sub t-body">You can view this board. Upgrade to Creator to edit any board you've been invited to — plus unlimited cards and boards.</p>
            </>
          ) : header === 'first-value' ? (
            <>
              <div className="upgrade-eyebrow t-eyebrow">YOU'RE OFF THE GROUND</div>
              <h2 className="upgrade-title">Love it? Keep building.</h2>
              <p className="upgrade-sub t-body">You've made your first board. Upgrade to Creator for unlimited cards, boards, video/audio, and full edit access.</p>
            </>
          ) : (
            <>
              <div className="upgrade-eyebrow t-eyebrow">GO CREATOR</div>
              <h2 className="upgrade-title">Unlock everything.</h2>
              <p className="upgrade-sub t-body">Unlimited cards, boards, video/audio, and full edit access.</p>
            </>
          )}
        </div>

        <article className="pricing-card pricing-card-creator upgrade-card">
          <div className="pricing-card-head">
            <div className="pricing-card-name">Creator</div>
            {!alreadyPaid && <PlanToggle plan={plan} setPlan={onPlanToggle} disabled={busy} />}
          </div>

          {!alreadyPaid && <CreatorPriceRow plan={plan} />}

          <FeatureList features={CREATOR_FEATURES} />

          {error && <div className="auth-error t-meta">{error}</div>}

          <button className="pricing-cta pricing-cta-primary" onClick={onCta} disabled={busy}>
            {busy && <span className="cta-spinner" aria-hidden="true" />}
            {busy
              ? (alreadyPaid ? CTA.manageBillingBusy : CTA.getCreatorBusy)
              : (alreadyPaid ? CTA.manageBilling : CTA.getCreator)}
          </button>
        </article>

        <button className="upgrade-later" onClick={handleClose}>Maybe later</button>
      </div>
    </div>,
    document.body,
  );
}
