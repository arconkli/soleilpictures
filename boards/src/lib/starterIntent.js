// starterIntent — "start me with a treatment", carried across sign-in.
//
// A page that promises a starting document (starterDocs.js) writes the request
// here when its button is pressed, and the signed-in app reads it back and
// writes the document onto the cluster that opens (useStarterIntentResume).
// localStorage rather than a URL parameter for the reason creatorIntent.js
// gives: the sign-in link redirects to the bare origin, so a query string would
// not survive it. Same day-long lifetime, same namespace, same-device only.
//
// Pure, DOM-free except for the storage it is handed.

import { isStarterKind } from './starterSections.js';

export const STARTER_INTENT_KEY = 'soleil.boards.pending.starter';
export const STARTER_INTENT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function store(storage) {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
}

export function stashStarterIntent({ kind, from = null, now = Date.now() } = {}, storage) {
  const s = store(storage);
  if (!s || !isStarterKind(kind)) return false;
  try {
    s.setItem(STARTER_INTENT_KEY, JSON.stringify({ kind, from: from ? String(from).slice(0, 80) : null, at: now }));
    return true;
  } catch (_) {
    return false;
  }
}

// The request, or null. An expired, malformed or unknown one is removed on
// read, so it cannot linger.
export function readStarterIntent({ now = Date.now(), maxAgeMs = STARTER_INTENT_MAX_AGE_MS } = {}, storage) {
  const s = store(storage);
  if (!s) return null;
  let raw = null;
  try { raw = s.getItem(STARTER_INTENT_KEY); } catch (_) { return null; }
  if (!raw) return null;
  let v = null;
  try { v = JSON.parse(raw); } catch (_) { v = null; }
  const at = Number(v?.at);
  const valid = v && v.at !== null && v.at !== undefined && Number.isFinite(at) && isStarterKind(v.kind);
  const age = valid ? now - at : Infinity;
  if (!valid || age < 0 || age > maxAgeMs) {
    clearStarterIntent(s);
    return null;
  }
  return { kind: v.kind, from: typeof v.from === 'string' ? v.from : null, ageMs: age };
}

export function clearStarterIntent(storage) {
  const s = store(storage);
  if (!s) return;
  try { s.removeItem(STARTER_INTENT_KEY); } catch (_) { /* nothing to clear */ }
}
