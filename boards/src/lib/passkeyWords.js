// passkeyWords.js — what a passkey failure says to a person, the short reason
// the events carry, and a new passkey's name (2026-10-29). No imports, so
// passkeyWords.test.mjs runs it under plain node. Where passkeys can work at
// all is lib/passkeyGate.js.

// A ceremony the person closed, or one we aborted ourselves (autofill making
// way for the button, the page moving on), says nothing at all.
export function passkeyCancelled(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const causeName = String(err.cause?.name || '');
  return code === 'ERROR_CEREMONY_ABORTED'
    || err.name === 'AbortError' || causeName === 'AbortError'
    || err.name === 'NotAllowedError' || causeName === 'NotAllowedError';
}

// Plain words for the box, or null when the right answer is silence.
export function passkeyErrorWords(err, { saving = false } = {}) {
  if (!err || passkeyCancelled(err)) return null;
  const code = String(err.code || '');
  const causeName = String(err.cause?.name || '');
  const msg = String(err.message || '').toLowerCase();
  if (code === 'webauthn_credential_exists' || code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || causeName === 'InvalidStateError') {
    return 'This device already has a passkey for your account.';
  }
  if (code === 'too_many_passkeys') return 'Your account holds as many passkeys as it can. Remove one in Settings first.';
  if (code === 'webauthn_credential_not_found') return "That passkey isn't on your account any more. Use your email instead.";
  if (code === 'webauthn_challenge_expired' || code === 'webauthn_challenge_not_found') return 'That took too long. Try again.';
  if (code === 'webauthn_verification_failed') return saving ? "That passkey couldn't be saved. Try again." : "That passkey didn't check out. Try again, or use your email.";
  if (code === 'passkey_disabled') return 'Passkeys are switched off right now. Use your email instead.';
  if (code === 'user_banned') return "This account can't sign in.";
  if (code === 'email_not_confirmed') return 'Confirm your email first: sign in with the code we send.';
  if (code === 'over_request_rate_limit' || err.status === 429 || msg.includes('rate limit') || msg.includes('too many')) return 'Too many tries. Wait a minute and try again.';
  if (code === 'ERROR_INVALID_DOMAIN' || code === 'ERROR_INVALID_RP_ID' || causeName === 'SecurityError') return "Passkeys don't work on this address.";
  if (err.name === 'AuthRetryableFetchError' || msg.includes('failed to fetch') || msg.includes('network')) return "Couldn't reach the server. Check your connection and try again.";
  return saving ? "That passkey couldn't be saved. Try again." : "That didn't work. Try again, or use your email.";
}

// The short reason an event carries: a server code, the browser's error name,
// or 'error'. Never a message, which can carry an address.
export function passkeyFailReason(err) {
  if (!err) return 'error';
  if (passkeyCancelled(err)) return 'cancelled';
  const code = String(err.code || '');
  if (code && code !== 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY') return code.slice(0, 48);
  const causeName = String(err.cause?.name || err.name || '');
  return (causeName || 'error').slice(0, 48);
}

// A name for a newly saved passkey when the server gives it none, so the
// Settings list can tell two apart: "iPhone · Safari".
export function passkeyDeviceLabel(ua) {
  const s = String(ua || '');
  const device = /iPhone/.test(s) ? 'iPhone'
    : /iPad/.test(s) ? 'iPad'
    : /Android/.test(s) ? 'Android'
    : /Macintosh|Mac OS X/.test(s) ? 'Mac'
    : /Windows/.test(s) ? 'Windows'
    : /CrOS/.test(s) ? 'Chromebook'
    : /Linux/.test(s) ? 'Linux'
    : '';
  const browser = /Edg\//.test(s) ? 'Edge'
    : /Firefox\/|FxiOS/.test(s) ? 'Firefox'
    : /Chrome\/|CriOS/.test(s) ? 'Chrome'
    : /Safari\//.test(s) ? 'Safari'
    : '';
  return [device, browser].filter(Boolean).join(' · ') || 'Passkey';
}

