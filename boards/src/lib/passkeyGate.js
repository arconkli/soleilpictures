// passkeyGate.js — the few lines of passkeys the first download carries
// (2026-10-29). AuthGate and App.jsx ask here whether passkeys could work at
// all before they fetch lib/passkeys.js, which holds the rest: the entry
// script has a size ceiling (scripts/bundleBudget.mjs), and a preview host or
// a browser without WebAuthn never needs that file.

// Passkeys are bound to this name: Supabase's auth server answers with it as
// the rpId, so a ceremony anywhere else (a preview host, localhost) fails in
// the browser with a SecurityError. Those hosts never show the option.
export const PASSKEY_RP_ID = 'clusters.soleilpictures.com';

export function passkeyHostOk(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === PASSKEY_RP_ID || h.endsWith('.' + PASSKEY_RP_ID);
}

// This browser has WebAuthn and this is the passkeys' host. Dev builds only:
// ?pkqa=1 lifts the host check so tests/passkey-signin.spec.js can run.
export function passkeysMayWork() {
  if (typeof window === 'undefined' || typeof window.PublicKeyCredential !== 'function' || !navigator.credentials?.get) return false;
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('pkqa')) return true;
  return passkeyHostOk(window.location.hostname);
}

// The "Skip the code next time?" offer (lib/passkeyOffer.js) is due only
// right after a sign-in with the emailed code (verifyCode stamps
// soleil_ps_otp_at), never on an account's first day, where the setup screens
// have the floor, and once per device: PASSKEY_OFFER_KEY is set the moment it
// shows. Whether this device can hold one, and whether the account already
// has one, are asked later, by the lazy offer itself.
export const PASSKEY_OFFER_KEY = 'soleil_pk_offer_v1';
const OFFER_WINDOW_MS = 2 * 60 * 1000;
const FIRST_DAY_MS = 24 * 60 * 60 * 1000;

export function passkeyOfferDue({ otpAt, createdAt, offered, hostname, now = Date.now() }) {
  if (offered || !passkeyHostOk(hostname)) return false;
  const at = Number(otpAt);
  if (!Number.isFinite(at) || at <= 0 || now - at > OFFER_WINDOW_MS || at - now > 5000) return false;
  const born = Date.parse(String(createdAt || ''));
  if (!Number.isFinite(born) || now - born < FIRST_DAY_MS) return false;
  return true;
}
