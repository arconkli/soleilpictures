// SignupBox — sign up right on a public search page: arm B of the visitor test
// signup_box (lib/experiments.js, from 2026-10-29; look A, one line, picked
// 2026-10-28). It stands where the hero's and the closing band's gold button
// stand in arm A: an email field beside the same button, then the 6-digit code
// in the same spot, then the app. Arm A's button hops to the home page's form
// instead, where most who press it never send an address.
//
// Only React renders it, and only for an enrolled visitor: the Worker's HTML,
// the .md mirrors and every crawler (never enrolled) see today's page.
//
// The page's two boxes share one flow: a code sent from the top puts the end
// one at the code step too. The address a code went to survives a reload
// (lib/pendingCode.js), the same entry the home page's form resumes from.
// Events are counts only, never the address (analyticsEvents.js SIGNUP_BOX_*).
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { supabase } from '../../lib/supabase.js';
import { getFirstSource, logEvent, logEventNow } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { emailProblem } from '../../lib/emailTypo.js';
import { savePendingCode, readPendingCode, clearPendingCode, resendWait } from '../../lib/pendingCode.js';
import { captchaEnabled, captchaToken } from '../../auth/turnstile.js';
import { signInWords, signupFirstSource, keepFailReason } from '../../lib/keepDraft.js';
import './signupBox.css';

const NO_TLD = 'That address is missing its ending, like .com — check the part after the @.';
const storage = () => { try { return window.localStorage; } catch (_) { return null; } };

// ── The page's one flow ──────────────────────────────────────────────────────
let state = null;
const subs = new Set();
const pressedOn = new Set();   // pages whose first press has been counted
function initial() {
  const pending = readPendingCode(storage(), Date.now());
  return pending
    ? { step: 'code', email: pending.email, sentAt: pending.sentAt, sends: pending.sends, code: '', busy: false, error: null, errorPos: null, focus: null }
    : { step: 'email', email: '', sentAt: 0, sends: 0, code: '', busy: false, error: null, errorPos: null, focus: null };
}
const get = () => state ?? (state = initial());
function set(patch) { state = { ...get(), ...patch }; subs.forEach((f) => f()); }
function subscribe(f) { subs.add(f); return () => subs.delete(f); }

async function send(pos, { resending = false, onFirstPress, captchaEl } = {}) {
  const s = get();
  if (s.busy) return;
  const address = String(s.email || '').trim().toLowerCase();
  if (!address || !address.includes('@')) { set({ error: 'Enter your email address.', errorPos: pos, focus: { pos, field: 'email' } }); return; }
  if (emailProblem(address)) {
    logEvent(EV.SIGNUP_BOX_FAILED, { pos, step: 'send', reason: 'no_tld' });
    set({ error: NO_TLD, errorPos: pos, focus: { pos, field: 'email' } });
    return;
  }
  // The press, counted once a page as the landing scorecard counts arm A's
  // button (lp_cta_click), with arm A's free-start handling.
  const page = typeof location !== 'undefined' ? location.pathname : '';
  if (!resending && !pressedOn.has(page)) { pressedOn.add(page); try { onFirstPress?.(); } catch (_) {} }
  const before = s.step;
  // The code step shows at once; a failed send brings the address back.
  set(resending
    ? { busy: true, error: null, errorPos: null }
    : { step: 'code', email: address, code: '', busy: true, error: null, errorPos: null, sentAt: Date.now(), focus: { pos, field: 'code' } });
  try {
    if (!supabase) throw new Error('Sign-in is unavailable right now.');
    const firstSource = signupFirstSource(getFirstSource());
    const challenge = captchaEnabled() ? await captchaToken(captchaEl) : '';
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: {
        emailRedirectTo: window.location.origin,
        ...(challenge ? { captchaToken: challenge } : {}),
        ...(firstSource ? { data: { first_source: firstSource } } : {}),
      },
    });
    if (error) throw error;
    logEvent(EV.SIGNUP_BOX_SEND, { pos, resend: resending });
    const sentAt = Date.now();
    const sends = resending ? Math.max(1, s.sends || 1) + 1 : 1;
    savePendingCode(storage(), address, sentAt, sends);
    set({ busy: false, sentAt, sends });
  } catch (e) {
    logEvent(EV.SIGNUP_BOX_FAILED, { pos, step: 'send', reason: keepFailReason(e) });
    set({ busy: false, step: resending ? get().step : before, error: signInWords(e), errorPos: pos,
      ...(resending ? {} : { focus: { pos, field: 'email' } }) });
  }
}

