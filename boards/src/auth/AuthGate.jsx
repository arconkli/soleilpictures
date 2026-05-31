// AuthGate — three modes:
//   1. supabase === null  → no env vars; render children with a dev banner.
//   2. signed out          → render the OTP sign-in screen.
//   3. signed in           → render children + expose user via context.
//
// Sign-in flow (post-rework):
//   • User types email → we call signInWithOtp (shouldCreateUser defaults true,
//     so new emails get an account created at verify time).
//   • The email contains BOTH a clickable magic link AND a 6-digit code.
//   • A 6-digit code input slides in on the same page. The user can type the
//     code from any device (e.g. read on phone, type on desktop) OR click the
//     magic link to land back here with ?code=… and consume that.
//   • Tier='waitlist' is the default for new accounts (set in migration
//     0088's ensure_profile_for_new_user trigger; 0085/0087 had briefly
//     regressed it to 'demo'). TierRouter sends waitlist users to
//     /welcome where they pick between requesting demo access or paying.

import { useEffect, useRef, useState, createContext, useContext } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase.js';
import { isLocalQaMode } from '../lib/localMode.js';
import { logEvent } from '../lib/analytics.js';
import { usePresenceHeartbeat } from '../hooks/usePresenceHeartbeat.js';
import { peekPendingInviteEmail, claimPendingInvite } from '../lib/boardsApi.js';
import { trackRegistration } from '../lib/metaPixel.js';
import { SoleilMark } from '../components/primitives.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';

// Localstorage key holding an in-flight invite token between the
// pre-signup landing (?invite=…) and the post-signup claim hook.
// Cleared once claim_pending_invite returns (or fails terminally).
const PENDING_INVITE_KEY = 'soleil.boards.pending.invite.token';

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
      // keys (viewOverride / splitId / splitRatio) the user already had.
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
    return data.session;
  }
  if (!accessToken || !refreshToken) return null;
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
  return data.session;
}

