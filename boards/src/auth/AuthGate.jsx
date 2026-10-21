// AuthGate — three modes:
//   1. supabase === null  → no env vars; render children with a dev banner.
//   2. signed out          → render the OTP sign-in screen.
//   3. signed in           → render children + expose user via context.
//
// Sign-in flow (post-rework):
//   • User types email → we call signInWithOtp. shouldCreateUser defaults true
//     and email autoconfirm is on, so a new address becomes an account, already
//     confirmed and holding one session, the moment it is submitted. Nothing is
//     created "at verify time": an account with no second session is someone
//     who never typed the code (a typo, a duplicate, or a person stuck here).
//   • The email carries ONLY a 6-digit code (supabase/templates/magic_link.html
//     leaves the link out: mail scanners pre-fetch links and burn the token).
//     The code can be read on one device and typed on another. Asking again
//     kills the earlier code; only the newest one works.
//   • A 6-digit code input slides in on the same page. A ?code=… callback is
//     still consumed below, for flows that land with one.
//   • Tier='waitlist' is the default for new accounts (set in migration
//     0088's ensure_profile_for_new_user trigger; 0085/0087 had briefly
//     regressed it to 'demo'). TierRouter sends waitlist users to
//     /welcome where they pick between requesting demo access or paying.

import { useEffect, useRef, useState, createContext, useContext, lazy, Suspense } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase.js';
import { isLocalQaMode } from '../lib/localMode.js';
import { logEvent, logEventNow, logEventOnce, getFirstSource } from '../lib/analytics.js';
import { EV, classifyAuthError } from '../lib/analyticsEvents.js';
import { getWebviewInfo } from '../lib/webview.js';
import { usePresenceHeartbeat } from '../hooks/usePresenceHeartbeat.js';
import { recordSeen } from '../lib/returnVisit.js';
import { peekPendingInviteEmail, peekJoinBoardName, claimPendingInvite, claimCollabLink, peekWorkspaceInviteLink, claimWorkspaceInviteLink } from '../lib/inviteApi.js';
import { parseRemixParam, stashRemix } from '../lib/remix.js';
import { parseJoinParam, stashJoin, readJoin, clearJoin } from '../lib/joinLink.js';
import { WSJOIN_PARAM, parseWsJoinParam, stashWsJoin, readWsJoin, clearWsJoin, markJoined } from '../lib/workspaceLink.js';
import { workspaceSetupAllowed } from '../lib/appHost.js';
import { parseShareReturn, stashShareReturn, readShareReturn, clearShareReturn, shareReturnHref, parseFileReturn, stashFileReturn, readFileReturn, clearFileReturn, fileReturnHref } from '../lib/shareReturn.js';
import { readScoutPhone, clearScoutPhone } from '../lib/scoutClaim.js';
import { readCreatorIntent } from '../lib/creatorIntent.js';
import { getFbCookies } from '../lib/metaPixel.js';
import { suggestEmail, emailProblem } from '../lib/emailTypo.js';
import { savePendingCode, readPendingCode, clearPendingCode, resendWait } from '../lib/pendingCode.js';
import { captchaEnabled, captchaToken } from './turnstile.js';
import { mailboxFor, isConsumerAddress } from '../lib/mailboxLink.js';
import { lpCtaClick } from '../hooks/useLandingEngagement.js';
import { SoleilMark } from '../components/primitives.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { SignInBackdrop } from './SignInBackdrop.jsx';
import { bootMark } from '../lib/bootMarks.js';
import { preloadSignedInApp } from '../lib/preloadApp.js';
import { startBootPrefetch, clearBootPrefetch } from '../lib/bootPrefetch.js';

// Localstorage key holding an in-flight invite token between the
// pre-signup landing (?invite=…) and the post-signup claim hook.
// Cleared once claim_pending_invite returns (or fails terminally).
const PENDING_INVITE_KEY = 'soleil.boards.pending.invite.token';

// Auto-focus the email field on desktop (precise pointer) for speed, but NOT on
// touch devices — there it pops the keyboard on load, hiding the animated hero
// and crowding the box. Phones open hero-first; the keyboard opens on tap.
const AUTOFOCUS_EMAIL = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  ? !window.matchMedia('(pointer: coarse)').matches
  : true;

const AuthContext = createContext({ user: null, signOut: () => {} });
export const useAuth = () => useContext(AuthContext);

function clearAuthUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  ['code', 'state', 'access_token', 'refresh_token', 'expires_at', 'expires_in', 'token_type', 'type'].forEach(key => {
    url.searchParams.delete(key);
  });
  url.hash = '';
  window.history.replaceState({}, document.title, url.pathname + url.search);
}

// Consume ?w=<workspaceId>&b=<boardId> deep-link params (sent in
// transactional email CTAs) into the localStorage keys App reads on
// mount, so a signed-in user lands directly on the right workspace +
// board without manual navigation. MUST run before App's first render
// — call this BEFORE setSession() flips us from "loading" → "signed in".
//
// The ids are NOT validated here, and deliberately so: this runs before we
// have the workspace list, and an async membership check would block the boot
// path. Two things make that safe. A workspace the user isn't a member of
// falls back to personal (App.jsx, `workspaces.find(...) || personalWorkspace`),
// and a workspace that can't be opened now surfaces a recoverable error that
// CLEARS this key rather than looping on it. Before that existed, a stale
// email link could park an account on a permanent spinner.
function consumeDeepLink(userId) {
  if (typeof window === 'undefined' || !userId) return;
  const url = new URL(window.location.href);
  const wsId    = url.searchParams.get('w');
  const boardId = url.searchParams.get('b');
  if (!wsId && !boardId) return;
  try {
    if (wsId) {
      const wsKey = `soleil.boards.session.${userId}.workspace`;
      localStorage.setItem(wsKey, JSON.stringify({ activeWorkspaceId: wsId }));
    }
    if (wsId && boardId) {
      // The board-stack session is workspace-scoped. Preserve any other
      // keys (viewOverride / splitStack / splitRatio) the user already had.
      const boardKey = `soleil.boards.session.${userId}.${wsId}`;
      let existing = {};
      try { existing = JSON.parse(localStorage.getItem(boardKey) || '{}'); } catch (_) {}
      localStorage.setItem(boardKey, JSON.stringify({ ...existing, stack: [boardId] }));
    }
  } catch (_) {}
  url.searchParams.delete('w');
  url.searchParams.delete('b');
  window.history.replaceState({}, document.title, url.pathname + url.search);
}

// Set when a lifecycle CTA landed us here with NO session — i.e. the click hit
// the sign-in wall. Read later, when a session finally arrives, to tell a
// recovery apart from a click that was signed in all along.
let lifecycleLandedSignedOut = false;

