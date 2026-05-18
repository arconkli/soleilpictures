// WaitlistConfirm — status page shown after submitting the waitlist or
// returning to /waitlist/status as an authed tier='waitlist' user.
//
// Two halves:
//   1. A minimal status panel — eyebrow + pulsing dot, big headline, and
//      the scheduled accept date as a centered "around …" hero line with
//      a small days-remaining caption below.
//   2. A compact "skip the wait" card with a monthly/annual toggle and
//      a single "Get instant access" button that opens Stripe Checkout.
//
// Reads the user's own entry via the RLS-allowed select on their email
// (after migration 0073 fixed the profiles-policy recursion that made
// this query return null for everyone).

import { useEffect, useMemo, useState } from 'react';
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
        .select('scheduled_accept_at, status, created_at')
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

  const fmt = useMemo(() => {
    if (!entry?.scheduled_accept_at) return null;
    const accept = new Date(entry.scheduled_accept_at);
    const now = new Date();
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysLeft = Math.max(0, Math.ceil((accept - now) / msPerDay));
    return {
      acceptLong: accept.toLocaleDateString(undefined, {
        weekday: 'long', month: 'long', day: 'numeric',
      }),
      daysLeft,
    };
  }, [entry]);

  return (
    <div className="pricing-screen">
      <div className="auth-glow" aria-hidden="true" />

      <header className="pricing-header">
        <SoleilWordmark size="display" />
      </header>

      {loading ? (
        <div className="waitlist-status-card waitlist-status-card-loading">
          <p className="t-body">Loading…</p>
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
            still skip the wait with a paid plan and get instant access.
          </p>
          <button
            className="pricing-cta pricing-cta-primary waitlist-status-cta"
            onClick={() => { window.location.assign('/pricing'); }}
          >
            See Pricing →
          </button>
        </div>
      ) : (
        <>
          {/* Status panel — minimal, date as the visual hero. */}
          <article className="waitlist-status-card">
            <div className="waitlist-status-eyebrow t-eyebrow">
              <span className="waitlist-status-dot" aria-hidden="true" />
              You're on the list
            </div>
            <h2 className="waitlist-status-title">We'll be in touch soon.</h2>

            {fmt?.acceptLong && (
              <div className="waitlist-status-hero">
                <div className="waitlist-status-hero-label t-meta">Around</div>
                <div className="waitlist-status-hero-date">{fmt.acceptLong}</div>
                <div className="waitlist-status-hero-sub t-meta">
                  {fmt.daysLeft === 0
                    ? 'Reviewing today'
                    : `~${fmt.daysLeft} day${fmt.daysLeft === 1 ? '' : 's'} remaining`}
                </div>
              </div>
            )}

            <p className="waitlist-status-sub t-meta">
              We'll email you the moment your spot opens.
            </p>
          </article>

          {/* Skip-the-wait — plan toggle + single CTA. */}
          <article className="waitlist-skip-card">
            <div className="waitlist-skip-head">
              <div className="waitlist-skip-eyebrow t-eyebrow">Don't want to wait?</div>
              <div className="waitlist-skip-title">Skip the wait — get instant access.</div>
            </div>

            <div className="waitlist-skip-plan-row">
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
              <div className="waitlist-skip-price">
                ${plan === 'annual' ? 20 : 25}
                <span className="waitlist-skip-price-unit">/mo</span>
              </div>
            </div>
            <div className="waitlist-skip-sub t-meta">
              {plan === 'annual'
                ? <>billed annually · <b>save $60/yr</b></>
                : <>billed monthly · cancel anytime</>}
            </div>

            {checkoutError && <div className="auth-error t-meta">{checkoutError}</div>}

            <div className="waitlist-skip-cta-row">
              <button
                className="pricing-cta pricing-cta-primary waitlist-skip-cta"
                onClick={startCheckout}
                disabled={checkoutBusy}
              >
                {checkoutBusy ? 'Opening checkout…' : 'Get instant access →'}
              </button>
              <button
                className="auth-link waitlist-skip-link t-meta"
                onClick={() => { window.location.assign('/pricing'); }}
                disabled={checkoutBusy}
              >
                Compare plans
              </button>
            </div>
          </article>
        </>
      )}

      <footer className="pricing-foot t-meta">
        Signed in as <b>{user?.email}</b>
        <span className="welcome-foot-sep">·</span>
        <button className="auth-link" onClick={signOut}>Use a different email</button>
      </footer>
    </div>
  );
}
