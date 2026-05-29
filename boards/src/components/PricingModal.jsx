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

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { logEvent } from '../lib/analytics.js';
import { startCheckout, startPortal } from '../lib/checkout.js';
import { useAuth } from '../auth/AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { FeatureList, PlanToggle, CreatorPriceRow } from './PricingBits.jsx';
import { CTA, CREATOR_FEATURES } from '../lib/billingCopy.js';

export function PricingModal({ onClose, header = null }) {
  const { user } = useAuth();
  const { tier } = useMyTier({ userId: user?.id });
  const [plan, setPlan]   = useState('annual');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { logEvent('pricing_view', { surface: 'modal', header }); }, [header]);

  const alreadyPaid = tier === 'paid' || tier === 'admin';

  const onCta = async () => {
    setError(null);
    setBusy(true);
    try {
      if (alreadyPaid) await startPortal({ surface: 'modal' });
      else             await startCheckout({ plan, surface: 'modal' });
    } catch (err) {
      setError(err?.message || String(err));
      setBusy(false);
    }
  };

  return createPortal(
    <div className="upgrade-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="upgrade-modal">
        <button className="upgrade-close" onClick={onClose} aria-label="Close">×</button>

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
            {!alreadyPaid && <PlanToggle plan={plan} setPlan={setPlan} disabled={busy} />}
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

        <button className="upgrade-later" onClick={onClose}>Maybe later</button>
      </div>
    </div>,
    document.body,
  );
}