// Consume ?lc=<email_type>.<version> — the first-party "they actually arrived"
// signal for lifecycle email. Separate from consumeDeepLink because it must run
// even when there is no ?w/?b to consume: a dormant user with no board still
// gets a CTA, and that landing counts just as much.
//
// Resend's click webhook can't answer this. It rewrites every CTA through its
// own tracking host, and reports userAgent "Amazon CloudFront" on 100% of
// clicks, so a scanner prefetching the link is indistinguishable from a human
// — and a click event says nothing about whether the app ever loaded.
//
// Fires REGARDLESS of session, carrying signed_in. It used to be gated on a
// user id, on the reasoning that a signed-out click should stay unattributed
// until it came back through OTP. That hid the single most important number in
// the win-back program — how many readers arrive with no session and give up at
// the wall — and left the question unanswerable in either direction. An earlier
// pass concluded the wall was NOT eating the clicks, from auth.sessions rows
// that predate the send; those rows have a null not_after and ~94% were cold,
// so they cannot carry that conclusion. This is the measurement that can.
// Signed-out arrivals are the population we are trying to see, not noise.
//
// The param is stripped only once signed in, so it survives the OTP roundtrip
// and the recovery still attributes.
function consumeLifecycleLanding(signedIn) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const lc = url.searchParams.get('lc');
  if (!lc) return;
  // "<email_type>.<version>" — version is optional and may itself contain dots.
  const clean = lc.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64);
  if (clean) {
    const dot = clean.indexOf('.');
    const emailType      = dot === -1 ? clean : clean.slice(0, dot);
    const contentVersion = dot === -1 ? null  : clean.slice(dot + 1);
    logEventOnce(`lifecycle_land:${clean}`, EV.LIFECYCLE_LAND, {
      email_type: emailType, content_version: contentVersion, signed_in: !!signedIn,
    });
    if (!signedIn) lifecycleLandedSignedOut = true;
    // Landed at the wall, then got through it. This is the number that says
    // whether the resume link is working.
    if (signedIn && lifecycleLandedSignedOut) {
      logEventOnce(`lifecycle_resume:${clean}`, EV.LIFECYCLE_RESUME, {
        email_type: emailType, content_version: contentVersion,
      });
    }
  }
  if (!signedIn) return;
  url.searchParams.delete('lc');
  window.history.replaceState({}, document.title, url.pathname + url.search);
}

// Capture ?invite=<token> on first load and store it across the OTP
// signup roundtrip. Runs whether the user is signed in or not — if the
// recipient clicks the link while already signed in to a different
// account, we still pick up the token and let claimPendingInvite raise
// the "different email" error.
function captureInviteToken() {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const token = url.searchParams.get('invite');
  if (!token) {
    try { return localStorage.getItem(PENDING_INVITE_KEY) || null; } catch (_) { return null; }
  }
  try { localStorage.setItem(PENDING_INVITE_KEY, token); } catch (_) {}
  url.searchParams.delete('invite');
  window.history.replaceState({}, document.title, url.pathname + url.search);
  return token;
}

// Capture ?back=share beside share_token (a /share page's sign-up or sign-in
// CTA) and stash it across the OTP hop — the ?join= idiom. share_token itself
// stays in the URL: the first-touch attribution reads it. Before this, every
// share-page signup was dropped at the root of an empty workspace, and not one
// ever first-opened the board they had been looking at.
function captureShareReturn() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const token = parseShareReturn(url);
  if (!token) return;
  stashShareReturn(token);
  url.searchParams.delete('back');
  window.history.replaceState({}, document.title, url.pathname + url.search);
}

// Once a session exists, go back to the share page the person came from, signed
// in. Returns true when it navigated — the caller must not render the app.
function consumeShareReturn() {
  const token = readShareReturn();
  if (!token) return false;
  clearShareReturn();
  try { logEventNow(EV.SHARE_RETURN_LANDED); } catch (_) {}
  window.location.replace(shareReturnHref(token));
  return true;
}

// The same round trip for a single shared file: /f/<token>'s sign-in link
// carries back=file&file_token=<uuid> (shareReturn.js).
function captureFileReturn() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const token = parseFileReturn(url);
  if (!token) return;
  stashFileReturn(token);
  url.searchParams.delete('back');
  window.history.replaceState({}, document.title, url.pathname + url.search);
}

function consumeFileReturn() {
  const token = readFileReturn();
  if (!token) return false;
  clearFileReturn();
  try { logEventNow(EV.FILE_SHARE_RETURN_LANDED); } catch (_) {}
  window.location.replace(fileReturnHref(token));
  return true;
}

// Capture ?remix=<t_token|s_slug> on landing (from the /share or /c "Make a
// copy" CTA) and stash the source so the authenticated app can clone it into a
// fresh board after sign-in. Strips the param. Runs whether or not the user is
// already signed in — a signed-in viewer is handled by the same app-side consume.
function captureRemixSource() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const raw = url.searchParams.get('remix');
  if (!raw) return;
  const src = parseRemixParam(raw);
  if (src) stashRemix(src);
  url.searchParams.delete('remix');
  window.history.replaceState({}, document.title, url.pathname + url.search);
}

// Capture ?join=<token> (a multi-use collab invite link, 0189 — distinct
// from single-recipient ?invite= tokens) and stash it across the OTP hop.
// Runs signed-in or not: an already-signed-in click claims on this same
// pageload via consumePendingJoin.
function captureJoinToken() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const token = parseJoinParam(url.searchParams.get('join'));
  if (!token) return;
  stashJoin(token);
  url.searchParams.delete('join');
  window.history.replaceState({}, document.title, url.pathname + url.search);
}

// Claim a stashed collab-link token: claim_collab_link inserts the
// board_shares row (idempotent) and returns the workspace/board to land on.
// Best-effort; never throws upward. Clears the stash on ANY outcome — a
// terminally-bad token (revoked/expired) must not retry forever.
async function consumePendingJoin(userId) {
  if (typeof window === 'undefined' || !userId) return;
  const token = readJoin();
  if (!token) return;
  try {
    const row = await claimCollabLink(token);
    // Record EVERY outcome. claim_collab_link only writes its own
    // invite_link_claimed row on the fresh-join branch — 'upgraded', 'already'
    // and 'noop' each return early, so those claims used to leave no trace at
    // all and a join click could vanish with neither a success nor a failure.
    try { logEvent(EV.INVITE_LINK_CLAIM_RESULT, { status: row?.status || 'unknown' }); } catch (_) {}
    // The third grant mechanism, recorded in the same shape as the two in
    // ShareModal so "which path actually produces collaborators" is one query
    // rather than three reconstructions. Only the branches that really created
    // access count — 'already' and 'noop' granted nothing.
    if (row?.status === 'joined' || row?.status === 'upgraded') {
      try {
        logEvent(EV.ACCESS_GRANTED, {
          how: 'invite_link', board_id: row?.board_id || null, surface: 'join_link',
        });
      } catch (_) {}
    }
    if (row?.workspace_id) {
      const wsKey = `soleil.boards.session.${userId}.workspace`;
      localStorage.setItem(wsKey, JSON.stringify({ activeWorkspaceId: row.workspace_id }));
      if (row.board_id) {
        const boardKey = `soleil.boards.session.${userId}.${row.workspace_id}`;
        let existing = {};
        try { existing = JSON.parse(localStorage.getItem(boardKey) || '{}'); } catch (_) {}
        localStorage.setItem(boardKey, JSON.stringify({ ...existing, stack: [row.board_id] }));
      }
    }
  } catch (e) {
    console.warn('[join-link] claim failed', e?.message || e);
    try { logEvent(EV.INVITE_LINK_CLAIM_FAILED, { reason: String(e?.message || e).slice(0, 120) }); } catch (_) {}
  } finally {
    clearJoin();
  }
}

