// BillingPage — /settings/billing for paying customers. Shows the
// caller's current subscription summary and a button that opens the
// Stripe Customer Portal (cancel, update card, invoice history).
//
// 404-style empty state for users with no subscription (typically demo
// users who landed here by typing the URL).

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../auth/AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';

const PORTAL_URL = (import.meta.env.VITE_SUPABASE_URL || '') + '/functions/v1/create-portal-session';

export function BillingPage() {
  const { user, signOut } = useAuth();
  const { tier, subscriptionStatus, currentPeriodEnd, loading } = useMyTier({ userId: user?.id });
  const [sub, setSub] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('subscriptions')
        .select('plan, status, current_period_end, cancel_at_period_end')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!cancelled) setSub(data || null);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const openPortal = async () => {
    setError(null);
    setBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Not signed in.');
      const res = await fetch(PORTAL_URL, {
        method: 'POST',
        headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.url) throw new Error(body.error || `HTTP ${res.status}`);
      window.location.assign(body.url);
    } catch (e) {
      setError(e?.message || String(e));
      setBusy(false);
    }
  };

  const formattedPeriodEnd = currentPeriodEnd || sub?.current_period_end
    ? new Date(currentPeriodEnd || sub?.current_period_end).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="welcome-screen">
      <div className="auth-glow" aria-hidden="true" />
      <div className="welcome-card welcome-card-tight">
        <SoleilWordmark size="display" />
        <div className="welcome-eyebrow t-eyebrow">BILLING</div>

        {loading ? (
          <p className="welcome-copy t-body">Loading…</p>
        ) : tier === 'admin' ? (
          <p className="welcome-copy t-body">
            You have unlimited admin access — no subscription needed.
          </p>
        ) : !sub ? (
          <>
            <p className="welcome-copy t-body">
              No subscription on file. You're currently on the <b>{tier}</b> plan.
            </p>
            <div className="welcome-cta-row">
              <button
                className="welcome-cta welcome-cta-primary"
                onClick={() => { window.location.assign('/pricing'); }}
              >
                See Pricing →
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="billing-summary">
              <div className="billing-row">
                <span className="billing-label">Plan</span>
                <span className="billing-value">Creator · {sub.plan === 'annual' ? 'Annual ($240/yr)' : 'Monthly ($25/mo)'}</span>
              </div>
              <div className="billing-row">
                <span className="billing-label">Status</span>
                <span className="billing-value">{subscriptionStatus || sub.status || '—'}</span>
              </div>
              {formattedPeriodEnd && (
                <div className="billing-row">
                  <span className="billing-label">{sub.cancel_at_period_end ? 'Ends' : 'Renews'}</span>
                  <span className="billing-value">{formattedPeriodEnd}</span>
                </div>
              )}
            </div>

            {error && <div className="auth-error t-meta">{error}</div>}

            <div className="welcome-cta-row">
              <button className="welcome-cta welcome-cta-primary" onClick={openPortal} disabled={busy}>
                {busy ? 'Opening…' : 'Manage billing →'}
              </button>
            </div>
          </>
        )}

        <button className="auth-link" onClick={() => { window.location.assign('/'); }}>
          ← Back to Clusters
        </button>
        <button className="auth-link auth-foot-link t-meta" onClick={signOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
