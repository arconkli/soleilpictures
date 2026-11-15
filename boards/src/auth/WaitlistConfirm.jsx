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
import { checkoutErrorMessage } from '../lib/checkoutErrors.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { CTA } from '../lib/billingCopyWords.js';
import { logEvent, logEventNow, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useDwellTime } from '../hooks/useDwellTime.js';
import { qaWaitlistStatus } from '../lib/localMode.js';
import { Check } from '../lib/icons.js';
import { Icon } from '../components/Icon.jsx';
import { t as tr, ph } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const POLL_MS = 10000;

export function WaitlistConfirm() {
  const { user, signOut } = useAuth();
  const { tier, refetch } = useMyTier({ userId: user?.id });
  const [entry, setEntry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState('monthly'); // monthly-first: annual-default drove pricing abandons
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const [accepted, setAccepted] = useState(false);
  const redirected = useRef(false);
  const [qaStatus] = useState(qaWaitlistStatus);   // dev-only ?wlstatus= override

  const loadEntry = useRef(null);
  loadEntry.current = async () => {
    // Dev preview: stub the entry so each status branch renders without an
    // authenticated waitlist_entries row (no-op in prod / without ?local=1).
    if (qaStatus !== undefined) {
      setEntry(qaStatus === 'none' ? null : { status: qaStatus });
      setLoading(false);
      return;
    }
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
    logEventNow(EV.WAITLIST_ACCEPTED_SEEN, { tier });
    const t = setTimeout(() => { window.location.assign('/'); }, 2200);
    return () => clearTimeout(t);
  }, [tier]);

  // Status-page analytics: one view event once the entry resolves, plus dwell.
  const statusLabel = loading ? null : (entry ? (entry.status || 'pending') : 'none');
  useEffect(() => {
    if (statusLabel) logEventOnce('waitlist_status_view', EV.WAITLIST_STATUS_VIEW, { status: statusLabel });
  }, [statusLabel]);
  useDwellTime(EV.WAITLIST_STATUS_DWELL, () => ({ status: statusLabel || 'loading' }));

  const startSkipCheckout = async () => {
    setCheckoutError(null);
    setCheckoutBusy(true);
    try {
      logEventNow(EV.WAITLIST_SUBSCRIBE_CTA, { plan });
      await startCheckout({ plan, surface: 'waitlist_status' });
    } catch (err) {
      setCheckoutError(checkoutErrorMessage(err));
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
          <div className="welcome-eyebrow t-eyebrow"><Trans>YOU'RE IN</Trans></div>
          <p className="welcome-copy t-body">
            <Trans>A spot just opened up — taking you into Clusters…</Trans>
          </p>
          <div className="payment-spinner" aria-label={tr`Loading your workspace`} />
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
          <p className="t-meta"><Trans>Loading…</Trans></p>
        </div>
      ) : !entry ? (
        <div className="waitlist-status-card">
          <div className="waitlist-status-eyebrow t-eyebrow"><Trans>No application yet</Trans></div>
          <h2 className="waitlist-status-title"><Trans>Pick a path to continue.</Trans></h2>
          <p className="waitlist-status-sub t-body">
            <Trans>We don't see a waitlist entry for <b>{ph({ email: user?.email })}</b>. Submit
            your socials for review, or skip the wait with a paid plan.</Trans>
          </p>
          <div className="waitlist-status-cta-row">
            <button
              className="pricing-cta pricing-cta-secondary waitlist-status-cta"
              onClick={() => { logEventNow(EV.WELCOME_CTA, { target: 'waitlist', from: 'waitlist_status' }); window.location.assign('/waitlist'); }}
            >
              <Trans>Submit Socials →</Trans>
            </button>
            <button
              className="pricing-cta pricing-cta-primary waitlist-status-cta"
              onClick={() => { logEventNow(EV.WELCOME_CTA, { target: 'pricing', from: 'waitlist_status' }); window.location.assign('/pricing'); }}
            >
              <Trans>See Pricing →</Trans>
            </button>
          </div>
        </div>
      ) : entry.status === 'rejected' ? (
        <div className="waitlist-status-card">
          <div className="waitlist-status-eyebrow waitlist-status-eyebrow-muted t-eyebrow">
            <Trans>Application reviewed</Trans>
          </div>
          <h2 className="waitlist-status-title"><Trans>Your demo wasn't approved.</Trans></h2>
          <p className="waitlist-status-sub t-body">
            <Trans>We weren't able to offer you free demo access this round — we
            review applications carefully to keep the community strong.
            You can still skip the wait with a paid plan, or write to us
            at <a className="auth-link" href="mailto:hello@soleilpictures.com?subject=Demo%20application">hello@soleilpictures.com</a> if
            you think we got it wrong.</Trans>
          </p>
          <button
            className="pricing-cta pricing-cta-primary waitlist-status-cta"
            onClick={() => { logEventNow(EV.WELCOME_CTA, { target: 'pricing', from: 'waitlist_rejected' }); window.location.assign('/pricing'); }}
          >
            <Trans>See Pricing →</Trans>
          </button>
        </div>
      ) : (
        <>
          {/* Status — floating text, no container. */}
          <section className="waitlist-status">
            <div className="waitlist-status-eyebrow t-eyebrow">
              <Trans>On the waitlist</Trans>
            </div>
            <h2 className="waitlist-status-title"><Trans>We'll be in touch soon.</Trans></h2>
            <p className="waitlist-status-sub t-body">
              <Trans>We're reviewing your application and will email you when a spot opens.</Trans>
            </p>
          </section>

          {/* Skip — small subtle box. */}
          <section className="waitlist-skip">
            <div className="waitlist-skip-label t-meta"><Trans>Don't want to wait?</Trans></div>
            <div className="waitlist-skip-row">
              <div className="pricing-card-toggle" role="tablist" aria-label={tr`Billing interval`}>
                <button
                  role="tab"
                  aria-selected={plan === 'monthly'}
                  className={`pricing-toggle-pill ${plan === 'monthly' ? 'is-active' : ''}`}
                  onClick={() => { logEvent(EV.WAITLIST_PLAN_TOGGLE, { plan: 'monthly' }); setPlan('monthly'); }}
                  disabled={checkoutBusy}
                >
                  <Trans>Monthly</Trans>
                </button>
                <button
                  role="tab"
                  aria-selected={plan === 'annual'}
                  className={`pricing-toggle-pill ${plan === 'annual' ? 'is-active' : ''}`}
                  onClick={() => { logEvent(EV.WAITLIST_PLAN_TOGGLE, { plan: 'annual' }); setPlan('annual'); }}
                  disabled={checkoutBusy}
                >
                  <Trans>Annual</Trans>
                </button>
              </div>
              <button
                className="waitlist-skip-cta"
                onClick={startSkipCheckout}
                disabled={checkoutBusy}
              >
                {checkoutBusy ? tr`Opening…` : CTA.subscribeShort(plan)}
              </button>
            </div>
            {checkoutError && <div className="auth-error t-meta">{checkoutError}</div>}
          </section>
        </>
      )}

      <footer className="pricing-foot t-meta">
        <Trans>Signed in as</Trans> <b>{user?.email}</b>
        <span className="welcome-foot-sep">·</span>
        <button className="auth-link" onClick={() => { logEvent(EV.WAITLIST_SIGNOUT); signOut(); }}><Trans>Use a different email</Trans></button>
      </footer>
    </div>
  );
}
