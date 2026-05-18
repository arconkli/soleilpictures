// PricingSuccess — returned-to URL after a Stripe Checkout completes.
//
// Stripe redirects with ?session_id=<id>. The actual tier flip happens
// asynchronously via the stripe-webhook. We poll get_my_tier every ~2s
// until tier changes to 'paid' (or admin), then land them in the app.

import { useEffect, useState } from 'react';
import { useAuth } from './AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';

export function PricingSuccess() {
  const { user, signOut } = useAuth();
  const { tier, refetch } = useMyTier({ userId: user?.id });
  const [waited, setWaited] = useState(0);

  useEffect(() => {
    if (tier === 'paid' || tier === 'admin') {
      window.location.assign('/');
      return;
    }
    const t = setInterval(() => {
      setWaited((w) => w + 1);
      refetch();
    }, 2000);
    return () => clearInterval(t);
  }, [tier, refetch]);

  const stalled = waited > 15;   // ~30s without webhook landing → suggest manual reload

  return (
    <div className="welcome-screen">
      <div className="auth-glow" aria-hidden="true" />
      <div className="welcome-card welcome-card-tight">
        <SoleilWordmark size="display" />
        <div className="welcome-eyebrow t-eyebrow">PAYMENT RECEIVED</div>
        <p className="welcome-copy t-body">
          Activating your account
          {stalled ? <> — taking longer than expected. <a className="auth-link" onClick={() => window.location.assign('/')}>Reload</a> to try again.</>
                  : <>…</>}
        </p>
        <button className="auth-link auth-foot-link t-meta" onClick={signOut}>
          Use a different email
        </button>
      </div>
    </div>
  );
}
