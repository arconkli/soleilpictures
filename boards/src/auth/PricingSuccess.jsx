// PricingSuccess — returned-to URL after a Stripe Checkout completes.
//
// Activation is belt-and-suspenders. The Stripe webhook (stripe-webhook
// edge function) flips tier=paid asynchronously. We don't trust it as the
// only path:
//
//   1. On mount, call verify-checkout-session with the ?session_id= param.
//      That function asks Stripe directly whether the session is paid; if so,
//      it runs the same upsert + tier flip as the webhook. Activation happens
//      in the same request, no waiting on Stripe→Supabase delivery.
//   2. Poll get_my_tier every 2s as a fallback in case the webhook is
//      what actually wins the race (or if Stripe still says "open" on the
//      first verify call). We keep polling even on the missing-session and
//      stalled screens so a late webhook activation still lands the user in.
//   3. After ~30s with no flip, show a stalled card with a "Verify now"
//      retry button and a support mailto with the session_id prefilled.
//
// When the tier flips, we don't hard-bounce to "/" instantly — we show a
// brief, celebratory "Welcome to Creator" beat, then navigate. A fresh load
// re-reads the new tier in TierRouter and drops the user into the app.
//
// Missing session_id: if the URL has no ?session_id (stripped link, manual
// nav), we can't call verify — show a clear recovery card instead of an
// indefinite spinner. The tier poll still runs underneath in case a webhook
// activates them.
//
// Idempotency: verify-checkout-session uses upsert(onConflict: user_id),
// so calling it 10x in a row is safe.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { logEvent } from '../lib/analytics.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { supabase } from '../lib/supabase.js';
import { Check } from '../lib/icons.js';
import { Icon } from '../components/Icon.jsx';
import { PLAN_NAME } from '../lib/billingCopy.js';
import { trackPurchase } from '../lib/metaPixel.js';

const VERIFY_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/verify-checkout-session';
const POLL_MS    = 2000;     // get_my_tier
const VERIFY_MS  = 6000;     // server-side verify retry cadence
const STALL_MS   = 30000;    // show manual-retry UI after this much waiting
const CELEBRATE_MS = 2400;   // dwell on the success beat before entering

function planLabel(plan) {
  if (plan === 'annual')  return 'Annual';
  if (plan === 'monthly') return 'Monthly';
  return null;
}