export function AuthGate({ children }) {
  const localMode = isLocalQaMode();
  const devWithoutSupabase = !isSupabaseConfigured;
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured && !localMode);

  useEffect(() => {
    if (localMode || devWithoutSupabase) return;
    if (!supabase) return;
    // Capture ?invite=<token> on every mount BEFORE any auth roundtrip,
    // so a click from the invite email survives the OTP redirect dance.
    captureInviteToken();
    let cancelled = false;
    (async () => {
      try {
        const callbackSession = await consumeAuthCallback();
        const { data } = callbackSession
          ? { data: { session: callbackSession } }
          : await supabase.auth.getSession();
        // Write deep-link params into localStorage BEFORE setSession,
        // so when App mounts its useState initializer reads the right
        // workspace + board on the very first render.
        if (data.session?.user?.id) {
          consumeDeepLink(data.session.user.id);
          await consumePendingInvite(data.session.user.id);
        }
        if (!cancelled) setSession(data.session);
      } catch (error) {
        console.warn('Auth session could not be restored', error);
        clearAuthUrl();
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      // Same as above — also handle the post-OTP sign-in path where the
      // session arrives after initial mount via this listener. Defer
      // setSession until consumePendingInvite has written the redirect
      // localStorage, so App's first render reads the right workspace +
      // board after a magic-link signup.
      (async () => {
        if (sess?.user?.id) {
          consumeDeepLink(sess.user.id);
          await consumePendingInvite(sess.user.id);
        }
        if (!cancelled) setSession(sess);
      })();
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [localMode, devWithoutSupabase]);

  // Meta CompleteRegistration (CAPI) — fires once for a genuinely-new account.
  // Idempotent: localStorage-guarded per device + server dedup by reg:<userId>,
  // and only fires when user.created_at is recent, so re-running on session
  // changes (or for returning users) is a safe no-op.
  useEffect(() => {
    if (localMode || devWithoutSupabase) return;
    if (session?.user) trackRegistration(session);
  }, [session, localMode, devWithoutSupabase]);

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

  if (loading) return <SplashLoading />;
  if (!session) return <SignIn />;

  const signOut = async () => { await supabase.auth.signOut(); };

  return (
    <AuthContext.Provider value={{ user: session.user, signOut }}>
      <PresenceTicker user={session.user} />
      {children}
    </AuthContext.Provider>
  );
}

// Renders nothing — just runs the heartbeat hook so server-side email
// triggers can skip notifications when the user is currently in-app.
function PresenceTicker({ user }) {
  usePresenceHeartbeat(user);
  return null;
}

// ── Sign-in screen with OTP code ────────────────────────────────────────────

function SignIn() {
  const [email, setEmail]       = useState('');
  const [stage, setStage]       = useState('email'); // 'email' | 'code'
  const [busy,  setBusy]        = useState(false);
  const [code,  setCode]        = useState('');
  const [error, setError]       = useState(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  // Non-null when the user arrived via an /?invite=<token> link.
  // We pre-fill the email field and show an "invited as ..." banner.
  const [inviteHint, setInviteHint] = useState(null);
  const codeRef = useRef(null);

  // Tick down the resend cooldown (Supabase rate-limits OTP requests at ~60s).
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendCooldown]);

  // Funnel: landing_view fires once when the SignIn screen mounts.
  useEffect(() => { logEvent('landing_view'); }, []);

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
          setEmail(addr);
          setInviteHint({ email: addr });
        })
        .catch(() => {});
    } catch (_) {}
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
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          // shouldCreateUser defaults to true — new emails get an account
          // at verify time. The 0067 migration sets tier='waitlist' so
          // they're routed through /welcome before they can use the app.
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      logEvent('email_submit', { resend: !!resending });
      if (!resending) setStage('code');
      setResendCooldown(60);
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (e) => {
    e?.preventDefault?.();
    if (busy) return;
    const token = code.replace(/\s+/g, '');
    if (token.length < 6) { setError('Enter the 6-digit code from your email.'); return; }
    setError(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token,
        type: 'email',
      });
      if (error) throw error;
      logEvent('otp_verify');
      // onAuthStateChange will fire SIGNED_IN; AuthGate re-renders to children.
    } catch (e) {
      setError(humanError(e));
      setBusy(false);
    }
  };

  const editEmail = () => {
    setStage('email');
    setCode('');
    setError(null);
  };

  return (
    <div className="auth-screen">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-card">
        <header className="sr-only">
          <h1>Soleil Clusters</h1>
          <p>Soleil Clusters is a creative workspace and moodboard tool for production teams. Organize references, projects, and ideas across film, photo, design, and brand work, and collaborate with your team in real time.</p>
        </header>
        <SoleilWordmark size="display" />

        {inviteHint && (
          <div className="auth-hint t-meta" style={{ marginBottom: 8 }}>
            You've been invited. Sign in with <b>{inviteHint.email}</b> to accept.
          </div>
        )}

        {stage === 'email' ? (
          <form className="auth-form" onSubmit={(e) => { e.preventDefault(); if (email.trim()) sendCode(false); }}>
            <input
              className="auth-input"
              type="email"
              autoFocus
              required
              aria-label="Email address"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
            <button className="auth-btn" type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
            {error && <div className="auth-error t-meta">{error}</div>}
            <div className="auth-hint t-meta">We'll email you a 6-digit code.</div>
          </form>
        ) : (
          <form className="auth-form" onSubmit={verifyCode}>
            <div className="auth-email-row">
              <span className="auth-email-readonly">{email}</span>
              <button type="button" className="auth-link" onClick={editEmail} disabled={busy}>
                edit
              </button>
            </div>
            <input
              ref={codeRef}
              className="auth-input auth-code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              required
              placeholder="• • • • • •"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={busy}
            />
            <button className="auth-btn" type="submit" disabled={busy || code.length < 6}>
              {busy ? 'Verifying…' : 'Sign in'}
            </button>
            {error && <div className="auth-error t-meta">{error}</div>}
            <div className="auth-hint t-meta">
              Check your inbox for the 6-digit code.{' '}
              {resendCooldown > 0
                ? <span>Resend in {resendCooldown}s</span>
                : <button type="button" className="auth-link" onClick={() => sendCode(true)} disabled={busy}>Resend code</button>}
            </div>
          </form>
        )}
      </div>
      <div className="auth-foot t-meta">© Soleil Pictures</div>
    </div>
  );
}

function humanError(e) {
  const msg = (e?.message || String(e || '')).toLowerCase();
  if (msg.includes('rate') || msg.includes('too many')) return 'Hold on — too many attempts. Try again in a minute.';
  if (msg.includes('expired'))                          return "That code expired. Request a new one.";
  if (msg.includes('invalid') && msg.includes('token')) return "That code didn't work. Try again or request a new one.";
  if (msg.includes('email') && msg.includes('invalid')) return "That email doesn't look right.";
  return e?.message || String(e || 'Something went wrong.');
}

function SplashLoading() {
  return (
    <div className="auth-screen">
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
