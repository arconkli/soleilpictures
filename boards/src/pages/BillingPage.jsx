// BillingPage — /settings/billing for paying customers. This is the
// Stripe Customer Portal `return_url`, so it has to keep working as a
// route. Renders the same <BillingSummary /> the in-modal Billing tab
// uses so plan label + period formatting stay in one place.
//
// 404-style empty state for users with no subscription (typically demo
// users who landed here by typing the URL).

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../auth/AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { startPortal } from '../lib/checkout.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { BillingSummary } from '../components/SettingsPanel.jsx';

export function BillingPage() {
  const { user, signOut } = useAuth();
  const { tier, demoCardCount, subscriptionStatus, currentPeriodEnd, cancelAtPeriodEnd, loading } =
    useMyTier({ userId: user?.id });
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
      await startPortal({ surface: 'billing_page' });
    } catch (e) {
      setError(e?.message || String(e));
      setBusy(false);
    }
  };

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
            <BillingSummary
              tier={tier}
              sub={sub}
              subscriptionStatus={subscriptionStatus}
              currentPeriodEnd={currentPeriodEnd}
              cancelAtPeriodEnd={cancelAtPeriodEnd}
              demoCardCount={demoCardCount}
              busy={busy}
              onManage={openPortal} />
            {error && <div className="auth-error t-meta">{error}</div>}
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
