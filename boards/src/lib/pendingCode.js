// pendingCode.js — the sign-in code step survives a reload.
//
// To read the code, a phone switches to its mail app. Coming back, the tab may
// have been reloaded (the OS reclaimed it, or an in-app browser reopened the
// page), and the code step lived only in React state: the person landed on an
// empty email field with nothing to say their code was on its way. Since
// September the phone code step has been abandoned far more often than the
// desktop one, almost always as "sent, switched away, never came back".
//
// This remembers WHICH ADDRESS a code went to, for as long as the code can be
// typed, and how many codes went there — never the code itself. Asking again
// kills the code before it, and the person who reloads after a resend is the
// one most likely to type the old one. Pure over an injected Storage so it runs
// in node.
export const PENDING_CODE_KEY = 'soleil.auth.pendingCode';
// The life of a code: Email OTP Expiration in the Supabase dashboard (Auth →
// Providers → Email), one hour. Keep the two equal, and the email's "It works
// for an hour" (supabase/templates/magic_link.html) with them.
export const PENDING_CODE_TTL_MS = 60 * 60 * 1000;
export const RESEND_COOLDOWN_S = 60;            // Supabase rate-limits OTP sends at ~60s
const FUTURE_SKEW_MS = 60 * 1000;

function validEmail(email) {
  return typeof email === 'string' && email.length >= 3 && email.length <= 254 && email.includes('@');
}

// sends: how many codes have gone to this address in this step, the first
// included. Only the newest one works.
export function savePendingCode(storage, email, now, sends = 1) {
  if (!storage || !validEmail(email) || !Number.isFinite(now)) return false;
  const n = Number.isInteger(sends) && sends >= 1 ? sends : 1;
  try {
    storage.setItem(PENDING_CODE_KEY, JSON.stringify({ email, sentAt: now, sends: n }));
    return true;
  } catch (_) { return false; }
}

export function clearPendingCode(storage) {
  try { storage?.removeItem(PENDING_CODE_KEY); } catch (_) { /* ignore */ }
}

// { email, sentAt, sends } while the code step is still worth showing, else
// null — and an expired, malformed or future-dated entry is removed on the way
// out. An entry written before sends existed reads as one send.
export function readPendingCode(storage, now, ttlMs = PENDING_CODE_TTL_MS) {
  if (!storage || !Number.isFinite(now)) return null;
  let raw = null;
  try { raw = storage.getItem(PENDING_CODE_KEY); } catch (_) { return null; }
  if (!raw) return null;
  let v = null;
  try { v = JSON.parse(raw); } catch (_) { v = null; }
  const ok = v && validEmail(v.email) && Number.isFinite(v.sentAt)
    && v.sentAt <= now + FUTURE_SKEW_MS && now - v.sentAt <= ttlMs;
  if (!ok) { clearPendingCode(storage); return null; }
  const sends = Number.isInteger(v.sends) && v.sends >= 1 ? v.sends : 1;
  return { email: v.email, sentAt: v.sentAt, sends };
}

// Seconds left on the resend cooldown for a code sent at sentAt.
export function resendWait(sentAt, now, cooldownS = RESEND_COOLDOWN_S) {
  if (!Number.isFinite(sentAt) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.min(cooldownS, cooldownS - Math.floor((now - sentAt) / 1000)));
}
