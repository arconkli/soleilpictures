// AuthGate — three modes:
//   1. supabase === null  → no env vars; render children with a dev banner.
//   2. signed out          → render the magic-link sign-in screen.
//   3. signed in           → render children + expose user via context.

import { useEffect, useState, createContext, useContext } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase.js';
import { isLocalQaMode } from '../lib/localMode.js';
import { SoleilMark } from '../components/primitives.jsx';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';

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

async function consumeAuthCallback() {
  if (typeof window === 'undefined') return null;

  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const code = query.get('code');
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  const expiresAt = Number(hash.get('expires_at') || 0);

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
    let cancelled = false;
    (async () => {
      try {
        const callbackSession = await consumeAuthCallback();
        const { data } = callbackSession
          ? { data: { session: callbackSession } }
          : await supabase.auth.getSession();
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
      setSession(sess);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [localMode, devWithoutSupabase]);

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

  // Dev mode: no Supabase configured.
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
      {children}
    </AuthContext.Provider>
  );
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <div className="auth-screen">
      <div className="auth-glow" aria-hidden="true" />
      <div className="auth-card">
        <SoleilWordmark size="display" />
        <div className="auth-eyebrow t-eyebrow">INTERNAL WORKSPACE · SOLEIL PICTURES</div>

        {sent ? (
          <div className="auth-sent">
            <div className="auth-sent-title t-h3">Check your inbox</div>
            <div className="auth-sent-sub t-body">We sent a magic link to <b>{email}</b>.</div>
            <button className="auth-link" onClick={() => { setSent(false); setEmail(''); }}>
              Use a different email
            </button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <input
              className="auth-input"
              type="email"
              autoFocus
              required
              placeholder="you@soleilpictures.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
            <button className="auth-btn" type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send magic link'}
            </button>
            {error && <div className="auth-error t-meta">{error}</div>}
            <div className="auth-hint t-meta">We'll email you a link to sign in.</div>
          </form>
        )}
      </div>
      <div className="auth-foot t-meta">© Soleil Pictures</div>
    </div>
  );
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
