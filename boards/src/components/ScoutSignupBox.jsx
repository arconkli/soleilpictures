// The /scout phone box — the whole call to action, used twice on the page.
//
// It is deliberately built out of the SAME classes as the sign-in box on the
// primary landing page: .sb-frost, .auth-form, .auth-input, .auth-btn, .sb-cap.
// Those live in auth/signin-backdrop.css and styles.css, both of which are in
// the entry chunk (main.jsx statically imports AuthGate → SignInBackdrop), so
// every /scout visitor has already downloaded them. Reusing the classes rather
// than restyling means this is literally the same box, not a lookalike that
// drifts the first time someone touches the auth screen.
//
// TELLING THE TRUTH IS THE HARD PART HERE. Scout is not deployed and has no
// phone line yet, so nothing is actually sent. The endpoint returns the
// signup's real state and this component renders that state — "you're in" when
// the invite is queued, "check your messages" only when a text genuinely went
// out. It must never claim delivery it can't back up.

import { useRef, useState } from 'react';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

// Campaign attribution, read off the URL at submit time rather than stored, so
// this doesn't need its own persistence and can't go stale.
function campaignFields() {
  const out = {};
  try {
    const q = new URLSearchParams(window.location.search);
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
      const v = q.get(k);
      if (v) out[k] = v;
    }
    if (document.referrer) out.referrer = document.referrer;
  } catch (_) { /* non-browser or blocked — attribution is optional */ }
  return out;
}

export function ScoutSignupBox({ pos = 'hero', ctaLabel = 'Text me Scout', autoFocus = false, onSubmitted }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);   // { status: 'queued' | 'texted', is_new }
  const engaged = useRef(false);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (busy || !phone.trim()) return;
    setBusy(true);
    setError(null);
    logEvent(EV.SCOUT_SIGNUP_SUBMIT, { pos });

    try {
      const res = await fetch('/api/scout/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, source: `scout_landing_${pos}`, ...campaignFields() }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        // 400 is the user's typo and says so specifically; 429 is our rate
        // limit; anything else is ours and shouldn't blame them for it.
        const reason = res.status === 400 ? 'invalid' : res.status === 429 ? 'rate' : 'server';
        logEvent(EV.SCOUT_SIGNUP_ERROR, { pos, reason });
        setError(body.error || 'Something went wrong. Try again in a moment.');
        setBusy(false);
        return;
      }

      logEvent(EV.SCOUT_SIGNUP_OK, { pos, status: body.status, is_new: body.is_new });
      setDone({ status: body.status, is_new: body.is_new });
      onSubmitted?.(body);
    } catch (_) {
      logEvent(EV.SCOUT_SIGNUP_ERROR, { pos, reason: 'network' });
      setError("We couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  };

  if (done) {
    const texted = done.status === 'texted';
    return (
      <div className="sb-frost scout-box scout-box-done" role="status">
        <div className="scout-done-mark" aria-hidden="true">✓</div>
        <p className="scout-done-head">
          {texted
            ? 'Sent — check your messages.'
            : done.is_new ? "You're on the list." : "You're already on the list."}
        </p>
        <p className="scout-done-sub">
          {texted
            ? 'Reply with a photo and your first board exists.'
            : 'Scout texts you the moment its line is live. Nothing else to do.'}
        </p>
      </div>
    );
  }

  return (
    <div className="sb-frost scout-box">
      <form className="auth-form" onSubmit={submit}>
        <input
          className="auth-input"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          autoFocus={autoFocus}
          required
          aria-label="Mobile number"
          placeholder="(555) 012-3456"
          value={phone}
          onChange={(ev) => {
            if (!engaged.current) { engaged.current = true; logEvent(EV.LANDING_FIELD_ENGAGE, { field: 'phone' }); }
            setPhone(ev.target.value);
          }}
          disabled={busy}
        />
        <button className="auth-btn" type="submit" disabled={busy || !phone.trim()}>
          {busy ? 'Sending…' : `${ctaLabel} →`}
        </button>
        {error && <div className="auth-error t-meta">{error}</div>}
        {/* Consent ONLY. This is the line that makes the first message an
            opt-in rather than cold outreach, and it is stored with the row
            (consent_version in 0210) — so bump CONSENT_VERSION in
            worker-scout.js whenever this wording changes.

            No platform claim here. It used to open "iPhone today — Android is
            waiting on SMS delivery", which is (a) not consent, (b) a promise
            about Photon's roadmap we can't back, and (c) a third of the words
            under a button. The platform nuance lives in the FAQ, where someone
            who cares will look. */}
        <div className="sb-cap">
          By continuing you agree to receive texts from Soleil Scout. Msg &amp; data rates may apply.{' '}
          <a href="/legal/terms">Terms</a> · <a href="/legal/privacy">Privacy</a>
        </div>
      </form>
    </div>
  );
}
