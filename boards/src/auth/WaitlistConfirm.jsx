// WaitlistConfirm — status page for authed tier='waitlist' users.
//
// Deliberately minimal: a small pulsing eyebrow, a single calm headline,
// one line of subtext. No date — just "we'll be in touch soon." Below a
// hairline divider, an inline plan picker (Monthly | Annual) with a
// quiet "Subscribe →" text link for the rare user who wants to skip the
// wait without leaving the page.
//
// Auto-advance: while waiting, we poll the tier every 10s (the acceptance
// cron flips tier waitlist→demo server-side). The moment it flips, we show a
// brief "You're in" beat and hard-navigate to '/' so TierRouter re-reads the
// fresh tier and drops the user into the app — no manual refresh needed.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from './AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { startCheckout } from '../lib/checkout.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { CTA } from '../lib/billingCopy.js';
import { logEvent } from '../lib/analytics.js';
import { Check } from '../lib/icons.js';
import { Icon } from '../components/Icon.jsx';

const POLL_MS = 10000;

export function WaitlistConfirm() {
  const { user, signOut } = useAuth();
  const { tier, refetch } = useMyTier({ userId: user?.id });
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState('annual');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const redirected = useRef(false);

  const loadEntry = useRef(null);
  loadEntry.current = async () => {
    if (!user?.email) return;
    const { data } = await supabase
      .from('waitlist_entries')
      .select('status')
      .eq('email', user.email.toLowerCase())
      .maybeSingle();
    setEntry(data || null);
    setLoading(false);
  };

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;
    (async () => { if (!cancelled) await loadEntry.current(); })();
    return () => { cancelled = true; };
  }, [user?.email]);

  // Poll for acceptance: the cron flips tier away from 'waitlist' when a spot
  // opens. Re-fetch tier + the entry row so status copy stays fresh too.
  useEffect(() => {
    if (tier !== 'waitlist') return;
    const t = setInterval(() => { refetch(); loadEntry.current?.(); }, POLL_MS);
    return () => clearInterval(t);
  }, [tier, refetch]);

  // Tier flipped off 'waitlist' → accepted. Celebrate briefly, then hard-nav
  // so TierRouter re-reads the new tier on a clean load.
  useEffect(() => {
    if (!tier || tier === 'waitlist' || redirected.current) return;
    redirected.current = true;
    setAccepted(true);
    logEvent('waitlist_accepted_seen', { tier });
    const t = setTimeout(() => { window.location.assign('/'); }, 2200);
    return () => clearTimeout(t);
  }, [tier]);

  const startSkipCheckout = async () => {
    setCheckoutError(null);
    setCheckoutBusy(true);
    try {
      await startCheckout({ plan, surface: 'waitlist_status' });
    } catch (err) {
      setCheckoutError(err?.message || String(err));
      setCheckoutBusy(false);
    }
  };

  if (accepted) {
    return (
      <div className="pricing-screen">
        <div className="auth-glow" aria-hidden="true" />
        <div className="welcome-card welcome-card-tight">
          <div className="payment-check payment-check-celebrate" aria-hidden="true">
            <Icon as={Check} size={32} weight="bold" />
          </div>
          <SoleilWordmark size="display" />
          <div className="welcome-eyebrow t-eyebrow">YOU'RE IN</div>
          <p className="welcome-copy t-body">
            A spot just opened up — taking you into Clusters…
          </p>
          <div className="payment-spinner" aria-label="Loading your workspace" />
        </div>
      </div>
    );
  }

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
        <>
          {/* Status — floating text, no container. */}
          <section className="waitlist-status">
            <div className="waitlist-status-eyebrow t-eyebrow">
              On the waitlist
            </div>
            <h2 className="waitlist-status-title">We'll be in touch soon.</h2>
            <p className="waitlist-status-sub t-body">
              We're reviewing your application and will email you when a spot opens.
            </p>
          </section>

          {/* Skip — small subtle box. */}
          <section className="waitlist-skip">
            <div className="waitlist-skip-label t-meta">Don't want to wait?</div>
            <div className="waitlist-skip-row">
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
                className="waitlist-skip-cta"
                onClick={startSkipCheckout}
                disabled={checkoutBusy}
              >
                {checkoutBusy ? 'Opening…' : CTA.subscribeShort(plan)}
              </button>
            </div>
            {checkoutError && <div className="auth-error t-meta">{checkoutError}</div>}
          </section>
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
