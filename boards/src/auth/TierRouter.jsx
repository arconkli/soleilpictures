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

import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { supabase } from '../lib/supabase.js';
import { logEvent, logEventNow } from '../lib/analytics.js';
import { lazyWithReload } from '../lib/lazyWithReload.js';
import { useAuth } from './AuthGate.jsx';
import { useMyTier } from '../hooks/useMyTier.js';
import { EV, JOURNEY_PHASE } from '../lib/analyticsEvents.js';
import { assignArm } from '../lib/experiments.js';
import { trackAdLead } from '../lib/metaPixel.js';
import { setJourneySink, beginJourney, setJourneyState, journey } from '../lib/journey.js';
import { useSetupGate } from '../hooks/useSetupGate.js';
import { bootMark } from '../lib/bootMarks.js';
import { teamPreviewAvailable } from '../lib/teamPreview.js';

// Wire the post-signup journey's emitter at module load (journey.js can't import
// analytics.js statically — it must stay node-importable for its unit test). This
// module is the earliest journey user, so wiring here guarantees the sink is set
// before any journey() call. Idempotent with the matching wire in App.jsx.
setJourneySink({ logEvent, logEventNow });
// Lazy: each is its own route's page (/pricing, /pricing/success, and the
// waitlist's /welcome and /waitlist/status), so an open of the app never
// downloads them.
const WelcomePage = lazyWithReload(() => import('./WelcomePage.jsx').then(m => ({ default: m.WelcomePage })));
const WaitlistConfirm = lazyWithReload(() => import('./WaitlistConfirm.jsx').then(m => ({ default: m.WaitlistConfirm })));
const PricingPage = lazyWithReload(() => import('./PricingPage.jsx').then(m => ({ default: m.PricingPage })));
// The team preview's buying walk-through (Settings › Preview › Team plan); preview host and dev only.
const TeamSetup = lazyWithReload(() => import('../components/team/TeamSetup.jsx'));
const PricingSuccess = lazyWithReload(() => import('./PricingSuccess.jsx').then(m => ({ default: m.PricingSuccess })));
// Lazy: AdminPage pulls in recharts (~133KB gz) but only the /admin route (admins
// only) renders it. Keeping it lazy means no other user downloads the charts lib.
const AdminPage = lazyWithReload(() => import('../pages/AdminPage.jsx').then(m => ({ default: m.AdminPage })));
// Lazy: only a new account in workspace_setup's arm B ever renders it.
const WorkspaceSetup = lazyWithReload(() => import('../components/setup/WorkspaceSetup.jsx'));
import { UpgradeChip } from '../components/UpgradeChip.jsx';
import { SoleilMark } from '../components/primitives.jsx';

