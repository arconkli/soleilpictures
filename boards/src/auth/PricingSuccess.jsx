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
import { logEvent, logEventNow, logEventOnce } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { useDwellTime } from '../hooks/useDwellTime.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { supabase } from '../lib/supabase.js';
import { Check } from '../lib/icons.js';
import { Icon } from '../components/Icon.jsx';
import { PLAN_NAME } from '../lib/billingCopy.js';
import { trackPurchase } from '../lib/metaPixel.js';

const VERIFY_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/verify-checkout-session';
const POLL_MS    = 2000;     // get_my_tier, pre-stall
const SLOW_POLL_MS = 30000;  // get_my_tier once stalled — a tab left open must
                             // not fire an authed RPC every 2s forever
const VERIFY_MS  = 6000;     // server-side verify retry cadence
const MAX_AUTO_VERIFIES = 10; // then the manual "Verify now" button is the path
const STALL_MS   = 30000;    // show manual-retry UI after this much waiting
const HARD_STOP_MS = 15 * 60 * 1000; // stop ALL automatic polling; an abandoned
                             // tab was hitting Stripe + Supabase ~20k times/day
const CELEBRATE_MS = 2400;   // dwell on the success beat before entering

// Verify reasons that can never resolve by retrying — stop the automatic
// verify loop on these (the manual button stays as the escape hatch).
const TERMINAL_REASONS = new Set([
  'session_expired',
  'session does not belong to caller',
  'subscription_not_live:canceled',
  'subscription_not_live:incomplete_expired',
]);

function planLabel(plan) {
  if (plan === 'annual')  return 'Annual';
  if (plan === 'monthly') return 'Monthly';
  return null;
}

