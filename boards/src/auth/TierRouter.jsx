// TierRouter — gates the rest of the app behind tier + path.
//
// All routes here assume the user is signed in (AuthGate is upstream).
// Renders the appropriate page based on (path × tier):
//
//   tier='waitlist' → MUST land on /welcome (no entry) or /waitlist/status
//                     (has entry). /waitlist + /pricing + /pricing/success
//                     are also reachable so they can choose / pay.
//   tier='demo'/'paid'/'admin' → land in the App; /pricing + /admin (admin
//                     only) are also reachable. Billing is the in-app Settings
//                     panel (Account → Billing), not a separate route.
//
// Anyone signed in can hit /pricing (e.g. demo upgrading).

import { useEffect, useState, Suspense } from 'react';
import { supabase } from '../lib/supabase.js';
import { lazyWithReload } from '../lib/lazyWithReload.js';
import { useAuth } from './AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { WelcomePage } from './WelcomePage.jsx';
import { AdWelcome } from './AdWelcome.jsx';
import { WaitlistConfirm } from './WaitlistConfirm.jsx';
import { PricingPage } from './PricingPage.jsx';
import { PricingSuccess } from './PricingSuccess.jsx';
// Lazy: AdminPage pulls in recharts (~133KB gz) but only the /admin route (admins
// only) renders it. Keeping it lazy means no other user downloads the charts lib.
const AdminPage = lazyWithReload(() => import('../pages/AdminPage.jsx').then(m => ({ default: m.AdminPage })));
import { UpgradeChip } from '../components/UpgradeChip.jsx';
import { SoleilMark } from '../components/primitives.jsx';

export function TierRouter({ children }) {
  const { user, signOut } = useAuth();
  const { tier, loading, banned, adOfferPending, refetch } = useMyTier({ userId: user?.id });
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

  // Suspended accounts are hard-blocked from every route. (The auth user is
  // also natively banned server-side, which stops sign-in + token refresh.)
  if (banned) return <Suspended onSignOut={signOut} />;

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

  // Ad-sourced demo users (fbclid instant-demo) see the price-first offer once
  // before entering the app. AdWelcome clears the flag (dismiss_ad_offer); the
  // refetch here then drops them into the workspace. Buying flips tier→paid,
  // which also falls out of this branch. Organic demo users never set the flag.
  if (tier === 'demo' && adOfferPending) {
    return <AdWelcome onEnter={async () => {
      await refetch();
      // Dev preview (?local=1&tier=demo&adoffer=1): tier is a static QA override,
      // so refetch can't clear adOfferPending — drop ?adoffer and reload to fall
      // through into the seeded app. Inert in prod (that param is never present;
      // there adOfferPending comes from the server and refetch clears it).
      const url = new URL(window.location.href);
      if (url.searchParams.has('adoffer')) {
        url.searchParams.delete('adoffer');
        window.location.replace(url.pathname + url.search);
        return;
      }
      if (window.location.pathname !== '/') window.history.replaceState({}, '', '/');
    }} />;
  }

  // tier in (admin, paid, demo) — signed-in-only side pages
  if (path === '/admin')             return <Suspense fallback={<Splash />}><AdminPage /></Suspense>;

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

function Suspended({ onSignOut }) {
  return (
    <div className="auth-screen">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-card auth-card-message">
        <SoleilMark size={32} color="var(--soleil)" />
        <h1 className="auth-message-title">Account suspended</h1>
        <p className="auth-message-body t-meta">
          Your account has been suspended. If you think this is a mistake,
          contact <a className="auth-link" href="mailto:hello@soleilpictures.com">hello@soleilpictures.com</a>.
        </p>
        <button className="auth-btn" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}