// Capture ?wsjoin=<token> (a whole-workspace invite link, 0450) and stash it
// across the OTP hop, like ?join=. Held with the setup steps until the
// sidebar's release.
function captureWsJoinToken() {
  if (typeof window === 'undefined' || !workspaceSetupAllowed()) return;
  const url = new URL(window.location.href);
  const token = parseWsJoinParam(url.searchParams.get(WSJOIN_PARAM));
  if (!token) return;
  stashWsJoin(token);
  url.searchParams.delete(WSJOIN_PARAM);
  window.history.replaceState({}, document.title, url.pathname + url.search);
}

// Set just before the sign-in form verifies a code, so the session it makes is
// known to come from someone who read "Join {workspace}" above the form and
// signed in to do it. A session that was already there never claims on its
// own: it gets the join card and an explicit Join (components/WorkspaceJoinCard).
let signingInByForm = false;

// Point the app at a workspace before it mounts (useWorkspace reads this).
function openWorkspaceNext(userId, workspaceId) {
  try {
    localStorage.setItem(`soleil.boards.session.${userId}.workspace`, JSON.stringify({ activeWorkspaceId: workspaceId }));
  } catch (_) { /* the app opens on its own default */ }
}

// Claim a stashed workspace link for a session the sign-in form just made.
// Best-effort and never throws upward; the stash clears on any outcome, so a
// dead link can't retry forever.
async function consumePendingWsJoin(userId) {
  if (typeof window === 'undefined' || !userId || !signingInByForm || !workspaceSetupAllowed()) return;
  const token = readWsJoin();
  if (!token) return;
  try {
    const row = await claimWorkspaceInviteLink(token);
    const status = row?.status || 'unknown';
    try { logEventNow(EV.WORKSPACE_LINK_CLAIM_RESULT, { status, at: 'signup' }); } catch (_) {}
    if (status === 'joined') {
      try { logEvent(EV.ACCESS_GRANTED, { how: 'workspace_link', role: `workspace:${row.role || 'editor'}`, board_id: null, surface: 'wsjoin' }); } catch (_) {}
      markJoined(userId, row.workspace_id);
    }
    if (row?.workspace_id && (status === 'joined' || status === 'member')) openWorkspaceNext(userId, row.workspace_id);
  } catch (e) {
    try { logEventNow(EV.WORKSPACE_LINK_CLAIM_RESULT, { status: 'error', at: 'signup', reason: String(e?.hint || e?.code || e?.message || e).slice(0, 80) }); } catch (_) {}
  } finally {
    clearWsJoin();
  }
}

// Attach a freshly-made account to the Scout waitlist row for the number they
// left on /scout, so when Scout eventually reaches them their photos land in
// the workspace they already have rather than in a new shell account.
//
// A CLAIM IS NOT A BINDING. scout_claim_signup records that this account asked
// to be connected to that number and grants no ability to receive its messages
// — the binding happens later, when the number actually texts Scout and
// confirms, because that is the only point at which anyone proves they hold the
// phone. Doing it here instead would let anybody type a stranger's number on
// /scout, make an account, and quietly receive that stranger's photos.
// See lib/scoutClaim.js and migration 0233.
//
// Best-effort and silent, like the two claims below it: somebody signing in has
// no idea this is happening and must not be shown an error about it. Cleared on
// ANY outcome so a number that will never match cannot retry forever.
async function consumeScoutClaim(userId) {
  if (typeof window === 'undefined' || !userId) return;
  const phone = readScoutPhone();
  if (!phone) return;
  try {
    await supabase.rpc('scout_claim_signup', { p_phone: phone });
  } catch (e) {
    console.warn('[scout] claim failed', e?.message || e);
  } finally {
    clearScoutPhone();
  }
}

// Claim the pending invite associated with the stored token and wire
// the returned workspace_id/board_id into the deep-link localStorage
// slots so the app lands on the right board after sign-in. Idempotent —
// the auth.users INSERT trigger already grants access; this RPC just
// resolves the redirect target. Best-effort; never throws upward.
async function consumePendingInvite(userId) {
  if (typeof window === 'undefined' || !userId) return;
  let token = null;
  try { token = localStorage.getItem(PENDING_INVITE_KEY); } catch (_) {}
  if (!token) return;
  try {
    const row = await claimPendingInvite(token);
    if (row?.workspace_id) {
      const wsKey = `soleil.boards.session.${userId}.workspace`;
      localStorage.setItem(wsKey, JSON.stringify({ activeWorkspaceId: row.workspace_id }));
      if (row.board_id) {
        const boardKey = `soleil.boards.session.${userId}.${row.workspace_id}`;
        let existing = {};
        try { existing = JSON.parse(localStorage.getItem(boardKey) || '{}'); } catch (_) {}
        localStorage.setItem(boardKey, JSON.stringify({ ...existing, stack: [row.board_id] }));
      }
    }
  } catch (e) {
    console.warn('[invite] claim failed', e?.message || e);
  } finally {
    try { localStorage.removeItem(PENDING_INVITE_KEY); } catch (_) {}
  }
}

// ── Did a callback actually reach the product? ──────────────────────────
// Written when the sign-in email carried a link, to find signups that "verified
// and were never seen": last_sign_in_at set, and no workspace, board or event.
// That reading was wrong (2026-10-20). Under email autoconfirm, submitting an
// address creates the account confirmed and signed in, so last_sign_in_at is
// set before anyone types a code; those accounts never entered it. The email
// has no link now, so a ?code= or #access_token landing here is rare (staging
// handoffs, mostly), and this still measures that hop.
//
// Supabase's /auth/v1/verify stamps last_sign_in_at BEFORE redirecting here, so
// everything between "signed in" and "our JS executed" was invisible. This
// fires at MODULE SCOPE, before React renders, so it lands even if boot then
// fails; and it beacons rather than queues, so it survives a tab closed a
// second later.
//
// It is necessarily anonymous: the code has not been exchanged yet, so there is
// no user to attribute it to. AUTH_SESSION_READY below is the one that carries
// a user id, and the subtraction between them is the measurement.
let authLandedAt = 0;
let authMethod = null;
if (typeof window !== 'undefined') {
  try {
    const q = new URLSearchParams(window.location.search);
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    authMethod = q.get('code') ? 'code' : (h.get('access_token') ? 'hash' : null);
    if (authMethod) {
      authLandedAt = Date.now();
      const wv = getWebviewInfo();
      logEventNow(EV.AUTH_LANDED, {
        method: authMethod,
        is_webview: wv.is_webview,
        webview_app: wv.webview_app,
        standalone: !!(navigator.standalone
          || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches)),
      });
    }
  } catch (_) { /* never block boot on telemetry */ }
}