export function PricingSuccess() {
  const { user, signOut } = useAuth();
  const { tier, refetch } = useMyTier({ userId: user?.id });
  // State (not a per-render URL read) so a 403 "not your session" — e.g. an
  // account switch in this tab that inherited someone else's session_id URL —
  // can clear it and fall through to the honest missing-session card instead
  // of telling the new account "Payment received" about a stranger's checkout.
  const [sessionId, setSessionId] = useState(() => (typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('session_id')
    : null));

  const [plan, setPlan]           = useState(null);    // 'monthly' | 'annual' once known
  const [stalled, setStalled]     = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyErr, setVerifyErr] = useState(null);
  const [celebrating, setCelebrating] = useState(false);
  const [pollingStopped, setPollingStopped] = useState(false);
  const celebrated = useRef(false);
  const purchaseTracked = useRef(false);   // deduped browser Purchase fires once
  const verifyFired = useRef(new Set());   // checkout_verify_result once per distinct result
  const verifyTerminal = useRef(false);    // a terminal reason stops auto-verify
  const autoVerifies = useRef(0);

  // Bots and email-security link scanners replay the Stripe return URL; only a
  // signed-in return with a session_id counts as a completed checkout.
  useEffect(() => {
    if (!user || !sessionId) return;
    logEventOnce('checkout_success', EV.CHECKOUT_SUCCESS, { has_session_id: true });
  }, [user, sessionId]);
  useEffect(() => { if (!sessionId) logEventOnce('checkout_missing_session', EV.CHECKOUT_MISSING_SESSION); }, [sessionId]);
  useDwellTime(EV.CHECKOUT_SUCCESS_DWELL, () => ({
    outcome: (tier === 'paid' || tier === 'admin' || celebrating) ? 'activated'
           : !sessionId ? 'missing' : stalled ? 'stalled' : 'left',
  }));

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
      if (body?.reason && TERMINAL_REASONS.has(body.reason)) verifyTerminal.current = true;
      // Not our session (403): another account's session_id survived in the
      // URL. Strip it and show the missing-session recovery card — do NOT
      // keep polling a checkout that can never belong to this caller.
      if (res.status === 403) {
        try {
          const u = new URL(window.location.href);
          u.searchParams.delete('session_id');
          window.history.replaceState({}, '', u.pathname + (u.search || ''));
        } catch (_) {}
        setSessionId(null);
      }
      const vr = body?.activated ? 'activated'
               : (body?.reason && body.reason !== 'not_paid_yet') ? 'failed'
               : 'pending';
      if (!verifyFired.current.has(vr)) {
        verifyFired.current.add(vr);
        logEvent(EV.CHECKOUT_VERIFY_RESULT, { result: vr, ...(body?.reason ? { reason: body.reason } : {}) });
      }
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
      if (!verifyFired.current.has('failed')) {
        verifyFired.current.add('failed');
        logEvent(EV.CHECKOUT_VERIFY_RESULT, { result: 'failed', reason: 'network' });
      }
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
    logEventNow(EV.CHECKOUT_ACTIVATED_SEEN, { tier, plan });
    // The redirect is armed by the [celebrating] effect below, NOT here.
    // History of this split: with the timeout in THIS effect, any dep re-run
    // cleared it and the celebrated-guard skipped re-arming — a late `plan`
    // resolution did it once, and an out-of-order stale get_my_tier response
    // (tier briefly regressing paid→demo) did it again. `celebrating` never
    // regresses, so the redirect keyed on it cannot be lost.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier]);
  useEffect(() => {
    if (!celebrating) return;
    const t = setTimeout(() => { window.location.assign('/'); }, CELEBRATE_MS);
    return () => clearTimeout(t);
  }, [celebrating]);

  // Polling: tier RPC (fast pre-stall, slow after, so a late webhook still
  // lands the user) + bounded verify retry + stall timer. Everything stops at
  // HARD_STOP_MS — an abandoned tab used to hit Stripe and Supabase at full
  // cadence forever; the manual "Verify now" button covers the tail.
  useEffect(() => {
    if (tier === 'paid' || tier === 'admin') return;   // celebration owns this
    if (pollingStopped) return;
    const tierTimer = setInterval(() => { refetch(); }, stalled ? SLOW_POLL_MS : POLL_MS);
    let verifyTimer, stallTimer;
    if (sessionId) {
      verifyTimer = setInterval(() => {
        if (verifyTerminal.current || autoVerifies.current >= MAX_AUTO_VERIFIES) {
          clearInterval(verifyTimer);
          return;
        }
        autoVerifies.current += 1;
        callVerify();
      }, VERIFY_MS);
      if (!stalled) {
        stallTimer = setTimeout(() => { setStalled(true); logEvent(EV.CHECKOUT_STALLED, { has_session_id: !!sessionId }); }, STALL_MS);
      }
    }
    const stopTimer = setTimeout(() => { setPollingStopped(true); }, HARD_STOP_MS);
    return () => {
      clearInterval(tierTimer);
      clearTimeout(stopTimer);
      if (verifyTimer) clearInterval(verifyTimer);
      if (stallTimer)  clearTimeout(stallTimer);
    };
  }, [tier, refetch, callVerify, sessionId, stalled, pollingStopped]);

  const onRetryClick = async () => {
    logEvent(EV.CHECKOUT_VERIFY_RETRY);
    setVerifying(true);
    setVerifyErr(null);
    const body = await callVerify();
    setVerifying(false);
    if (body?.activated) {
      refetch();
    } else if (body?.reason && body.reason !== 'not_paid_yet') {
      // Map raw verify reasons to copy a buyer can act on — the bare code
      // ("session_expired") read as a bug and didn't say what to do next.
      const REASON_COPY = {
        session_expired: 'Your checkout session expired before activation. If your card was charged, the email receipt is your proof — write to support and we\'ll activate you right away.',
        payment_failed: 'Your payment didn\'t go through — check your card details and try the checkout again.',
        no_subscription: 'Stripe hasn\'t attached a subscription to this checkout — if your card was charged, email support below and we\'ll activate you right away.',
        'subscription_not_live:canceled': 'This checkout belongs to a subscription that has since been canceled, so it can\'t activate your account. Start a fresh checkout from the pricing page.',
        'subscription_not_live:incomplete': 'Your payment is still processing — bank payments can take a little while. We\'ll flip your account on the moment it clears.',
        'subscription_not_live:incomplete_expired': 'The initial payment never completed, so this checkout can\'t activate. Start a fresh checkout from the pricing page.',
      };
      setVerifyErr(REASON_COPY[body.reason] || `Activation check came back with "${body.reason}" — if this persists, email support below.`);
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
              onClick={() => { logEventNow(EV.WELCOME_CTA, { target: 'pricing', from: 'checkout_missing' }); window.location.assign('/pricing'); }}
            >
              Back to pricing
            </button>
          </div>
          <p className="welcome-copy t-meta" style={{ color: 'var(--ink-3)' }}>
            Already paid? <a className="auth-link" href={supportHref} onClick={() => logEvent(EV.CHECKOUT_SUPPORT_CLICK, { surface: 'missing_session' })}>Email support</a> and we'll sort it out.
          </p>
          <button className="auth-link auth-foot-link t-meta" onClick={() => { logEvent(EV.PRICING_SIGNOUT); signOut(); }}>
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
              Still nothing? <a className="auth-link" href={supportHref} onClick={() => logEvent(EV.CHECKOUT_SUPPORT_CLICK, { surface: 'stalled' })}>Email support</a> — we'll sort it out.
            </p>
          </>
        )}

        <button className="auth-link auth-foot-link t-meta" onClick={() => { logEvent(EV.PRICING_SIGNOUT); signOut(); }}>
          Use a different email
        </button>
      </div>
    </div>
  );
}
