// PricingModal — in-app upgrade UI. Wraps the same Creator-card content
// as the public PricingPage, but in a modal shell so demo users can
// upgrade without leaving their workspace.
//
// Two presentations:
//   • header={null}     → generic upgrade prompt
//   • header="cap-hit"  → "You've reached your 100-card demo limit"

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase.js';
import { logEvent } from '../lib/analytics.js';

const EDGE_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/create-checkout-session';

export function PricingModal({ onClose, header = null }) {
  const [plan, setPlan]   = useState('annual');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { logEvent('pricing_view', { surface: 'modal', header }); }, [header]);

  const startCheckout = async () => {
    setError(null);
    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Not signed in.');
      logEvent('checkout_open', { plan, surface: 'modal' });
      const res = await fetch(EDGE_URL, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error || `HTTP ${res.status}`);
      window.location.assign(body.url);
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
            <div className="pricing-card-toggle" role="tablist" aria-label="Billing interval">
              <button
                role="tab"
                aria-selected={plan === 'monthly'}
                className={`pricing-toggle-pill ${plan === 'monthly' ? 'is-active' : ''}`}
                onClick={() => setPlan('monthly')}
                disabled={busy}
              >
                Monthly
              </button>
              <button
                role="tab"
                aria-selected={plan === 'annual'}
                className={`pricing-toggle-pill ${plan === 'annual' ? 'is-active' : ''}`}
                onClick={() => setPlan('annual')}
                disabled={busy}
              >
                Annual
              </button>
            </div>
          </div>

          <div className="pricing-card-price-row">
            <div className="pricing-card-price">${plan === 'annual' ? 20 : 25}<span className="pricing-card-price-unit">/mo</span></div>
            <div className="pricing-card-price-sub t-meta">
              {plan === 'annual'
                ? <>billed annually · <b>Save $60/yr</b></>
                : <>billed monthly</>}
            </div>
          </div>

          <ul className="pricing-features">
            <li>Unlimited cards across unlimited boards</li>
            <li>Edit access on others' boards (when invited)</li>
            <li>Invite editors to your boards</li>
            <li>All Creative Tools + high-res exports</li>
            <li>Access to all Virtual + Social events</li>
          </ul>

          {error && <div className="auth-error t-meta">{error}</div>}

          <button className="pricing-cta pricing-cta-primary" onClick={startCheckout} disabled={busy}>
            {busy ? 'Opening checkout…' : 'Get Creator'}
          </button>
        </article>

        <button className="upgrade-later" onClick={onClose}>Maybe later</button>
      </div>
    </div>,
    document.body,
  );
}
