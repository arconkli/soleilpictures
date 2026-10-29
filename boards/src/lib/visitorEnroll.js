// visitorEnroll.js — puts this device in a visitor experiment (experiments.js
// audience 'visitor') the first time it renders a page that runs one, and
// returns its arm. Imported only by those pages (hooks/useSignupBoxArm.js), so
// no other page's first load carries it; the read half that every signed-out
// event needs is visitorArms.js.
//
// Never enrolled, so they see the control: crawlers and headless browsers,
// anyone with a stored session (they already have an account), a browser with
// no storage, and every visit before the experiment's startsAt. A stored arm is
// kept for good, so a device sees one arm on every page and every visit.
//
// Pure, with storage injected, so it runs under node (visitorArms.test.mjs).

import { EXPERIMENTS, pickArm } from './experiments.js';
import { VISITOR_ARMS_KEY, readVisitorArms } from './visitorArms.js';

// Stable per (device, visitor experiment), from its startsAt on; null before it,
// for a user-id experiment, a disabled one, or no device id. (Here rather than
// in experiments.js, which every first load carries.)
export function assignVisitorArm(key, deviceId, now = Date.now()) {
  const exp = EXPERIMENTS[key];
  if (!exp || !exp.enabled || exp.audience !== 'visitor' || !deviceId) return null;
  const start = exp.startsAt ? Date.parse(exp.startsAt) : 0;
  if (!(now >= start)) return null;
  return pickArm(exp.arms || [], `${deviceId}:${key}`);
}

// A signed-in session in storage: supabase-js keeps it under sb-<ref>-auth-token
// (and the admin's view-as tabs under sb-auth-as-<id>). The -code-verifier key
// it leaves while a code is out is not a session. A storage that cannot be read
// counts as signed in, which keeps the device out.
export function hasStoredSession(storage) {
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i) || '';
      if (k.startsWith('sb-') && k.includes('auth') && !k.endsWith('-code-verifier')) return true;
    }
    return false;
  } catch (_) { return true; }
}

export function enrollVisitor(storage, key, { deviceId, bot = false, now = Date.now() } = {}) {
  const exp = EXPERIMENTS[key];
  if (!exp?.enabled || exp.audience !== 'visitor' || bot || !storage || hasStoredSession(storage)) return null;
  const have = readVisitorArms(storage);
  if (have[key]) return have[key];
  const arm = assignVisitorArm(key, deviceId, now);
  if (!arm) return null;
  try { storage.setItem(VISITOR_ARMS_KEY, JSON.stringify({ ...have, [key]: arm })); } catch (_) { return null; }
  return arm;
}
