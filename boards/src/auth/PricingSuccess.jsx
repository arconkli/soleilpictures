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
//      first verify call).
//   3. After ~30s with no flip, show a stalled card with a "Verify now"
//      retry button and a support mailto with the session_id prefilled.
//
// The route used to send users to "/" on stall, which silently dropped
// the polling state. Now stalls keep the user on this screen with a clear
// action.
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

const VERIFY_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/verify-checkout-session';
const POLL_MS    = 2000;     // get_my_tier
const VERIFY_MS  = 6000;     // server-side verify retry cadence
const STALL_MS   = 30000;    // show manual-retry UI after this much waiting

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
  const mountedAt = useRef(Date.now());

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

  // Polling: tier RPC (fast, always-on) + occasional verify retry (in case the
  // first call hit Stripe before payment finalized).
  useEffect(() => {
    if (tier === 'paid' || tier === 'admin') {
      window.location.assign('/');
      return;
    }
    const tierTimer   = setInterval(() => { refetch(); }, POLL_MS);
    const verifyTimer = setInterval(() => { callVerify(); }, VERIFY_MS);
    const stallTimer  = setTimeout(() => { setStalled(true); }, STALL_MS);
    return () => {
      clearInterval(tierTimer);
      clearInterval(verifyTimer);
      clearTimeout(stallTimer);
    };
  }, [tier, refetch, callVerify]);

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

  return (
    <div className="welcome-screen">
      <div className="auth-glow" aria-hidden="true" />
      <div className="welcome-card welcome-card-tight">
        <div className="payment-check" aria-hidden="true">
          <Icon icon={Check} size={32} weight="bold" />
        </div>
        <SoleilWordmark size="display" />

        {!stalled && (
          <>
            <div className="welcome-eyebrow t-eyebrow">
              Welcome to Creator{plan ? ` · ${planLabel(plan)}` : ''}
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
