// ResumePage — /resume?rt=<token>&w=&b=&lc=
//
// The landing for every lifecycle email CTA. It spends the single-use resume
// token minted with the send (migration 0235) and drops the reader into their
// board with a live session.
//
// Why it exists: over the program's first seven weeks lifecycle mail opened at
// ~40%, clicked at ~2.9%, and put a single-digit number of readers into the app.
// Win-back recipients average 27 days since their last sign-in and every one is
// more than a week stale, which makes the OTP wall the leading suspect — see
// migration 0235 for why that remains a hypothesis. This removes it as a
// variable regardless, and costs a still-signed-in reader one button press.
//
// Two things here are load-bearing and easy to "tidy" into breakage:
//
//   1. THE BUTTON IS NOT AUTO-CLICKED. Resend rewrites every CTA through its
//      own click-tracking host and inbox scanners prefetch links, so anything
//      spendable by a page load gets spent by a robot before the human sees it.
//      Redemption happens on a real press, and only then.
//   2. It renders OUTSIDE AuthGate (wired in main.jsx next to /share and
//      /legal). Booting the gate here would show the very sign-in wall this
//      page exists to skip.
//
// A failed or already-spent token is not an error state to apologise for — it
// falls back to normal sign-in, which still works.

import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { logEvent, logEventNow } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { SoleilWordmark } from '../components/SoleilWordmark.jsx';
import { SignInBackdrop } from '../auth/SignInBackdrop.jsx';

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/resume-session`;

// Same shape the mint produces and the edge function re-checks. Anything else
// never leaves the browser.
const TOKEN_RE = /^[0-9a-f]{64}$/;

function readParams() {
  try {
    const p = new URL(window.location.href).searchParams;
    const rt = p.get('rt') || '';
    return {
      token: TOKEN_RE.test(rt) ? rt : '',
      w:  p.get('w')  || '',
      b:  p.get('b')  || '',
      lc: (p.get('lc') || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64),
    };
  } catch (_) {
    return { token: '', w: '', b: '', lc: '' };
  }
}

// Where to send them once the session exists. ?w/?b are handed straight to
// AuthGate's consumeDeepLink, which is already the mechanism transactional mail
// uses to land on a specific board. ?lc is deliberately NOT forwarded — this
// page has already recorded the landing, and passing it on would double-count.
function appUrl({ w, b }) {
  const qs = new URLSearchParams();
  if (w) qs.set('w', w);
  if (b) qs.set('b', b);
  const tail = qs.toString();
  return tail ? `/?${tail}` : '/';
}

export function ResumePage() {
  const { token, w, b, lc } = readParams();
  const emailType = lc ? (lc.includes('.') ? lc.slice(0, lc.indexOf('.')) : lc) : null;
  const contentVersion = lc && lc.includes('.') ? lc.slice(lc.indexOf('.') + 1) : null;

  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(!token);

  // The arrival. Fired on mount, signed_in:false, because that is the honest
  // description of everyone who reaches this page — and counting the ones who
  // get this far and still don't come back is the entire point.
  useEffect(() => {
    logEvent(EV.LIFECYCLE_LAND, {
      email_type: emailType, content_version: contentVersion,
      signed_in: false, via: 'resume',
    });
  }, [emailType, contentVersion]);

  async function resume() {
    if (busy || !token || !supabase) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(FUNCTIONS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.tokenHash) { setFailed(true); setBusy(false); return; }

      // verifyOtp on the CLIENT, not a session minted server-side: this is what
      // writes the session through the SDK's own storage, which is where the
      // rest of the app looks for it.
      const { error } = await supabase.auth.verifyOtp({
        token_hash: body.tokenHash, type: 'magiclink',
      });
      if (error) { setFailed(true); setBusy(false); return; }

      // logEventNow, not logEvent: we are about to navigate, and this is the
      // number that says whether any of this worked.
      logEventNow(EV.LIFECYCLE_RESUME, {
        email_type: emailType, content_version: contentVersion,
      });
      window.location.assign(appUrl({ w, b }));
    } catch (_) {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <SignInBackdrop>
      <header className="sr-only">
        <h1>Soleil Clusters</h1>
      </header>
      <SoleilWordmark size="display" />

      <div className="sb-frost">
        {failed ? (
          <div className="auth-form">
            <p className="auth-hint t-meta" style={{ marginTop: 0 }}>
              That link has already been used or has expired. Signing in takes a
              moment and gets you to the same place.
            </p>
            <a className="auth-btn" href={appUrl({ w, b })}>Sign in</a>
          </div>
        ) : (
          <div className="auth-form">
            <p className="auth-hint t-meta" style={{ marginTop: 0 }}>
              Welcome back — pick up where you left off.
            </p>
            <button className="auth-btn" type="button" onClick={resume} disabled={busy}>
              {busy ? 'Opening…' : 'Open my clusters'}
            </button>
          </div>
        )}
      </div>
    </SignInBackdrop>
  );
}
