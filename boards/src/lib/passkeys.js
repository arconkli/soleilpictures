// passkeys.js — signing in and saving with a passkey (2026-10-29).
//
// Supabase Auth does the server half (its passkey endpoints, switched on for
// the project; the client opts in with auth.experimental.passkey in
// lib/supabase.js). Sign-in stays the email code; a passkey is the quicker
// way back for people who saved one. Two ways in on the sign-in box:
//
//   * autofill: the email field offers saved passkeys in the browser's own
//     suggestion list (WebAuthn "conditional mediation"). auth-js 2.105's
//     signInWithPasskey can't ask for that, so this runs the two steps
//     itself: passkey.startAuthentication() → navigator.credentials.get(
//     {mediation:'conditional'}) → passkey.verifyAuthentication(). The
//     server's challenge lives 5 minutes, so the wait restarts before then,
//     and only while the tab is visible; the first starts once a person
//     touches the page (whenHuman).
//   * the quiet "Use a passkey" link: the browser's own passkey sheet.
//
// Only one WebAuthn request can be pending, so the link (and anything else
// leaving the email step) aborts the autofill wait first.
//
// Never in the entry bundle: AuthGate asks lib/passkeyGate.js first and
// imports this file only where passkeys could work.
import { supabase, isSupabaseConfigured } from './supabase.js';
import { passkeysMayWork } from './passkeyGate.js';
import { passkeyDeviceLabel } from './passkeyWords.js';

// AuthGate loads this file lazily and takes its words from it too.
export { passkeyErrorWords, passkeyFailReason } from './passkeyWords.js';

const ROUND_MS = 4.5 * 60 * 1000;   // under the server's 5-minute challenge

// What this browser can do here. `link`: a passkey can be used at all (a
// phone or security key counts). `autofill`: the email field can offer them.
// `platform`: this device itself can hold one (Touch ID, Face ID, Hello).
export async function passkeySupport() {
  const none = { link: false, autofill: false, platform: false };
  if (!isSupabaseConfigured || !supabase?.auth?.passkey || !passkeysMayWork()) return none;
  const PKC = window.PublicKeyCredential;
  let autofill = false;
  let platform = false;
  try { autofill = !!(await PKC.isConditionalMediationAvailable?.()); } catch (_) {}
  try { platform = !!(await PKC.isUserVerifyingPlatformAuthenticatorAvailable?.()); } catch (_) {}
  return { link: true, autofill, platform };
}

// ── base64url ⇄ bytes, for browsers without the WebAuthn JSON helpers ──
function fromB64u(s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function toB64u(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function requestOptions(json) {
  const PKC = window.PublicKeyCredential;
  if (typeof PKC.parseRequestOptionsFromJSON === 'function') return PKC.parseRequestOptionsFromJSON(json);
  const { challenge, allowCredentials, ...rest } = json;
  const out = { ...rest, challenge: fromB64u(challenge) };
  if (allowCredentials?.length) out.allowCredentials = allowCredentials.map((c) => ({ ...c, id: fromB64u(c.id), type: c.type || 'public-key' }));
  return out;
}
function assertionJSON(cred) {
  if (typeof cred.toJSON === 'function') return cred.toJSON();
  const r = cred.response;
  return {
    id: cred.id,
    rawId: cred.id,
    type: 'public-key',
    response: {
      authenticatorData: toB64u(r.authenticatorData),
      clientDataJSON: toB64u(r.clientDataJSON),
      signature: toB64u(r.signature),
      userHandle: r.userHandle ? toB64u(r.userHandle) : undefined,
    },
    clientExtensionResults: cred.getClientExtensionResults?.() || {},
    authenticatorAttachment: cred.authenticatorAttachment || undefined,
  };
}

// GET /passkeys answers with the list itself; accept a wrapped one too, so a
// change of shape empties nothing silently.
export function passkeyRows(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.passkeys)) return data.passkeys;
  return [];
}

// ── autofill ──
let autofillCtrl = null;

export function stopPasskeyAutofill() {
  if (autofillCtrl) { try { autofillCtrl.abort(); } catch (_) {} }
  autofillCtrl = null;
}

