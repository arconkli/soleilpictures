// ringAuto.js — auto-route eligible admins to the latest (staging) build.
//
// On app mount for a signed-in user, ask the prod Worker to "join the ring"
// (POST /api/ring/join with the user's access token). If the Worker says the
// user is eligible (admin OR internal_accounts allowlist), it sets the signed
// soleil_ring cookie and we reload once — from then on the prod Worker
// transparently proxies this user to the staging Worker (the latest build) on
// the real domain, session intact. Non-eligible users get a negative answer and
// nothing changes.
//
// Guards: never run when already on staging (window.__env), honor a manual
// "stable" opt-out (localStorage), and only attempt once per tab session.
import { supabase } from './supabase.js';

const PREF_KEY     = 'soleil_ring_pref';     // 'latest' | 'stable'
const ELIGIBLE_KEY = 'soleil_ring_eligible'; // '1' once the server confirms eligibility
const TRIED_KEY    = 'soleil_ring_tried';    // sessionStorage one-shot guard

export function ringPref() {
  try { return localStorage.getItem(PREF_KEY) || 'latest'; } catch (_) { return 'latest'; }
}
export function setRingPref(v) {
  try { localStorage.setItem(PREF_KEY, v); } catch (_) {}
}
// Whether this user is known (from a prior join) to be ring-eligible. Drives the
// RingIndicator's visibility on prod so normal users never see the control.
export function ringEligible() {
  try { return localStorage.getItem(ELIGIBLE_KEY) === '1'; } catch (_) { return false; }
}
function rememberEligible(yes) {
  try {
    if (yes) localStorage.setItem(ELIGIBLE_KEY, '1');
    else localStorage.removeItem(ELIGIBLE_KEY);
  } catch (_) {}
}

export function onLatestBuild() {
  return typeof window !== 'undefined' && window.__env === 'staging';
}

async function accessToken() {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  } catch (_) { return null; }
}

async function postJoin(token) {
  try {
    const res = await fetch('/api/ring/join', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      credentials: 'include',
      body: '{}',
    });
    const body = await res.json().catch(() => ({}));
    rememberEligible(body?.eligible === true);
    return body;
  } catch (_) {
    return { ok: false };
  }
}

// Join the ring (used by the RingIndicator's "Switch to latest" button).
export async function ringJoin() {
  const token = await accessToken();
  if (!token) return { ok: false };
  return postJoin(token);
}

// Leave the ring — clear the cookie so the next load is served by prod.
export async function ringLeave() {
  const token = await accessToken();
  try {
    await fetch('/api/ring/leave', {
      method: 'POST',
      headers: token
        ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
        : { 'content-type': 'application/json' },
      credentials: 'include',
      body: '{}',
    });
  } catch (_) {}
}

// Run once on app mount. Eligible + not opted-out ⇒ join and reload onto latest.
export async function maybeAutoJoinRing() {
  if (typeof window === 'undefined') return;
  if (onLatestBuild()) return;            // already on the latest build
  if (ringPref() === 'stable') return;    // user explicitly chose prod
  try { if (sessionStorage.getItem(TRIED_KEY)) return; } catch (_) {}

  const token = await accessToken();
  if (!token) return;                     // not signed in yet — retry on a later mount
  try { sessionStorage.setItem(TRIED_KEY, '1'); } catch (_) {}

  const body = await postJoin(token);
  if (body?.eligible === true) {
    setRingPref('latest');
    window.location.reload();
  }
}
