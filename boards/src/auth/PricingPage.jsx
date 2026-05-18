// PricingPage — two cards, Demo (free) + Creator (combined Monthly/Annual
// with a toggle). Mirrors screenshot 2 of the launch spec.
//
// Demo CTA  → /waitlist (back to the socials form)
// Creator CTA → calls create-checkout-session Edge Function → Stripe Checkout
//
// Available signed-in to anyone; tier='waitlist' uses it to skip the
// wait, tier='demo' uses it to upgrade.

import { useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from './AuthGate.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';

const EDGE_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/create-checkout-session';

export function PricingPage() {
  const { user, signOut } = useAuth();
  const [plan, setPlan]   = useState('annual');   // default to annual (better deal)
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);

  const startCheckout = async () => {
    setError(null);
    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Not signed in.');
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

  return (
    <div className="pricing-screen">
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
          <ul className="pricing-features">
            <li>Unlimited visitors with <b>View Mode only</b></li>
            <li>1 workspace with 5 editable boards</li>
            <li>100 video, image, doc, etc.</li>
            <li>100 cards</li>
            <li>10 audio files</li>
          </ul>
          <button
            className="pricing-cta pricing-cta-secondary"
            onClick={() => { window.location.assign('/waitlist'); }}
            disabled={busy}
          >
            Go to Waitlist
          </button>
        </article>

        {/* CREATOR (combined monthly/annual) */}
        <article className="pricing-card pricing-card-creator">
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
            <li>Unlimited visitors with <b>Edit Mode</b></li>
            <li>Unlimited workspaces, boards, video, and audio files</li>
            <li>All Creative Tools available</li>
            <li>High Resolution Exports</li>
            <li>Access to all Virtual + Social events</li>
          </ul>

          {error && <div className="auth-error t-meta">{error}</div>}

          <button
            className="pricing-cta pricing-cta-primary"
            onClick={startCheckout}
            disabled={busy}
          >
            {busy ? 'Opening checkout…' : 'Get Creator'}
          </button>
        </article>
      </div>

      <footer className="pricing-foot t-meta">
        Signed in as <b>{user?.email}</b>
        <span className="welcome-foot-sep">·</span>
        <button className="auth-link" onClick={signOut}>Use a different email</button>
      </footer>
    </div>
  );
}
