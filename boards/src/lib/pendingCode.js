// pendingCode.js — the sign-in code step survives a reload.
//
// To read the code, a phone switches to its mail app. Coming back, the tab may
// have been reloaded (the OS reclaimed it, or an in-app browser reopened the
// page), and the code step lived only in React state: the person landed on an
// empty email field with nothing to say their code was on its way. Since
// September the phone code step has been abandoned far more often than the
// desktop one, almost always as "sent, switched away, never came back".
//
// This remembers WHICH ADDRESS a code went to, for long enough to type it in —
// never the code itself. Pure over an injected Storage so it runs in node.
export const PENDING_CODE_KEY = 'soleil.auth.pendingCode';
export const PENDING_CODE_TTL_MS = 15 * 60 * 1000;
export const RESEND_COOLDOWN_S = 60;            // Supabase rate-limits OTP sends at ~60s
const FUTURE_SKEW_MS = 60 * 1000;

function validEmail(email) {
  return typeof email === 'string' && email.length >= 3 && email.length <= 254 && email.includes('@');
}

export function savePendingCode(storage, email, now) {
  if (!storage || !validEmail(email) || !Number.isFinite(now)) return false;
  try {
    storage.setItem(PENDING_CODE_KEY, JSON.stringify({ email, sentAt: now }));
    return true;
  } catch (_) { return false; }
}

export function clearPendingCode(storage) {
  try { storage?.removeItem(PENDING_CODE_KEY); } catch (_) { /* ignore */ }
}

// { email, sentAt } while the code step is still worth showing, else null — and
// an expired, malformed or future-dated entry is removed on the way out.
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
  return { email: v.email, sentAt: v.sentAt };
}

// Seconds left on the resend cooldown for a code sent at sentAt.
export function resendWait(sentAt, now, cooldownS = RESEND_COOLDOWN_S) {
  if (!Number.isFinite(sentAt) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.min(cooldownS, cooldownS - Math.floor((now - sentAt) / 1000)));
}