// A session now exists on this device. Carries uid explicitly as well as
// relying on the row's user_id backfill, so the join to auth.users holds even
// if the auth state change hasn't propagated to the emitter yet.
function noteSessionReady(session) {
  try {
    if (!authMethod) return;
    const wv = getWebviewInfo();
    logEventNow(EV.AUTH_SESSION_READY, {
      method: authMethod,
      uid: session?.user?.id || null,
      is_webview: wv.is_webview,
      webview_app: wv.webview_app,
      ms_since_landed: authLandedAt ? Date.now() - authLandedAt : null,
    });
  } catch (_) {}
}

async function consumeAuthCallback() {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  const hash  = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code         = query.get('code');
  const accessToken  = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  const expiresAt    = Number(hash.get('expires_at') || 0);

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    clearAuthUrl();
    if (error) throw error;
    noteSessionReady(data.session);
    return data.session;
  }
  if (!accessToken || !refreshToken) return null;
  // Staging handoff (stagingRedirect.js): prod copies its session here so an
  // admin lands on the preview signed in. If this origin already has a working
  // session, keep it — it's the fresher rotation of the family. Adopting the
  // prod copy after this origin has rotated the token would trip Supabase's
  // refresh-token reuse detection and revoke the whole session family (the
  // cause of the daily re-OTP). Magic-link hashes carry no marker and still
  // adopt unconditionally so "sign in as a different user" keeps working.
  if (hash.get('handoff') === 'staging') {
    try {
      const { data: existing } = await supabase.auth.getSession();
      if (existing?.session?.access_token) {
        clearAuthUrl();
        return existing.session;
      }
    } catch (_) { /* fall through and adopt the handed-off tokens */ }
  }
  if (expiresAt && expiresAt <= Math.floor(Date.now() / 1000) + 30) {
    clearAuthUrl();
    return null;
  }
  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  clearAuthUrl();
  if (error) throw error;
  noteSessionReady(data.session);
  return data.session;
}

// Whether this load can end signed in: a stored session (main.jsx's `sb-…auth-token`
// heuristic for /pricing, loosened to `sb-…auth…` so the alt-session key counts)
// or an auth callback in the URL. Only picks the loading splash's colours; the
// restore itself decides the session.
function hasStoredSession() {
  try {
    if (/[?&#](code|access_token)=/.test(window.location.href)) return true;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('sb-') && k.includes('auth')) return true;
    }
  } catch (_) { return true; }
  return false;
}

// Whether restoring the stored session has to refresh its token first: the
// access token is expired, or inside supabase-js's 90 s refresh margin. The
// first open of a day always does, and nothing can start until it answers.
// null when there is no stored session to judge.
function storedSessionNeedsRefresh() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('sb-') || !k.endsWith('-auth-token')) continue;
      const exp = Number(JSON.parse(localStorage.getItem(k) || 'null')?.expires_at);
      if (Number.isFinite(exp)) return exp * 1000 - Date.now() < 90_000;
    }
  } catch (_) {}
  return null;
}

// Only someone already signed in who opens a workspace invite link sees it.
const WorkspaceJoinCard = lazy(() => import('../components/WorkspaceJoinCard.jsx'));

