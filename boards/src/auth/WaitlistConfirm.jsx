// WaitlistConfirm — status page for authed tier='waitlist' users.
//
// Deliberately minimal: a small pulsing eyebrow, a single calm headline,
// one line of subtext. No date — just "we'll be in touch soon." Below a
// hairline divider, an inline plan picker (Monthly | Annual) with a
// quiet "Subscribe →" text link for the rare user who wants to skip the
// wait without leaving the page.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from './AuthGate.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { logEvent } from '../lib/analytics.js';

const CHECKOUT_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/create-checkout-session';

export function WaitlistConfirm() {
  const { user, signOut } = useAuth();
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState('annual');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('waitlist_entries')
        .select('status')
        .eq('email', user.email.toLowerCase())
        .maybeSingle();
      if (!cancelled) {
        setEntry(data || null);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.email]);

  const startCheckout = async () => {
    setCheckoutError(null);
    setCheckoutBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Not signed in.');
      logEvent('checkout_open', { plan, surface: 'waitlist_status' });
      const res = await fetch(CHECKOUT_URL, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error || `HTTP ${res.status}`);
      window.location.assign(body.url);
    } catch (err) {
      setCheckoutError(err?.message || String(err));
      setCheckoutBusy(false);
    }
  };

  return (
    <div className="pricing-screen">
      <div className="auth-glow" aria-hidden="true" />

      <header className="pricing-header">
        <SoleilWordmark size="display" />
      </header>

      {loading ? (
        <div className="waitlist-status-card waitlist-status-card-loading">
          <p className="t-meta">Loading…</p>
        </div>
      ) : !entry ? (
        <div className="waitlist-status-card">
          <div className="waitlist-status-eyebrow t-eyebrow">No application yet</div>
          <h2 className="waitlist-status-title">Pick a path to continue.</h2>
          <p className="waitlist-status-sub t-body">
            We don't see a waitlist entry for <b>{user?.email}</b>. Submit
            your socials for review, or skip the wait with a paid plan.
          </p>
          <div className="waitlist-status-cta-row">
            <button
              className="pricing-cta pricing-cta-secondary waitlist-status-cta"
              onClick={() => { window.location.assign('/waitlist'); }}
            >
              Submit Socials →
            </button>
            <button
              className="pricing-cta pricing-cta-primary waitlist-status-cta"
              onClick={() => { window.location.assign('/pricing'); }}
            >
              See Pricing →
            </button>
          </div>
        </div>
      ) : entry.status === 'rejected' ? (
        <div className="waitlist-status-card">
          <div className="waitlist-status-eyebrow waitlist-status-eyebrow-muted t-eyebrow">
            Application reviewed
          </div>
          <h2 className="waitlist-status-title">Your demo wasn't approved.</h2>
          <p className="waitlist-status-sub t-body">
            We weren't able to offer you free demo access — but you can
            still skip the wait with a paid plan.
          </p>
          <button
            className="pricing-cta pricing-cta-primary waitlist-status-cta"
            onClick={() => { window.location.assign('/pricing'); }}
          >
            See Pricing →
          </button>
        </div>
      ) : (
        <article className="waitlist-status-card">
          <div className="waitlist-status-eyebrow t-eyebrow">
            <span className="waitlist-status-dot" aria-hidden="true" />
            On the waitlist
          </div>

          <h2 className="waitlist-status-title">We'll be in touch soon.</h2>
          <p className="waitlist-status-sub t-body">
            We're reviewing your application and will email you when a spot opens.
          </p>

          <div className="waitlist-status-divider" aria-hidden="true" />

          <div className="waitlist-status-skip">
            <div className="waitlist-status-skip-label t-meta">Don't want to wait?</div>
            <div className="waitlist-status-skip-row">
              <div className="pricing-card-toggle" role="tablist" aria-label="Billing interval">
                <button
                  role="tab"
                  aria-selected={plan === 'monthly'}
                  className={`pricing-toggle-pill ${plan === 'monthly' ? 'is-active' : ''}`}
                  onClick={() => setPlan('monthly')}
                  disabled={checkoutBusy}
                >
                  Monthly
                </button>
                <button
                  role="tab"
                  aria-selected={plan === 'annual'}
                  className={`pricing-toggle-pill ${plan === 'annual' ? 'is-active' : ''}`}
                  onClick={() => setPlan('annual')}
                  disabled={checkoutBusy}
                >
                  Annual
                </button>
              </div>
              <button
                className="waitlist-status-skip-link"
                onClick={startCheckout}
                disabled={checkoutBusy}
              >
                {checkoutBusy
                  ? 'Opening…'
                  : <>Subscribe for ${plan === 'annual' ? 20 : 25}/mo →</>}
              </button>
            </div>
            {checkoutError && <div className="auth-error t-meta">{checkoutError}</div>}
          </div>
        </article>
      )}

      <footer className="pricing-foot t-meta">
        Signed in as <b>{user?.email}</b>
        <span className="welcome-foot-sep">·</span>
        <button className="auth-link" onClick={signOut}>Use a different email</button>
      </footer>
    </div>
  );
}
