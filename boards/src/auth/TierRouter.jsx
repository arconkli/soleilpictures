// TierRouter — gates the rest of the app behind tier + path.
//
// All routes here assume the user is signed in (AuthGate is upstream).
// Renders the appropriate page based on (path × tier):
//
//   tier='waitlist' → MUST land on /welcome (no entry) or /waitlist/status
//                     (has entry). /waitlist + /pricing + /pricing/success
//                     are also reachable so they can choose / pay.
//   tier='demo'/'paid'/'admin' → land in the App; /pricing + /settings/billing
//                     + /admin (admin only) are also reachable.
//
// Anyone signed in can hit /pricing (e.g. demo upgrading).

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from './AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { WelcomePage } from './WelcomePage.jsx';
import { WaitlistConfirm } from './WaitlistConfirm.jsx';
import { PricingPage } from './PricingPage.jsx';
import { PricingSuccess } from './PricingSuccess.jsx';
import { BillingPage } from '../pages/BillingPage.jsx';
import { AdminPage } from '../pages/AdminPage.jsx';
import { UpgradeChip } from '../components/UpgradeChip.jsx';
import { SoleilMark } from '../components/primitives.jsx';

export function TierRouter({ children }) {
  const { user } = useAuth();
  const { tier, loading } = useMyTier({ userId: user?.id });
  const [hasEntry, setHasEntry] = useState(null);
  const path = window.location.pathname;

  // For tier='waitlist' users, peek at their waitlist_entries row so we know
  // whether to send them to /welcome (decide) vs /waitlist/status (waiting).
  useEffect(() => {
    if (tier !== 'waitlist' || !user?.email) { setHasEntry(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('waitlist_entries')
        .select('status')
        .eq('email', user.email.toLowerCase())
        .maybeSingle();
      if (!cancelled) setHasEntry(!!data);
    })();
    return () => { cancelled = true; };
  }, [tier, user?.email]);

  if (loading || (tier === 'waitlist' && hasEntry === null)) return <Splash />;

  // Anyone signed in can reach these:
  if (path === '/pricing')           return <PricingPage />;
  if (path === '/pricing/success')   return <PricingSuccess />;

  // tier='waitlist' is gated to the welcome/waitlist flow. /waitlist is
  // a legacy path that now opens the WaitlistModal inside WelcomePage.
  if (tier === 'waitlist') {
    if (path === '/waitlist/status')   return <WaitlistConfirm />;
    if (path === '/welcome' || path === '/waitlist') return <WelcomePage />;
    // Any other path → bounce them to /welcome or /waitlist/status.
    if (typeof window !== 'undefined') {
      const dest = hasEntry ? '/waitlist/status' : '/welcome';
      if (window.location.pathname !== dest) {
        window.history.replaceState({}, '', dest);
      }
    }
    return hasEntry ? <WaitlistConfirm /> : <WelcomePage />;
  }

  // tier in (admin, paid, demo) — signed-in-only side pages
  if (path === '/settings/billing')  return <BillingPage />;
  if (path === '/admin')             return <AdminPage />;

  // Default → app, with the UpgradeChip overlay for demo users.
  return (
    <>
      {children}
      <UpgradeChip />
    </>
  );
}

function Splash() {
  return (
    <div className="auth-screen">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-loading">
        <SoleilMark size={32} color="var(--soleil)" glow />
      </div>
    </div>
  );
}