export function AuthGate({ children, signedOut = null }) {
  const localMode = isLocalQaMode();
  const devWithoutSupabase = !isSupabaseConfigured;
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured && !localMode);
  // Whether this mount has ever held a session. `signedOut` answers only a
  // restore that never produced one; a sign-out from a live session (Use a
  // different email on the account pricing page) still wants the email box.
  const hadSession = useRef(false);
  // A workspace invite link opened by someone already signed in: asked, never
  // claimed on the visit alone.
  const [wsJoinAsk, setWsJoinAsk] = useState(null);

  useEffect(() => {
    if (localMode || devWithoutSupabase) return;
    if (!supabase) return;
    // Capture ?invite=<token>, ?join=<token> and ?remix=<source> on every
    // mount BEFORE any auth roundtrip, so they survive the OTP redirect dance.
    captureInviteToken();
    captureJoinToken();
    captureWsJoinToken();
    captureRemixSource();
    captureShareReturn();
    captureFileReturn();
    let cancelled = false;
    const refreshDue = storedSessionNeedsRefresh();
    (async () => {
      try {
        const callbackSession = await consumeAuthCallback();
        const { data } = callbackSession
          ? { data: { session: callbackSession } }
          : await supabase.auth.getSession();
        // Write deep-link params into localStorage BEFORE setSession,
        // so when App mounts its useState initializer reads the right
        // workspace + board on the very first render.
        // Unconditional: a signed-out arrival is the case we most need to see.
        consumeLifecycleLanding(!!data.session?.user?.id);
        if (data.session?.user?.id) {
          clearPendingCode(window.localStorage);
          consumeDeepLink(data.session.user.id);
          await consumePendingInvite(data.session.user.id);
          await consumePendingJoin(data.session.user.id);
          await consumePendingWsJoin(data.session.user.id);
          await consumeScoutClaim(data.session.user.id);
          if (consumeShareReturn()) return;
          if (consumeFileReturn()) return;
          // Already signed in when the link was opened: ask first.
          if (!signingInByForm && workspaceSetupAllowed()) {
            const ws = readWsJoin();
            if (ws && !cancelled) setWsJoinAsk(ws);
          }
        }
        // The reads the app opens with start now, while it downloads, and
        // after the claims above: they rewrite the keys that say which
        // workspace and cluster it opens (lib/bootPrefetch.js).
        if (data.session?.user?.id && !cancelled) startBootPrefetch(data.session.user.id);
        if (data.session) bootMark('session', { refreshed: !callbackSession && refreshDue === true });
        if (data.session) hadSession.current = true;
        if (!cancelled) setSession(data.session);
      } catch (error) {
        console.warn('Auth session could not be restored', error);
        // A failed restore is still an arrival — and a signed-out one.
        try { consumeLifecycleLanding(false); } catch (_) {}
        // Only attribute to the magic-link funnel when a code/token was actually
        // present — a plain getSession() failure on a normal load isn't a CTA.
        try {
          if (/[?&#](code|access_token)=/.test(window.location.href)) {
            logEvent(EV.LANDING_CALLBACK_ERROR, { reason: classifyAuthError(error) });
          }
        } catch (_) {}
        clearAuthUrl();
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      // What was prefetched belonged to the account that just left.
      if (event === 'SIGNED_OUT') clearBootPrefetch();
      // Same as above — also handle the post-OTP sign-in path where the
      // session arrives after initial mount via this listener. Defer
      // setSession until consumePendingInvite has written the redirect
      // localStorage, so App's first render reads the right workspace +
      // board after a magic-link signup.
      (async () => {
        // Unlike consumeDeepLink, NOT gated on a user id — this is where a
        // signed-out lifecycle click that made it through OTP gets recorded as
        // a recovery. ?lc= was deliberately left in the URL for exactly this.
        consumeLifecycleLanding(!!sess?.user?.id);
        if (sess?.user?.id) {
          clearPendingCode(window.localStorage);
          consumeDeepLink(sess.user.id);
          await consumePendingInvite(sess.user.id);
          await consumePendingJoin(sess.user.id);
          await consumePendingWsJoin(sess.user.id);
          await consumeScoutClaim(sess.user.id);
          if (consumeShareReturn()) return;
          if (consumeFileReturn()) return;
        }
        if (sess?.user?.id && !cancelled) startBootPrefetch(sess.user.id);
        if (sess) bootMark('session', { refreshed: false });
        if (sess) hadSession.current = true;
        if (!cancelled) setSession(sess);
      })();
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [localMode, devWithoutSupabase]);

  // Meta CompleteRegistration now fires at first product use (first genuine card),
  // not at signup — see the activation effect in App.jsx. This keeps Facebook ad
  // optimization training on people who actually use the app, not sign-up-only
  // no-shows.

  if (localMode || devWithoutSupabase) {
    const localUser = { id: 'local-qa-user', email: 'local@soleilpictures.com' };
    return (
      <AuthContext.Provider value={{ user: localUser, signOut: () => { window.location.href = '/'; } }}>
        <DevBanner label={localMode
          ? 'LOCAL QA MODE - seeded boards run in memory and reset on reload.'
          : 'DEV MODE - Supabase not configured. Seeded boards run in memory and reset on reload.'} />
        {children}
      </AuthContext.Provider>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <AuthContext.Provider value={{ user: null, signOut: () => {} }}>
        <DevBanner />
        {children}
      </AuthContext.Provider>
    );
  }

  // A route that supplies `signedOut` (only /pricing) is dark whichever way the
  // restore goes, so its splash is too. So is a restore with no stored session
  // to find: it can only end on the sign-in scene, which is dark, and a
  // theme-following splash flashed light grey between the dark boot splash and
  // that scene for every light-theme visitor.
  if (loading) return <SplashLoading dark={!!signedOut || !hasStoredSession()} />;
  // `signedOut` lets a public route (main.jsx: /pricing) stand in for the wall
  // when a cached session turns out not to restore.
  if (!session) return (!hadSession.current && signedOut) || <SignIn />;

  const signOut = async () => { await supabase.auth.signOut(); };

  return (
    <AuthContext.Provider value={{ user: session.user, signOut }}>
      <PresenceTicker user={session.user} />
      {children}
      {wsJoinAsk && (
        <Suspense fallback={null}>
          <WorkspaceJoinCard token={wsJoinAsk} userId={session.user.id}
            onClose={() => { clearWsJoin(); setWsJoinAsk(null); }} />
        </Suspense>
      )}
    </AuthContext.Provider>
  );
}

// Renders nothing — just runs the heartbeat hook so server-side email
// triggers can skip notifications when the user is currently in-app.
function PresenceTicker({ user }) {
  usePresenceHeartbeat(user);
  // Stamp "seen today" from the first component that knows who this is, not
  // from App: a day one that never reached App (tier splash, seed bounce) left
  // no stamp, and the next day's visit went unrecognised as a return. App reads
  // the parked answer via takeReturn (lib/returnVisit).
  useEffect(() => { recordSeen(user?.id); }, [user?.id]);
  return null;
}

// ── Sign-in screen with OTP code ────────────────────────────────────────────

const EXPLORE_HREF = 'https://clusters.soleilpictures.com/share/bba68b4d-7562-4ca2-96fb-817455b85fdd';

function SignIn() {
  // The code step survives a reload (lib/pendingCode.js). A phone goes to its
  // mail app to read the code and can come back to a reloaded tab; with the
  // step held only in state, that person faced an empty email field and no sign
  // that their code was coming. Only the address is remembered (and how many
  // codes went to it), for as long as a code lives: an hour.
  const [restored] = useState(() => {
    try { return readPendingCode(window.localStorage, Date.now()); } catch (_) { return null; }
  });
  const [email, setEmail]       = useState(() => restored?.email || '');
  // A mistyped consumer domain (gmail.como, gmasil.com, a bare "gmail") is
  // offered a one-tap fix. Never blocks the send; logged once per domain.
  // A restored step keeps its offer: the person who mistyped the domain is
  // exactly the one waiting for a code that is never coming.
  const [typo, setTypo] = useState(() => (restored ? suggestEmail(restored.email) : null));
  const typoLoggedRef = useRef(new Set());
  // The offer follows every keystroke, but the EVENT is only logged once the
  // person has stopped typing (blur) or sent it (submit). Logged per keystroke,
  // "gmail" on the way to "gmail.com" and ".co" on the way to ".com" counted as
  // typos, and the counter mostly measured people mid-word.
  const noteTypo = (value) => { setTypo(suggestEmail(value)); };
  const logTypoSeen = (value, at) => {
    const t = suggestEmail(value);
    if (t && !typoLoggedRef.current.has(t.toDomain)) {
      typoLoggedRef.current.add(t.toDomain);
      try { logEvent(EV.EMAIL_TYPO_SUGGESTED, { from_domain: t.fromDomain, to_domain: t.toDomain, at }); } catch (_) {}
    }
  };
  const [stage, setStage]       = useState(() => (restored ? 'code' : 'email')); // 'email' | 'code'
  const [busy,  setBusy]        = useState(false);
  // The first code's request, still running under the code step (sendCode).
  const [sending, setSending]   = useState(false);
  const verifyingRef = useRef(false);
  const [code,  setCode]        = useState('');
  const [error, setError]       = useState(null);
  const [resendCooldown, setResendCooldown] = useState(() => (restored ? resendWait(restored.sentAt, Date.now()) : 0));
  // Codes sent to this address in this step. Asking again kills the code before
  // it, and nothing used to say so: one person resent, then typed the old code
  // three times. From the second send on, the step and its errors say "newest".
  const [sends, setSends] = useState(() => (restored ? restored.sends : 0));
  // Non-null when the user arrived via an /?invite=<token> link.
  // We pre-fill the email field and show an "invited as ..." banner.
  const [inviteHint, setInviteHint] = useState(null);
  // Non-null when the user arrived via an /?join=<token> collab link. There is
  // no email to pre-fill (the link is multi-use, not addressed to anyone), so
  // the payoff is purely context: name the cluster they were invited to.
  const [joinHint, setJoinHint] = useState(null);
  // ?wsjoin= names the workspace and who sent it (peek_workspace_invite_link).
  const [wsJoinHint, setWsJoinHint] = useState(null);
  // Non-null when "Get Creator" on /pricing sent them here (creatorIntent.js).
  // Read once: an expired entry is removed on read and simply shows nothing.
  const [creatorHint] = useState(() => { try { return readCreatorIntent(); } catch (_) { return null; } });
  const codeRef = useRef(null);
  const captchaRef = useRef(null);   // where Turnstile shows a check, if it ever needs one
  const emailEngagedRef = useRef(false);   // fire landing_field_engage once per field
  const codeEngagedRef  = useRef(false);
  const autoSubmitRef   = useRef(null);   // 6th-digit auto-submit debounce

  // Tick down the resend cooldown (Supabase rate-limits OTP requests at ~60s).
  // Read off the wall clock, never decremented per tick: a phone suspends the
  // tab's timers while its owner is in the mail app looking for the code, and
  // a counter resumed where it froze — "Resend in 55s" two minutes after the
  // limit had passed, for exactly the person whose code hadn't come. Coming
  // back to the tab recomputes at once rather than on the next tick.
  const sentAtRef = useRef(restored ? restored.sentAt : 0);
  const cooling = resendCooldown > 0;
  useEffect(() => {
    if (!cooling) return undefined;
    const recompute = () => setResendCooldown(resendWait(sentAtRef.current, Date.now()));
    const onVisible = () => { if (document.visibilityState === 'visible') recompute(); };
    const t = setInterval(recompute, 1000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', recompute);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', recompute);
    };
  }, [cooling]);

  // Funnel: landing_view fires once when the SignIn screen mounts
  // (logEventOnce dedups StrictMode's dev double-invoke).
  useEffect(() => { logEventOnce('landing_view', EV.LANDING_VIEW); }, []);

  // How often the remembered step actually saves someone a re-send.
  useEffect(() => {
    if (!restored) return;
    // Back on the code step: the app downloads while the code is typed.
    preloadSignedInApp({ setup: workspaceSetupAllowed() });
    logEventOnce('auth_code_restored', EV.AUTH_CODE_RESTORED, {
      age_s: Math.max(0, Math.round((Date.now() - restored.sentAt) / 1000)),
    });
  }, [restored]);

  // Pre-fill email from the stored invite token. Anon-callable RPC —
  // safe to run before the user has a session. Token presence in
  // localStorage is the trust boundary.
  useEffect(() => {
    let cancelled = false;
    try {
      const token = localStorage.getItem(PENDING_INVITE_KEY);
      if (!token) return;
      peekPendingInviteEmail(token)
        .then(addr => {
          if (cancelled || !addr) return;
          // An email invite is bound to its address. A restored code step for
          // the SAME address keeps its place and gets the banner back; one for
          // another address yields to the invite (a code typed there would be
          // claimed against the wrong email and the invite discarded).
          if (restored && restored.email.toLowerCase() !== String(addr).toLowerCase()) {
            clearPendingCode(window.localStorage);
            setStage('email');
            setCode('');
            setResendCooldown(0);
            setSends(0);
          }
          if (!restored || restored.email.toLowerCase() !== String(addr).toLowerCase()) setEmail(addr);
          setInviteHint({ email: addr });
          logEvent(EV.LANDING_INVITE_PREFILL);
        })
        .catch(() => {});
    } catch (_) {}
    return () => { cancelled = true; };
  }, []);

  // Name the cluster behind a stashed ?join=<token>. Someone who clicked
  // "Join as editor" on a /share preview used to land on the bare sign-in
  // screen with nothing tying it to the cluster they'd just been looking at —
  // the ?invite= path has carried that context since 0086, ?join= never did.
  // Best-effort and non-blocking: a revoked/expired/deleted token raises P0002,
  // and the right response is the ordinary landing, not an error.
  useEffect(() => {
    let cancelled = false;
    const token = readJoin();
    if (!token) return undefined;
    peekJoinBoardName(token)
      .then((name) => {
        if (cancelled) return;
        setJoinHint({ name });
        logEvent(EV.LANDING_JOIN_PREFILL, { had_name: !!name });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Name the workspace behind a stashed ?wsjoin=<token> and who sent it. A
  // link that no longer works says so here, before anyone signs up for it.
  useEffect(() => {
    let cancelled = false;
    const token = workspaceSetupAllowed() ? readWsJoin() : null;
    if (!token) return undefined;
    peekWorkspaceInviteLink(token).then((row) => {
      if (cancelled) return;
      const status = row?.status || 'dead';
      // 'Someone' is the server's stand-in for a maker with no name to show.
      const inviter = row?.inviter_name && row.inviter_name !== 'Someone' ? row.inviter_name : '';
      setWsJoinHint({ status, name: row?.workspace_name || '', inviter });
      try { logEvent(EV.WORKSPACE_LINK_LANDED, { status, signed_in: false }); } catch (_) {}
      if (status === 'dead') clearWsJoin();
    }, () => {
      if (!cancelled) { try { logEvent(EV.WORKSPACE_LINK_LANDED, { status: 'error', signed_in: false }); } catch (_) {} }
    });
    return () => { cancelled = true; };
  }, []);

  // Auto-focus the code field when it appears.
  useEffect(() => {
    if (stage === 'code') {
      const t = setTimeout(() => codeRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [stage]);

  const sendCode = async (resending = false) => {
    setError(null);
    // An address with no real ending (@ddsb, @a.m) passes the browser's own
    // check and would get an account and a code that goes nowhere. Refused here;
    // a known provider typed bare ("@gmail") still gets its one-tap fix above.
    const problem = emailProblem(email);
    if (problem) {
      logEvent(EV.EMAIL_SUBMIT_ERROR, { reason: problem, resend: !!resending });
      setError("That address is missing its ending, like .com — check the part after the @.");
      return;
    }
    // The first code: the step shows now and the request runs under it. Sending
    // took a second or more, all of it spent on the email field behind a
    // "Sending…" button; a send that fails comes back there with its reason. A
    // resend stays where it is, as before.
    if (resending) setBusy(true);
    else { setSending(true); setStage('code'); }
    // The code takes a while to arrive and to type; the app downloads in the
    // meantime instead of after it is accepted. Preloaded, never run.
    if (!resending) preloadSignedInApp({ setup: workspaceSetupAllowed() });
    try {
      // If this visitor arrived via a Facebook/Instagram click, the persisted
      // _fbc ('fb.1.<ms>.<fbclid>') rides along in signup metadata so the
      // server trigger can fast-track ad traffic to instant demo while the
      // campaign flag is on. No-op for organic/direct visitors (no _fbc).
      const { fbc } = getFbCookies();
      // First-touch acquisition (utm/click-ids/referrer) also rides along so the
      // server trigger can stamp profiles.first_source even if the client
      // set_first_source RPC never fires — e.g. a magic link opened on a DIFFERENT
      // device, where sessionStorage can't follow. First-touch-wins server-side,
      // so it never fights the client RPC. Untrusted input → capped to bound it.
      let firstSourceMeta = null;
      try {
        const src = getFirstSource();
        if (src && Object.keys(src).length > 0) {
          const json = JSON.stringify(src);
          if (json.length <= 2000) firstSourceMeta = json;
        }
      } catch (_) {}
      // A referral code (?ref=<code>) rides along explicitly so the signup
      // trigger can credit the referrer + grant the new friend a +25-card
      // head-start — even on a cross-device magic link where sessionStorage
      // can't follow. Pulled from the first-touch bag (captured on landing)
      // with a current-URL fallback; normalized to the mint alphabet.
      let referralCode = null;
      try {
        const fromBag = getFirstSource()?.ref;
        const fromUrl = new URLSearchParams(window.location.search).get('ref');
        const c = String(fromBag || fromUrl || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16).toUpperCase();
        if (c) referralCode = c;
      } catch (_) {}
      const signupData = {
        ...(fbc ? { ad_fbc: fbc } : {}),
        ...(firstSourceMeta ? { first_source: firstSourceMeta } : {}),
        ...(referralCode ? { referral_code: referralCode } : {}),
      };
      // Turnstile (2026-10-06 audit): a fresh token for every request, a
      // resend included. Dormant until a site key is built in; see turnstile.js
      // for the order the key and Supabase's captcha switch must go live in.
      const challenge = captchaEnabled() ? await captchaToken(captchaRef.current) : '';
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          // shouldCreateUser defaults to true — new emails get an account
          // at verify time. tier defaults to 'waitlist' (server trigger);
          // ad_fbc may bump it to 'demo' while the campaign flag is on.
          emailRedirectTo: window.location.origin,
          ...(challenge ? { captchaToken: challenge } : {}),
          ...(Object.keys(signupData).length ? { data: signupData } : {}),
        },
      });
      if (error) throw error;
      logEvent(EV.EMAIL_SUBMIT, { resend: !!resending });
      // The OTP form IS the '/' page's signup CTA — count it in lp_cta_click so
      // the landing scorecard's CTR column means the same thing on every page.
      if (!resending) lpCtaClick('/', 'home', 'form');
      const sentAt = Date.now();
      const sent = resending ? Math.max(1, sends) + 1 : 1;
      sentAtRef.current = sentAt;
      setSends(sent);
      setResendCooldown(resendWait(sentAt, sentAt));
      savePendingCode(window.localStorage, email.trim().toLowerCase(), sentAt, sent);
    } catch (e) {
      logEvent(EV.EMAIL_SUBMIT_ERROR, { reason: classifyAuthError(e), resend: !!resending });
      // A code typed meanwhile is already being checked (an earlier one can
      // still work); that answer decides what shows, not this one.
      if (!resending && verifyingRef.current) return;
      if (!resending) { setStage('email'); setCode(''); }
      setError(humanError(e));
    } finally {
      // Each undoes only its own: a code being checked holds `busy`.
      if (resending) setBusy(false);
      else setSending(false);
    }
  };

  const verifyCode = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    const token = code.replace(/\s+/g, '');
    if (token.length < 6) { setError('Enter the 6-digit code from your email.'); return; }
    setError(null);
    setBusy(true);
    verifyingRef.current = true;
    signingInByForm = true;
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token,
        type: 'email',
      });
      if (error) throw error;
      // Typing the code is the path that CANNOT strand a session in a webview —
      // whoever typed it is already looking at the app. Carrying the same flag
      // here gives the magic-link numbers a control to be compared against,
      // rather than a webview share with nothing to mean anything relative to.
      logEvent(EV.OTP_VERIFY, (() => {
        const wv = getWebviewInfo();
        return { is_webview: wv.is_webview, webview_app: wv.webview_app };
      })());
      // Stamp the verify time so the post-signup journey (lib/journey.js) can
      // measure ms_since_otp on its PS_SIGNUP anchor. Fires for new AND returning
      // users (newness isn't known until tier resolves); harmless either way.
      try { localStorage.setItem('soleil_ps_otp_at', String(Date.now())); } catch (_) {}
      clearPendingCode(window.localStorage);
      // onAuthStateChange will fire SIGNED_IN; AuthGate re-renders to children.
    } catch (e) {
      signingInByForm = false;
      verifyingRef.current = false;
      logEvent(EV.OTP_VERIFY_ERROR, { reason: classifyAuthError(e), sends });
      setError(humanError(e, { resent: sends > 1 }));
      // Ready for the next try: the field was disabled while verifying (which
      // drops a phone's keyboard) and left holding six digits that maxLength
      // wouldn't let anyone type over. Empty it and give focus back.
      setCode('');
      setBusy(false);
      setTimeout(() => codeRef.current?.focus(), 0);
    }
  };

  const editEmail = () => {
    logEvent(EV.LANDING_EDIT_EMAIL);
    clearPendingCode(window.localStorage);
    setStage('email');
    setCode('');
    setSends(0);
    setError(null);
  };
  const applyTypo = (atStage) => () => {
    if (!typo) return;
    try { logEvent(EV.EMAIL_TYPO_ACCEPTED, { to_domain: typo.toDomain, stage: atStage }); } catch (_) {}
    if (atStage === 'code') editEmail();
    setEmail(typo.suggestion);
    setTypo(null);
  };
  const typoOffer = (atStage) => (typo ? (
    <button type="button" className="auth-link auth-typo" onClick={applyTypo(atStage)} disabled={busy || sending}>
      Did you mean <b>{typo.suggestion}</b>?
    </button>
  ) : null);

  return (
    // The explore link only while there is no code on its way: under the code
    // form it was the most prominent exit from the step phones abandon most,
    // and the people who took it never came back to type the code.
    <SignInBackdrop exploreHref={stage === 'email' ? EXPLORE_HREF : undefined}>
      <header className="sr-only">
        <h1>Soleil Clusters</h1>
        <p>Soleil Clusters is a creative workspace and moodboard tool for production teams. Organize references, projects, and ideas across film, photo, design, and brand work, and collaborate with your team in real time.</p>
      </header>
      <SoleilWordmark size="display" />

      {inviteHint && (
        <div className="auth-hint t-meta" style={{ marginBottom: 0 }}>
          You've been invited. Sign in with <b>{inviteHint.email}</b> to accept.
        </div>
      )}

      {/* ?join= has no addressed email, so it can't pre-fill — but it must still
          say what you're joining, or the sign-in wall reads as a dead end. */}
      {!inviteHint && joinHint && (
        <div className="auth-hint t-meta" style={{ marginBottom: 0 }}>
          {joinHint.name
            ? <>You've been invited to collaborate on <b>{joinHint.name}</b>. Sign in to join.</>
            : <>You've been invited to collaborate. Sign in to join.</>}
        </div>
      )}

      {/* ?wsjoin= — a whole workspace, named, with who invited them. */}
      {!inviteHint && !joinHint && wsJoinHint && (wsJoinHint.status === 'dead' ? (
        <div className="auth-hint t-meta" style={{ marginBottom: 0 }}>
          That invite link has expired or was turned off. Ask whoever sent it for a new one.
        </div>
      ) : (
        <div className="auth-wsjoin" role="note">
          <span className="auth-wsjoin-av" aria-hidden="true">{(wsJoinHint.name || '?').trim().charAt(0).toUpperCase()}</span>
          <span className="auth-wsjoin-t">
            <b>{wsJoinHint.name ? `Join ${wsJoinHint.name}` : 'Join a workspace'}</b>
            <span>{wsJoinHint.inviter ? `${wsJoinHint.inviter} invited you. ` : ''}Sign in or sign up to join.</span>
          </span>
        </div>
      ))}

      {/* "Get Creator" on /pricing sends a signed-out visitor here. Without a
          line saying so, the sign-in screen looked like the free signup they
          had just declined, and nothing said the offer was still coming. The
          labels were written in by /pricing (creatorIntent.js). */}
      {!inviteHint && !joinHint && !wsJoinHint && creatorHint && (
        <div className="auth-hint t-meta" style={{ marginBottom: 0 }}>
          Sign in to finish getting <b>{creatorHint.planName || 'the paid plan'}</b>
          {creatorHint.priceLabel ? <> at <b>{creatorHint.priceLabel}</b></> : null}
          {' '}— the offer opens as soon as you are in.
        </div>
      )}

      <div className="sb-frost">
        {stage === 'email' ? (
          <form className="auth-form" onSubmit={(e) => { e.preventDefault(); if (email.trim()) { logTypoSeen(email, 'submit'); sendCode(false); } }}>
            <input
              className="auth-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              autoFocus={AUTOFOCUS_EMAIL}
              required
              aria-label="Email address"
              placeholder="you@studio.com"
              value={email}
              onChange={(e) => {
                if (!emailEngagedRef.current) { emailEngagedRef.current = true; logEvent(EV.LANDING_FIELD_ENGAGE, { field: 'email' }); }
                setEmail(e.target.value);
                noteTypo(e.target.value);
              }}
              onBlur={(e) => logTypoSeen(e.target.value, 'blur')}
              disabled={busy}
            />
            {typoOffer('email')}
            <button className="auth-btn" type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Continue with email →'}
            </button>
            {error && <div className="auth-error t-meta">{error}</div>}
            <div className="sb-cap">Sign in or sign up — we'll email a 6-digit code.</div>
          </form>
        ) : (
          <form className="auth-form" onSubmit={verifyCode}>
            <div className="auth-email-row">
              <span className="auth-email-readonly">{email}</span>
              {/* Not while the first code is on its way: its success would
                  remember the step for the address being edited. */}
              <button type="button" className="auth-link" onClick={editEmail} disabled={busy || sending}>
                edit
              </button>
            </div>
            {/* The two-and-a-half minutes people wait for a code that is never
                coming: if the address looks mistyped, say so here too. */}
            {typoOffer('code')}
            <input
              ref={codeRef}
              className="auth-input auth-code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="done"
              pattern="[0-9]*"
              maxLength={6}
              required
              placeholder="••••••"
              value={code}
              onChange={(e) => {
                if (!codeEngagedRef.current) { codeEngagedRef.current = true; logEvent(EV.LANDING_FIELD_ENGAGE, { field: 'code' }); }
                const next = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(next);
                // A wrong-code message describes the digits that were cleared.
                if (error) setError(null);
                // Auto-submit on the 6th digit — a complete code sitting in
                // the field with an unexplained "now press the button" step
                // is pure friction. Brief delay so paste-then-fix still works.
                if (next.length === 6 && !busy) {
                  const form = e.target.closest('form');
                  clearTimeout(autoSubmitRef.current);
                  autoSubmitRef.current = setTimeout(() => {
                    try { form?.requestSubmit?.(); } catch (_) {}
                  }, 250);
                }
              }}
              disabled={busy}
            />
            <button className="auth-btn" type="submit" disabled={busy || code.length < 6}>
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            {error && <div className="auth-error t-meta">{error}</div>}
            <div className="auth-hint t-meta">
              {sending ? 'Sending your code…' : (
                <>
                  {sends > 1
                    ? 'New code sent. Only the newest one works — check Spam or Promotions if it isn\'t there.'
                    : 'Check your inbox for the 6-digit code — and Spam or Promotions if it isn\'t there.'}{' '}
                  {/* The resend control stays a button during cooldown (disabled,
                      counting down) — swapping it for a bare span made it look
                      like the option vanished. */}
                  <button type="button" className="auth-link" onClick={() => sendCode(true)}
                          disabled={busy || resendCooldown > 0}>
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                  </button>
                </>
              )}
            </div>
            {/* A new tab, so this step stays put. Gmail's link searches every
                folder: after the 09-20 invite abuse, codes sat in spam for most
                of a week while people waited here. */}
            {(() => {
              const box = mailboxFor(email);
              return box ? (
                <a className="auth-btn auth-btn-secondary auth-mailbox" href={box.href}
                   target="_blank" rel="noopener noreferrer"
                   onClick={() => { try { logEvent(EV.AUTH_MAILBOX_OPEN, { provider: box.id }); } catch (_) {} }}>
                  {box.label}
                </a>
              ) : null;
            })()}
            {/* Not for an invitee (the invite is bound to this address) and not
                for a mistyped consumer domain (the typo offer is the advice). */}
            {!isConsumerAddress(email) && !inviteHint && !typo && !suggestEmail(email) && (
              <div className="auth-hint t-meta auth-work-hint">
                Work and school mail can hold a code for a few minutes, or quarantine
                it — check there too. A different address signs in to a separate account.
              </div>
            )}
          </form>
        )}
        {/* Empty unless Turnstile needs a person to tap; it serves both steps. */}
        <div ref={captchaRef} className="auth-captcha" />
      </div>

      <p className="sb-trust">Made by a film studio, for creative professionals.</p>
    </SignInBackdrop>
  );
}

// resent: more than one code went to this address, so an earlier one may be
// what was typed. Only the newest works.
function humanError(e, { resent = false } = {}) {
  const msg = (e?.message || String(e || '')).toLowerCase();
  if (msg.includes('captcha')) return "We couldn't confirm you're a person, not a bot. Try again — or another browser if it keeps happening.";
  if (msg.includes('rate') || msg.includes('too many')) return 'Hold on — too many attempts. Try again in a minute.';
  // One GoTrue message covers a wrong digit and a dead token; do not tell a
  // mistyped code it "expired" and send the person to the resend button.
  if (resent && msg.includes('expired') && msg.includes('invalid')) return "That code didn't match. Only the newest code works — use the one in the latest email.";
  if (msg.includes('expired') && msg.includes('invalid')) return "That code didn't match. Check the digits, or request a new one.";
  if (msg.includes('expired'))                          return "That code expired. Request a new one.";
  if (resent && msg.includes('invalid') && msg.includes('token')) return "That code didn't match. Only the newest code works — use the one in the latest email.";
  if (msg.includes('invalid') && msg.includes('token')) return "That code didn't match. Try again or request a new one.";
  if (msg.includes('email') && msg.includes('invalid')) return "That email doesn't look right.";
  return e?.message || String(e || 'Something went wrong.');
}

// Exported so main.jsx can reuse it as the <Suspense> fallback for the lazy
// AppShell / share / legal chunks — identical to AuthGate's own loading state,
// so there's no visual discontinuity when those chunks fetch.
//
// `dark` pins the splash to the brand's dark tokens (.public-dark) for routes
// whose page is committed to the dark world. Without it a light-theme visitor
// saw the dark boot splash, then this one in light grey while the page chunk
// loaded, then the dark page: a dark-white-dark flicker on every landing page.
export function SplashLoading({ dark = false }) {
  return (
    <div className={dark ? 'auth-screen public-dark' : 'auth-screen'}>
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-loading">
        <SoleilMark size={32} color="var(--soleil)" glow />
      </div>
    </div>
  );
}

function DevBanner({ label = 'DEV MODE — Supabase not configured. Boards are local-only and reset on reload.' }) {
  return (
    <div className="dev-banner" title="Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in boards/.env.local">
      {label}
    </div>
  );
}