export function PricingSuccess() {
  const { user, signOut } = useAuth();
  const { tier, refetch } = useMyTier({ userId: user?.id });
  const sessionId = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('session_id')
    : null;

  const [plan, setPlan]           = useState(null);    // 'monthly' | 'annual' once known
  const [stalled, setStalled]     = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyErr, setVerifyErr] = useState(null);
  const [celebrating, setCelebrating] = useState(false);
  const celebrated = useRef(false);
  const purchaseTracked = useRef(false);   // deduped browser Purchase fires once

  useEffect(() => { logEvent('checkout_success', { has_session_id: !!sessionId }); }, [sessionId]);

  const callVerify = useCallback(async () => {
    if (!sessionId) return null;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) return null;
      const res  = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const body = await res.json().catch(() => ({}));
      if (body?.plan) setPlan(body.plan);
      // Deduped browser Purchase — same eventID (Stripe session id) as the
      // server-side CAPI Purchase, so Meta collapses them into one conversion.
      if (body?.activated && !purchaseTracked.current) {
        purchaseTracked.current = true;
        trackPurchase({
          eventId: sessionId,
          value: typeof body.amount_total === 'number' ? body.amount_total / 100 : undefined,
          currency: body.currency || undefined,
        });
      }
      return body;
    } catch (e) {
      setVerifyErr(e?.message || String(e));
      return null;
    }
  }, [sessionId]);

  // First verify — fires on mount. Most checkouts will activate here, before
  // any polling interval even runs.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const body = await callVerify();
      if (cancelled) return;
      if (body?.activated) refetch();   // pulls the new tier='paid' immediately
    })();
    return () => { cancelled = true; };
  }, [callVerify, refetch]);

  // Celebration: the moment tier flips to paid/admin, dwell on a success beat
  // then navigate so TierRouter re-reads the fresh tier on a clean load.
  useEffect(() => {
    if (tier !== 'paid' && tier !== 'admin') return;
    if (celebrated.current) return;
    celebrated.current = true;
    setCelebrating(true);
    logEvent('checkout_activated_seen', { tier, plan });
    const t = setTimeout(() => { window.location.assign('/'); }, CELEBRATE_MS);
    return () => clearTimeout(t);
    // Depend on `tier` ONLY. If `plan` were a dep, a late plan resolution (when
    // the tier poll/webhook flips to paid BEFORE verify returns the plan) would
    // re-run this effect — its cleanup clearTimeout()s the pending redirect and
    // the celebrated-guard then skips re-arming it, stranding the user on the
    // success screen forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier]);

  // Polling: tier RPC (fast, always-on so a late webhook still lands the user)
  // + verify retry + stall timer (only meaningful when we actually have a
  // session to verify).
  useEffect(() => {
    if (tier === 'paid' || tier === 'admin') return;   // celebration owns this
    const tierTimer = setInterval(() => { refetch(); }, POLL_MS);
    let verifyTimer, stallTimer;
    if (sessionId) {
      verifyTimer = setInterval(() => { callVerify(); }, VERIFY_MS);
      stallTimer  = setTimeout(() => { setStalled(true); }, STALL_MS);
    }
    return () => {
      clearInterval(tierTimer);
      if (verifyTimer) clearInterval(verifyTimer);
      if (stallTimer)  clearTimeout(stallTimer);
    };
  }, [tier, refetch, callVerify, sessionId]);

  const onRetryClick = async () => {
    setVerifying(true);
    setVerifyErr(null);
    const body = await callVerify();
    setVerifying(false);
    if (body?.activated) {
      refetch();
    } else if (body?.reason && body.reason !== 'not_paid_yet') {
      setVerifyErr(body.reason);
    }
  };

  const supportHref = `mailto:hello@soleilpictures.com?subject=${encodeURIComponent('Clusters: payment received but not activated')}&body=${encodeURIComponent(`Session: ${sessionId || 'n/a'}\nUser: ${user?.email || user?.id || 'n/a'}`)}`;

  // ── Success beat ──────────────────────────────────────────────────────────
  if (celebrating || tier === 'paid' || tier === 'admin') {
    return (
      <div className="welcome-screen">
        <div className="auth-glow" aria-hidden="true" />
        <div className="welcome-card welcome-card-tight">
          <div className="payment-check payment-check-celebrate" aria-hidden="true">
            <Icon as={Check} size={32} weight="bold" />
          </div>
          <SoleilWordmark size="display" />
          <div className="welcome-eyebrow t-eyebrow">
            Welcome to {PLAN_NAME}{plan ? ` · ${planLabel(plan)}` : ''}
          </div>
          <p className="welcome-copy t-body">
            You're all set. Taking you into Clusters…
          </p>
          <div className="payment-spinner" aria-label="Entering" />
        </div>
      </div>
    );
  }

  // ── Missing session — nothing to verify ───────────────────────────────────
  if (!sessionId) {
    return (
      <div className="welcome-screen">
        <div className="auth-glow" aria-hidden="true" />
        <div className="welcome-card welcome-card-tight">
          <SoleilWordmark size="display" />
          <div className="welcome-eyebrow t-eyebrow">HMM — NO CHECKOUT FOUND</div>
          <p className="welcome-copy t-body">
            We couldn't find a checkout session in this link. If you just paid,
            your account will update automatically in a few seconds. Otherwise,
            head back to pricing to start over.
          </p>
          <div className="welcome-cta-row">
            <button
              className="welcome-cta welcome-cta-primary"
              onClick={() => { window.location.assign('/pricing'); }}
            >
              Back to pricing
            </button>
          </div>
          <p className="welcome-copy t-meta" style={{ color: 'var(--ink-3)' }}>
            Already paid? <a className="auth-link" href={supportHref}>Email support</a> and we'll sort it out.
          </p>
          <button className="auth-link auth-foot-link t-meta" onClick={signOut}>
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  // ── Activating / stalled ──────────────────────────────────────────────────
  return (
    <div className="welcome-screen">
      <div className="auth-glow" aria-hidden="true" />
      <div className="welcome-card welcome-card-tight">
        <div className="payment-check" aria-hidden="true">
          <Icon as={Check} size={32} weight="bold" />
        </div>
        <SoleilWordmark size="display" />

        {!stalled && (
          <>
            <div className="welcome-eyebrow t-eyebrow">
              Welcome to {PLAN_NAME}{plan ? ` · ${planLabel(plan)}` : ''}
            </div>
            <p className="welcome-copy t-body">
              Payment received. Activating your account…
            </p>
            <div className="payment-spinner" aria-label="Activating" />
          </>
        )}

        {stalled && (
          <>
            <div className="welcome-eyebrow t-eyebrow">PAYMENT RECEIVED</div>
            <p className="welcome-copy t-body">
              Stripe took the payment, but we haven't seen activation come through yet.
              This is usually a temporary delay — give it one more try.
            </p>
            <div className="welcome-cta-row">
              <button
                className="welcome-cta welcome-cta-primary"
                onClick={onRetryClick}
                disabled={verifying}
              >
                {verifying ? 'Checking…' : 'Verify now'}
              </button>
            </div>
            {verifyErr && (
              <p className="welcome-copy t-meta" style={{ color: 'var(--ink-3)' }}>
                {verifyErr}
              </p>
            )}
            <p className="welcome-copy t-meta" style={{ color: 'var(--ink-3)' }}>
              Still nothing? <a className="auth-link" href={supportHref}>Email support</a> — we'll sort it out.
            </p>
          </>
        )}

        <button className="auth-link auth-foot-link t-meta" onClick={signOut}>
          Use a different email
        </button>
      </div>
    </div>
  );
}
