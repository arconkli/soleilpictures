// PricingModal — in-app upgrade UI. Wraps the same Creator-card content
// as the public PricingPage (via the shared PricingBits), but in a modal
// shell so demo users can upgrade without leaving their workspace.
//
// Presentations by `header` (all in the confident "Studio" voice):
//   • null          → generic ("Everything your work deserves")
//   • "cap-hit"     → demo card cap reached
//   • "first-value" → first genuine card placed (warm nudge)
//   • "storage"     → paid-only file/upload gate
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
import { CTA, CREATOR_FEATURES, PRICING, COPY_REV } from '../lib/billingCopy.js';
import { trackViewContent } from '../lib/metaPixel.js';

export function PricingModal({ onClose, header = null, surface = 'modal' }) {
  const { user } = useAuth();
  const { tier } = useMyTier({ userId: user?.id });
  const [plan, setPlan]   = useState('monthly'); // monthly-first: annual-default drove pricing abandons (24/28 in 30d)
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const redirectingRef = useRef(false);   // suppress abandon while a checkout redirect is in flight

  useEffect(() => {
    logEventOnce(`pricing_view:modal:${header || 'generic'}`, 'pricing_view', { surface: 'modal', header, copy_rev: COPY_REV });
    // Meta ViewContent — mid-funnel ad-optimization signal. Matches the
    // monthly-first default plan.
    trackViewContent({ content_name: 'Creator', value: PRICING.monthly.billed, currency: 'USD' });
  }, [header]);
  useDwellTime(EV.PRICING_DWELL, () => ({ surface: 'modal', header }));

  const alreadyPaid = tier === 'paid' || tier === 'admin';
  const onPlanToggle = (p) => { logEvent(EV.PRICING_PLAN_TOGGLE, { plan: p, surface: 'modal' }); setPlan(p); };

  const onCta = async () => {
    setError(null);
    setBusy(true);
    redirectingRef.current = true;
    logEventNow(EV.PRICING_CREATOR_INTENT, { plan, surface, already_paid: alreadyPaid, copy_rev: COPY_REV });
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
              <div className="upgrade-eyebrow t-eyebrow">CREATOR</div>
              <h2 className="upgrade-title">Your work outgrew the demo.</h2>
              <p className="upgrade-sub t-body">You've built enough to feel it. Step into the complete studio — unlimited clusters, any file, full edit access — or invite friends to earn more free cards.</p>
            </>
          ) : header === 'first-value' ? (
            <>
              <div className="upgrade-eyebrow t-eyebrow">CREATOR</div>
              <h2 className="upgrade-title">You're building something.</h2>
              <p className="upgrade-sub t-body">Your first cluster is taking shape. Creator is the complete studio — unlimited space, any file, and full edit access. Everything your work deserves.</p>
            </>
          ) : header === 'storage' ? (
            <>
              <div className="upgrade-eyebrow t-eyebrow">CREATOR</div>
              <h2 className="upgrade-title">Room for everything you make.</h2>
              <p className="upgrade-sub t-body">Drop any file, any size — video, design files, docs — straight onto your clusters, backed by your own 100GB drive.</p>
            </>
          ) : (
            <>
              <div className="upgrade-eyebrow t-eyebrow">CREATOR</div>
              <h2 className="upgrade-title">Everything your work deserves.</h2>
              <p className="upgrade-sub t-body">The complete studio — unlimited clusters and files, any type, any size, and full edit access everywhere you're invited.</p>
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

        {/* Card-count contexts only: bonus cards from inviting friends unlock the
            SAME thing the cap-hit/first-value paywall is about. Not shown for
            shared-edit / storage, which are genuinely paid-only. Decoupled via a
            window event so it works from every PricingModal mount. */}
        {!alreadyPaid && tier === 'demo' && (header === 'cap-hit' || header === 'first-value' || header === null) && (
          <button
            type="button"
            className="upgrade-invite-alt"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', marginTop: 2,
              color: 'var(--soleil, #ffa500)', fontSize: 13, fontWeight: 600,
              textDecoration: 'underline', textUnderlineOffset: 3,
            }}
            onClick={() => {
              try { window.dispatchEvent(new CustomEvent('soleil:open-invite', { detail: { surface: 'cap_modal' } })); } catch (_) {}
              onClose?.();
            }}
          >
            Or invite friends to earn more free cards →
          </button>
        )}

        <button className="upgrade-later" onClick={handleClose}>Maybe later</button>
      </div>
    </div>,
    document.body,
  );
}
