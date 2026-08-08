// ScoutClaimBanner — "the account you're in has no address yet".
//
// Someone who texted Soleil Scout before ever visiting the site is signed into
// a REAL account that carries a synthetic address they have never seen. It works
// — their photos are on their canvas — but nothing about it is theirs to keep:
// they cannot sign in from another device, cannot be invited to anything, and
// cannot be reached if the link in their thread expires.
//
// This is the one moment to fix that, and the ask is one field.
//
// DETECTING A SHELL ACCOUNT COSTS NOTHING. The synthetic address is already in
// the session, and scoutIdentity.js's syntheticEmail() is the only thing that
// mints one, so the domain IS the signal. An RPC would tell us the same thing a
// round trip later, on every load, for every signed-in user — nearly all of whom
// have never touched Scout. Server-side scout_settle_shell() checks the same
// domain, so the two cannot drift into disagreeing.

import { useState } from 'react';
import { supabase } from '../lib/supabase.js';

// Must match syntheticEmail() in lib/scoutIdentity.js.
const SHELL_DOMAIN = '@scout.soleilpictures.com';

export function isShellEmail(email) {
  return String(email || '').toLowerCase().endsWith(SHELL_DOMAIN);
}

const DISMISS_KEY = 'soleil.scoutClaim.dismissed';

export function ScoutClaimBanner({ user }) {
  // Session-scoped, not permanent: this is worth asking again next visit, and
  // an account with no real address is a problem that does not go away by being
  // ignored. Read once at mount so dismissing does not re-render on every keystroke.
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch (_) { return false; }
  });
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle');   // idle | saving | sent | conflict
  const [error, setError] = useState('');

  if (!isShellEmail(user?.email) || dismissed) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch (_) { /* private mode */ }
    setDismissed(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (state === 'saving') return;
    setError('');
    setState('saving');
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data?.session?.access_token || '';
      if (!accessToken) throw new Error('not signed in');

      const res = await fetch('/api/scout/claim', {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Could not save that address.');

      // The address is spoken for. Do NOT offer to merge from here — proving
      // they own the other account is the whole point, and the connect code
      // does exactly that, from inside it.
      setState(body?.conflict ? 'conflict' : 'sent');
    } catch (err) {
      setError(err?.message || 'Could not save that address.');
      setState('idle');
    }
  };

  return (
    <div className="scout-claim" role="status">
      <div className="scout-claim-body">
        {state === 'sent' ? (
          <p className="scout-claim-msg">
            <b>Check {email}.</b> Follow the link there and this account is yours —
            {' '}same boards, same photos, an address you recognise.
          </p>
        ) : state === 'conflict' ? (
          <p className="scout-claim-msg">
            <b>That address already has a Soleil account.</b> Sign into it, open
            {' '}Settings → Scout, and text yourself the connect code — everything you
            {' '}have already sent moves across with you.
          </p>
        ) : (
          <>
            <p className="scout-claim-msg">
              <b>Your photos are here, but this account has no email yet.</b>
              {' '}Add one so you can get back in from anywhere.
            </p>
            <form className="scout-claim-form" onSubmit={submit}>
              <input
                type="email"
                className="auth-input"
                placeholder="you@studio.com"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                aria-label="Your email address"
                autoComplete="email"
                required
              />
              <button
                type="submit"
                className="auth-btn"
                disabled={state === 'saving' || !email.trim()}
              >
                {state === 'saving' ? 'Sending…' : 'Save my account'}
              </button>
            </form>
            {error && <p className="scout-claim-err">{error}</p>}
          </>
        )}
      </div>
      <button
        type="button"
        className="scout-claim-x"
        onClick={dismiss}
        aria-label="Dismiss"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

export default ScoutClaimBanner;