async function verify(pos, typed) {
  const s = get();
  if (s.busy) return;
  const token = String(typed ?? s.code ?? '').replace(/\D+/g, '');
  if (token.length < 6) { set({ error: 'Enter the 6-digit code from your email.', errorPos: pos }); return; }
  set({ busy: true, error: null, errorPos: null });
  try {
    if (!supabase) throw new Error('Sign-in is unavailable right now.');
    const { error } = await supabase.auth.verifyOtp({ email: s.email, token, type: 'email' });
    if (error) throw error;
    // Beaconed: the page is about to go.
    logEventNow(EV.SIGNUP_BOX_VERIFY, { pos });
    // As the home page's form does: the post-signup journey measures from it.
    try { localStorage.setItem('soleil_ps_otp_at', String(Date.now())); } catch (_) {}
    clearPendingCode(storage());
    set({ step: 'done' });
    window.location.assign('/');
  } catch (e) {
    logEvent(EV.SIGNUP_BOX_FAILED, { pos, step: 'code', reason: keepFailReason(e) });
    set({ busy: false, code: '', error: signInWords(e, { resent: s.sends > 1 }), errorPos: pos, focus: { pos, field: 'code' } });
  }
}

function differentEmail(pos) {
  clearPendingCode(storage());
  set({ step: 'email', code: '', sentAt: 0, sends: 0, error: null, errorPos: null, busy: false, focus: { pos, field: 'email' } });
}

// ── One box ──────────────────────────────────────────────────────────────────
export function SignupBox({ pos, label = 'Start free', onFirstPress }) {
  const s = useSyncExternalStore(subscribe, get, get);
  const id = useId();
  const emailRef = useRef(null);
  const codeRef = useRef(null);
  const captchaRef = useRef(null);
  const [now, setNow] = useState(() => Date.now());

  // The resend wait ticks while the code step shows.
  const wait = s.step === 'code' ? resendWait(s.sentAt, now) : 0;
  useEffect(() => {
    if (s.step !== 'code' || wait <= 0) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [s.step, wait > 0]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Focus follows the box that acted, never the other one.
  useEffect(() => {
    const f = s.focus;
    if (!f || f.pos !== pos) return;
    const el = f.field === 'code' ? codeRef.current : emailRef.current;
    if (el) { el.focus(); set({ focus: null }); }
  }, [s.focus, s.step, pos]);

  const error = s.errorPos === pos ? s.error : null;
  const errorId = `${id}-err`;

  const onCode = (e) => {
    const digits = e.target.value.replace(/\D+/g, '').slice(0, 6);
    set({ code: digits, ...(error ? { error: null, errorPos: null } : {}) });
    if (digits.length === 6) verify(pos, digits);
  };

  // One root, and the captcha's spot last in it at every step: a check that
  // Turnstile opens while the send runs must not lose its element when the
  // code step replaces the email field.
  return (
    <div className="sgb-box" data-signup-box={pos}>
      {s.step === 'done' && <p className="sgb-fine" role="status">Opening your board…</p>}

      {s.step === 'code' && (
        <>
          <p className="sgb-fine sgb-sent" aria-live="polite">
            <b>Check your email.</b> We sent a 6-digit code to <span className="sgb-addr">{s.email}</span>
          </p>
          <form className="sgb-row" noValidate onSubmit={(e) => { e.preventDefault(); verify(pos); }}>
            <label className="sgb-hidden" htmlFor={`${id}-code`}>6-digit code</label>
            <input
              ref={codeRef}
              id={`${id}-code`}
              className="sgb-input is-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="······"
              value={s.code}
              onChange={onCode}
              disabled={s.busy && !!s.code}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? errorId : undefined}
            />
            <button type="submit" className="sgb-btn" disabled={s.busy} aria-busy={s.busy || undefined}>
              {s.busy && s.code.length === 6 ? 'Opening…' : 'Open my board'}
            </button>
          </form>
          {error && <p className="sgb-error" id={errorId} role="alert">{error}</p>}
          <p className="sgb-fine">
            <button type="button" className="sgb-link" onClick={() => differentEmail(pos)}>Use a different email</button>
            <span aria-hidden="true">&nbsp;·&nbsp;</span>
            {wait > 0
              ? <span>Send again in {wait}s</span>
              : <button type="button" className="sgb-link" disabled={s.busy}
                  onClick={() => send(pos, { resending: true, captchaEl: captchaRef.current })}>Send again</button>}
          </p>
        </>
      )}

      {s.step === 'email' && (
        <>
          <form className="sgb-row" noValidate
            onSubmit={(e) => { e.preventDefault(); send(pos, { onFirstPress, captchaEl: captchaRef.current }); }}>
            <label className="sgb-hidden" htmlFor={`${id}-email`}>Email address</label>
            <input
              ref={emailRef}
              id={`${id}-email`}
              className="sgb-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@studio.com"
              value={s.email}
              onChange={(e) => set({ email: e.target.value, ...(error ? { error: null, errorPos: null } : {}) })}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? errorId : `${id}-fine`}
            />
            <button type="submit" className="sgb-btn" disabled={s.busy}>{label}</button>
          </form>
          {error
            ? <p className="sgb-error" id={errorId} role="alert">{error}</p>
            : <p className="sgb-fine" id={`${id}-fine`}>We'll email you a 6-digit code. Free to start.</p>}
        </>
      )}

      <div ref={captchaRef} className="sgb-captcha" />
    </div>
  );
}
