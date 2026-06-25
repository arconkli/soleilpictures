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

import { useEffect, useRef, useState, Suspense } from 'react';
import { supabase } from '../lib/supabase.js';
import { logEvent, logEventNow } from '../lib/analytics.js';
import { lazyWithReload } from '../lib/lazyWithReload.js';
import { useAuth } from './AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { EV, JOURNEY_PHASE } from '../lib/analyticsEvents.js';
import { assignArm } from '../lib/experiments.js';
import { trackAdLead } from '../lib/metaPixel.js';
import { setJourneySink, beginJourney, setJourneyState, journey } from '../lib/journey.js';

// Wire the post-signup journey's emitter at module load (journey.js can't import
// analytics.js statically — it must stay node-importable for its unit test). This
// module is the earliest journey user, so wiring here guarantees the sink is set
// before any journey() call. Idempotent with the matching wire in App.jsx.
setJourneySink({ logEvent, logEventNow });
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
  const { tier, loading, banned, adOfferPending, refetch, onboarding } = useMyTier({ userId: user?.id });
  const [hasEntry, setHasEntry] = useState(null);
  const path = window.location.pathname;

  // ── instant_entry experiment (deterministic; decided HERE, before App mounts) ──
  // Arm B drops a brand-new demo user STRAIGHT into their seeded board instead of the
  // price-first AdWelcome gate (~100% of signups hit that gate, ~35% bounced there, 0
  // paid anyway). The Creator offer is deferred to the in-app first-value nudge + the
  // always-present UpgradeChip. assignArm is a pure synchronous hash of user.id (no
  // server round-trip), so arm A's gate still renders instantly. Null (experiment off
  // / no user) falls back to control. See experiments.js for why this is deterministic
  // and intentionally outside the bandit config.
  const atOfferGate = !loading && !!user?.id && tier === 'demo' && adOfferPending;
  const entryArm = atOfferGate ? assignArm('instant_entry', user.id) : null;
  const instantEntryRef = useRef(false);

  // ── Post-signup journey: open + tier-gate instrumentation ──────────────────
  // The tier gate is the FIRST dark spot after signup: while get_my_tier loads we
  // render <Splash/> with no event, and a slow/failed fetch strands the user
  // silently. We open the journey (lib/journey.js) the moment tier resolves for a
  // genuinely-new user (onboarding not done), which also covers the AdWelcome /
  // waitlist branches where App never mounts. beginJourney is idempotent (App also
  // calls it), and emits the PS_SIGNUP anchor once per uid.
  const tierLoadStartRef = useRef(Date.now());
  const tierStallRef = useRef(null);
  // Stall watcher: get_my_tier still loading past 4s = the dark splash stall. This
  // fires BEFORE the journey can open (newness unknown while loading), so it goes
  // out as a plain event — session_id stitches it to the journey in analysis.
  useEffect(() => {
    if (!loading) {
      if (tierStallRef.current) { clearTimeout(tierStallRef.current); tierStallRef.current = null; }
      return undefined;
    }
    if (!tierStallRef.current) {
      tierStallRef.current = setTimeout(() => {
        try { logEvent(EV.PS_TIER_STALL, { waited_ms: Date.now() - tierLoadStartRef.current }); } catch (_) {}
      }, 4000);
    }
    return () => { if (tierStallRef.current) { clearTimeout(tierStallRef.current); tierStallRef.current = null; } };
  }, [loading]);
  // Resolve: open the journey for new users + stamp the tier-gate outcome.
  useEffect(() => {
    if (loading || !user?.id) return;
    const isNew = onboarding?.done !== true;
    if (!isNew) return;
    beginJourney(user.id, { isNew, tier });   // idempotent; emits PS_SIGNUP once
    setJourneyState({
      phase: JOURNEY_PHASE.TIER_GATE, tier, ad_pending: !!adOfferPending,
      onb_seeded: onboarding?.seeded === true, onb_done: onboarding?.done === true,
      route: window.location.pathname,
    });
    journey(EV.PS_TIER_RESOLVED, { tier, dur_ms: Math.max(0, Date.now() - tierLoadStartRef.current), ad_pending: !!adOfferPending });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tier, adOfferPending, user?.id]);
  // Advance the phase as the resolved branch renders (no new events — the branch's
  // own surfaces already log; the heartbeat/trace carry the live phase).
  useEffect(() => {
    if (loading) return;
    if (tier === 'waitlist') setJourneyState({ phase: JOURNEY_PHASE.WAITLIST, route: window.location.pathname });
    else if (tier === 'demo' && adOfferPending && entryArm !== 'B') setJourneyState({ phase: JOURNEY_PHASE.AD_WELCOME, route: window.location.pathname });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tier, adOfferPending, entryArm]);

  // instant_entry: enroll BOTH arms at the gate DECISION (not at seed time) so arm-A
  // users who bounce on AdWelcome are still counted — otherwise arm A's denominator
  // would silently drop its worst users and inflate its rate. set_experiment_arm is
  // absent-only (first-touch wins); the App seed loop skips instant_entry so this is
  // the single enroll. For arm B we also clear the one-time offer flag (so the gate
  // never re-pops on a later focus/session — useMyTier refetches on focus), fire the
  // ad-cohort Meta Lead that AdWelcome would have fired (safe server-side no-op for
  // non-ad users), and mark the skip. All best-effort; nothing blocks entering the app.
  useEffect(() => {
    if (!atOfferGate || !entryArm || instantEntryRef.current) return;
    instantEntryRef.current = true;
    // PostgREST builder is a thenable with NO .catch → use the two-arg .then.
    supabase.rpc('set_experiment_arm', { p_key: 'instant_entry', p_arm: entryArm }).then(undefined, () => {});
    try { logEvent(EV.EXPERIMENT_ENROLLED, { key: 'instant_entry', arm: entryArm }); } catch (_) {}
    if (entryArm === 'B') {
      try { logEvent(EV.INSTANT_ENTRY_SKIP, { arm: entryArm }); } catch (_) {}
      supabase.auth.getSession().then(({ data }) => trackAdLead(data?.session)).catch(() => {});
      (async () => {
        try { await supabase.rpc('dismiss_ad_offer'); } catch (_) {}
        try { await refetch(); } catch (_) {}
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atOfferGate, entryArm]);

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

  // Demo users with the one-time offer flag see the price-first AdWelcome once before
  // entering the app — UNLESS the instant_entry experiment put them in arm B, which
  // skips the gate entirely (the effect above clears the flag + defers the offer) and
  // falls through to the seeded app below. AdWelcome clears the flag (dismiss_ad_offer);
  // the refetch there then drops them in. Buying flips tier→paid, also out of this
  // branch. (With the waitlist off, the signup trigger sets this flag for every demo
  // signup; with it on, only fbclid ad traffic carries it.)
  if (tier === 'demo' && adOfferPending && entryArm !== 'B') {
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
          we'll take a look.
        </p>
        <a className="auth-btn" href="mailto:hello@soleilpictures.com?subject=Account%20suspended">
          Email support
        </a>
        <button className="auth-btn auth-btn-secondary" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}
