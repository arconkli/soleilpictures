// Cloudflare Turnstile in front of the sign-in code (2026-10-06 audit).
//
// Supabase Auth mails a sign-in code to any address it is asked to, no account
// needed — so without a challenge, a script can make our sign-in domain mail
// anyone, as fast as the project's email rate limit allows, and spend the
// reputation every real sign-in code depends on. With captcha switched on in
// Supabase Auth, signInWithOtp needs a Turnstile token; this makes one,
// invisibly for nearly everyone, with a one-tap check only when Cloudflare
// is unsure.
//
// Dormant until VITE_TURNSTILE_SITE_KEY is set at build time. ORDER MATTERS:
// ship a build with the key first, THEN switch captcha on in the Supabase
// dashboard with the matching secret — the reverse order breaks every sign-in.
//
// The script loads only when a code is requested, so the landing page pays
// nothing for it (AuthGate stays import-light: this file has no imports).
const SITE_KEY = import.meta.env?.VITE_TURNSTILE_SITE_KEY || '';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export function captchaEnabled() {
  return !!SITE_KEY;
}

let scriptPromise = null;
function loadTurnstile() {
  if (typeof window !== 'undefined' && window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_URL;
      s.async = true;
      s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('captcha unavailable')));
      s.onerror = () => { scriptPromise = null; reject(new Error('captcha unavailable')); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

// A fresh token for every code request: a token is good for one use, and a
// resend is a new request. `container` is where Turnstile may show its check
// if it needs one. Resolves '' when captcha is not configured.
export async function captchaToken(container) {
  if (!SITE_KEY) return '';
  const ts = await loadTurnstile();
  return new Promise((resolve, reject) => {
    let id = null;
    const finish = (fn, value) => {
      try { if (id != null) ts.remove(id); } catch (_) { /* already gone */ }
      fn(value);
    };
    id = ts.render(container, {
      sitekey: SITE_KEY,
      appearance: 'interaction-only',
      callback: (token) => finish(resolve, token),
      'error-callback': () => finish(reject, new Error('captcha check failed')),
      'expired-callback': () => finish(reject, new Error('captcha check expired')),
      'timeout-callback': () => finish(reject, new Error('captcha check timed out')),
    });
  });
}
