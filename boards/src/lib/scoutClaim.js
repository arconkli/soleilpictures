// scoutClaim.js — carry "connect this phone number to the account I'm about to
// make" across the signup roundtrip.
//
// The /scout success box takes a number, queues it on the Scout waitlist, and
// then sends the visitor to the web app — which is open today even though the
// bot is not. This stashes the number so that once a session exists, the new
// account can be attached to the waitlist row, and Scout can find them there
// when it eventually goes live.
//
// Mirrors joinLink.js / remix.js / the PENDING_INVITE_KEY rails: stash on a
// public page, consume once authenticated, survive an OTP magic-link hop into a
// new tab. localStorage rather than sessionStorage for that last reason.
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS IS NOT A TRUST BOUNDARY, and must never be built as one.
//
// Anyone can call scout_claim_signup with any number — this module just saves
// them retyping it. The safety lives entirely in what a claim MEANS: it records
// that an account asked to be connected to a number, and grants no ability
// whatsoever to receive that number's messages. The binding happens later, when
// the number actually texts Scout and confirms, because that is the only moment
// anybody proves they hold the phone.
//
// If you ever find yourself treating what comes out of here as identity, stop:
// that is the account-hijack this design exists to avoid (see migration 0233).
// ─────────────────────────────────────────────────────────────────────────────

const PHONE_KEY = 'soleil.boards.pending.scout.phone';

// E.164, which is the form the Worker normalized to and the exact string
// scout_signups.phone_e164 holds. Validated on the way in AND on the way out —
// localStorage is writable by anything running on this origin, and a malformed
// value should be dropped rather than sent to an RPC.
const E164_RE = /^\+[1-9]\d{6,14}$/;

export function parseScoutPhone(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const v = raw.trim();
  return E164_RE.test(v) ? v : null;
}

export function stashScoutPhone(phone) {
  const p = parseScoutPhone(phone);
  if (!p) return;
  try { localStorage.setItem(PHONE_KEY, p); } catch (_) { /* private mode */ }
}

export function readScoutPhone() {
  try { return parseScoutPhone(localStorage.getItem(PHONE_KEY)); } catch (_) { return null; }
}

export function clearScoutPhone() {
  try { localStorage.removeItem(PHONE_KEY); } catch (_) { /* private mode */ }
}