export function TierRouter({ children }) {
  const { user, signOut } = useAuth();
  const { tier, loading, banned, adOfferPending, refetch, onboarding, tierFetchMs } = useMyTier({ userId: user?.id });
  const [hasEntry, setHasEntry] = useState(null);
  const path = window.location.pathname;

  // ── workspace_setup: the first-run setup, decided HERE before App mounts ──
  // A new account is put in an arm and stamped either way (lib/setupGate.js);
  // arm B names its workspace, says who and what it's for and invites people
  // before the canvas. Everyone else resolves to 'off' on the first render
  // without a read, and production stays off through workspaceSetupAllowed.
  const setup = useSetupGate({ user, tier, loading, onboarding });

  // /pricing/success hands over to the app in place (PricingSuccess's
  // onEnter): the URL becomes / and this renders again, down the app's branch.
  // App then mounts with the tier the success page read and takes the reads
  // the sign-in started, where a reload would have started the boot over.
  // bootMark('enter') tells App this mount is not a page load's boot.
  const [, setEntered] = useState(0);
  const enterApp = useCallback(() => {
    bootMark('enter', { from: 'checkout' });
    try { window.history.replaceState({}, '', '/'); }
    catch (_) { window.location.assign('/'); return; }
    setEntered((n) => n + 1);
  }, []);

  // ── instant_entry: SHIPPED at 100% arm B (decided HERE, before App mounts) ──
  // Every brand-new demo user drops STRAIGHT into their seeded board; the price-first
  // AdWelcome gate is fully off-path. It used to strand ~20-50% of signups (0% of whom
  // ever placed a card) for ~0 paid conversions. The Creator offer lives on, re-timed
  // to the in-app first-value nudge (FirstValueUpgradeBanner) + the always-present
  // UpgradeChip. assignArm returns 'B' for everyone (A:0/B:100 in experiments.js),
  // keeping the analytics arm-stamp consistent; the `|| 'B'` belt-and-suspenders keeps
  // AdWelcome skipped even if the experiment were ever disabled.
  const atOfferGate = !loading && !!user?.id && tier === 'demo' && adOfferPending;
  const entryArm = atOfferGate ? (assignArm('instant_entry', user.id) || 'B') : null;
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
    // Newness must FAIL CLOSED. A resolved tier is the only positive evidence
    // that get_my_tier actually landed: useMyTier leaves its store at EMPTY when
    // the RPC throws (tier null, onboarding {}) while still flipping loading→false,
    // so `onboarding?.done !== true` reads TRUE for a fetch that never happened.
    // That mis-read once produced a run of phantom ps_signup rows — every one of
    // them tier:null, with no otp_verify and no email_submit anywhere in the
    // session, i.e. sessions that never authenticated at all. Missing data is not
    // newness; without a tier we know nothing about this user, so we claim nothing.
    if (!tier) return;
    const isNew = onboarding?.done !== true;
    if (!isNew) return;
    beginJourney(user.id, { isNew, tier });   // idempotent; emits PS_SIGNUP once
    setJourneyState({
      phase: JOURNEY_PHASE.TIER_GATE, tier, ad_pending: !!adOfferPending,
      onb_seeded: onboarding?.seeded === true, onb_done: onboarding?.done === true,
      route: window.location.pathname,
    });
    // dur_ms is how long get_my_tier took. It used to be counted from this
    // mount, which was when the read started; bootPrefetch now starts it at
    // sign-in, before this chunk has even arrived, so the store times it.
    const durMs = tierFetchMs ?? Math.max(0, Date.now() - tierLoadStartRef.current);
    journey(EV.PS_TIER_RESOLVED, { tier, dur_ms: durMs, ad_pending: !!adOfferPending });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tier, adOfferPending, user?.id]);
  // Advance the phase as the resolved branch renders (no new events — the branch's
  // own surfaces already log; the heartbeat/trace carry the live phase).
  useEffect(() => {
    if (loading) return;
    if (tier === 'waitlist') setJourneyState({ phase: JOURNEY_PHASE.WAITLIST, route: window.location.pathname });
    else if (tier === 'demo' && adOfferPending && entryArm !== 'B') setJourneyState({ phase: JOURNEY_PHASE.AD_WELCOME, route: window.location.pathname });
    else if (setup.status === 'show') setJourneyState({ phase: JOURNEY_PHASE.SETUP, route: window.location.pathname });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tier, adOfferPending, entryArm, setup.status]);

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
    // No-Supabase dev build: supabase.auth.getSession() below would throw
    // synchronously (not caught by the trailing .catch). Bail — there's nothing
    // to dismiss server-side and the seeded app renders regardless.
    if (!supabase) return;
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
  if (path === '/pricing')           return <Suspense fallback={<Splash />}><PricingPage /></Suspense>;
  if (path === '/team/new' && teamPreviewAvailable()) return <Suspense fallback={<Splash />}><TeamSetup user={user} /></Suspense>;
  if (path === '/pricing/success')   return <Suspense fallback={<Splash />}><PricingSuccess onEnter={enterApp} /></Suspense>;

  // tier='waitlist' is gated to the welcome/waitlist flow. /waitlist is
  // a legacy path that now opens the WaitlistModal inside WelcomePage.
  if (tier === 'waitlist') {
    if (path === '/waitlist/status')   return <Suspense fallback={<Splash />}><WaitlistConfirm /></Suspense>;
    if (path === '/welcome' || path === '/waitlist') return <Suspense fallback={<Splash />}><WelcomePage /></Suspense>;
    // Any other path → bounce them to /welcome or /waitlist/status.
    if (typeof window !== 'undefined') {
      const dest = hasEntry ? '/waitlist/status' : '/welcome';
      if (window.location.pathname !== dest) {
        window.history.replaceState({}, '', dest);
      }
    }
    return <Suspense fallback={<Splash />}>{hasEntry ? <WaitlistConfirm /> : <WelcomePage />}</Suspense>;
  }

  // AdWelcome itself is gone — instant_entry shipped at 100% arm B, the render
  // branch was statically unreachable (entryArm is always 'B' at the gate), and
  // its own comment promised removal "in the fast-follow cleanup". This is that
  // cleanup: the arm-B effect above still clears the one-time offer flag; the
  // ad_offer_* analytics constants and the SignupFunnelPanel readout stay for
  // the historical rows.

  // tier in (admin, paid, demo) — signed-in-only side pages
  if (path === '/admin')             return <Suspense fallback={<Splash />}><AdminPage /></Suspense>;

  // The setup steps, while a new account in arm B has them to do. 'pending' is
  // the one read of how far they got, so a reload resumes the step they left.
  if (setup.status === 'pending') return <Splash />;
  if (setup.status === 'show') {
    return (
      <Suspense fallback={<Splash />}>
        <WorkspaceSetup user={user} initialState={setup.welcome} invitee={setup.invitee} onDone={setup.finish} />
      </Suspense>
    );
  }

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