// Each wait asks the server for a challenge, which it stores. The sign-in box
// is also the home page, so the first wait holds off until a person is there:
// a pointer, a touch or a key. Crawlers never press anything.
let humanSeen = false;
// Not focus: the email field's own autofocus would count.
const HUMAN_EVENTS = ['pointerdown', 'pointermove', 'touchstart', 'keydown'];
function whenHuman(signal) {
  if (humanSeen) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      for (const e of HUMAN_EVENTS) window.removeEventListener(e, seen, true);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const seen = (e) => { if (e.isTrusted === false) return; humanSeen = true; done(); };
    for (const e of HUMAN_EVENTS) window.addEventListener(e, seen, { capture: true, passive: true });
    signal.addEventListener('abort', done);
  });
}

function whenVisible(signal) {
  if (document.visibilityState === 'visible') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { document.removeEventListener('visibilitychange', check); signal.removeEventListener('abort', done); resolve(); };
    const check = () => { if (document.visibilityState === 'visible') done(); };
    document.addEventListener('visibilitychange', check);
    signal.addEventListener('abort', done);
  });
}

// Starts the email field's passkey suggestions. `onPicked` runs once the
// person chose a passkey, before the server checks it; `onDone({error})`
// after the check (no error: SIGNED_IN has fired and the app opens). A failed
// check reports and waits again. Returns a stop function.
export function startPasskeyAutofill({ onPicked, onDone } = {}) {
  stopPasskeyAutofill();
  const ctrl = new AbortController();
  autofillCtrl = ctrl;
  const { signal } = ctrl;
  (async () => {
    let failures = 0;
    while (!signal.aborted && failures < 3) {
      await whenHuman(signal);
      await whenVisible(signal);
      if (signal.aborted) return;
      const { data: opts, error: optsError } = await supabase.auth.passkey.startAuthentication({ options: {} });
      if (signal.aborted) return;
      if (optsError || !opts?.options) return;   // autofill is a bonus: give up quietly
      const round = new AbortController();
      const stopRound = () => round.abort();
      signal.addEventListener('abort', stopRound);
      const timer = setTimeout(stopRound, ROUND_MS);
      let cred = null;
      try {
        cred = await navigator.credentials.get({ mediation: 'conditional', publicKey: requestOptions(opts.options), signal: round.signal });
      } catch (e) {
        cred = null;
        // A round that ran out restarts; any other refusal ends autofill.
        if (e?.name !== 'AbortError') failures = 3;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', stopRound);
      }
      if (signal.aborted) return;
      if (!cred) continue;
      try { onPicked?.(); } catch (_) {}
      const { error } = await supabase.auth.passkey.verifyAuthentication({ challengeId: opts.challenge_id, credential: assertionJSON(cred) });
      try { onDone?.({ error: error || null }); } catch (_) {}
      if (!error) { if (autofillCtrl === ctrl) autofillCtrl = null; return; }
      failures += 1;
    }
  })().catch(() => {});
  return () => { if (autofillCtrl === ctrl) stopPasskeyAutofill(); else ctrl.abort(); };
}

// The "Use a passkey" link: the browser's own passkey sheet. Resolves to
// { error } — none means SIGNED_IN has fired.
export async function signInWithPasskeyNow({ captchaToken } = {}) {
  stopPasskeyAutofill();
  const { error } = await supabase.auth.signInWithPasskey({ options: captchaToken ? { captchaToken } : {} });
  return { error: error || null };
}

// Saves a passkey for the signed-in person on this device, naming it after
// the device when the server gives it no name. Resolves to { passkey, error }.
export async function savePasskey() {
  const { data, error } = await supabase.auth.registerPasskey();
  if (error || !data) return { passkey: null, error: error || new Error('no passkey') };
  let passkey = data;
  if (!data.friendly_name && data.id) {
    const label = passkeyDeviceLabel(navigator.userAgent);
    const { data: named } = await supabase.auth.passkey.update({ passkeyId: data.id, friendlyName: label });
    passkey = { ...data, ...(named || {}), friendly_name: named?.friendly_name || label };
  }
  return { passkey, error: null };
}
