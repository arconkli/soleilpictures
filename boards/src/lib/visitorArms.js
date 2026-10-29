// visitorArms.js — the experiment arms of a SIGNED-OUT visitor, per device.
//
// The user-id experiments (experiments.js assignArm) need an account; a test
// shown before sign-up has none. A visitor experiment (audience: 'visitor')
// hashes the device id instead — analytics.js's soleil_session_id, minted once,
// never rotated, and carried on every event, which is what later stitches the
// visitor to the account they create. So the same device gets the same arm on
// every page and every visit.
//
// A device is enrolled the first time it renders a page that runs the test
// (visitorEnroll.js, loaded only by those pages), and only then: its arm is
// kept under soleil_visitor_arms and rides its signed-out events as exp_<key>
// (visitorArmProps, read by analytics.js). When a NEW account signs in on an
// enrolled device, analytics.js stamps the device's arm onto it
// (set_experiment_arm), so the server's per-arm reads agree.
//
// This half is in every page's first load (analytics.js), so it only reads.
// Pure, with storage injected, so it runs under node (visitorArms.test.mjs).

import { EXPERIMENTS } from './experiments.js';

export const VISITOR_ARMS_KEY = 'soleil_visitor_arms';

// The arm stored for each live visitor experiment, junk left out.
export function readVisitorArms(storage) {
  const out = {};
  try {
    const m = JSON.parse(storage?.getItem(VISITOR_ARMS_KEY) || 'null');
    for (const key in m) {
      const exp = EXPERIMENTS[key];
      if (exp?.enabled && exp.audience === 'visitor' && exp.arms.some((a) => a.id === m[key])) out[key] = m[key];
    }
  } catch (_) {}
  return out;
}

// The owner's own look at the box: ?preview=signupbox shows arm B to anyone,
// signed in or not, without enrolling the device (useSignupBoxArm), and
// analytics.js marks that page's events synthetic, so the 0230 divert keeps a
// preview out of the read. Takes the query string; the page's by default.
export function isBoxPreview(search) {
  try { return new URLSearchParams(search ?? window.location.search).get('preview') === 'signupbox'; } catch (_) { return false; }
}

// What rides this device's signed-out events: { exp_<key>: arm }.
export function visitorArmProps(storage) {
  const m = readVisitorArms(storage), out = {};
  for (const key in m) out[`exp_${key}`] = m[key];
  return out;
}
