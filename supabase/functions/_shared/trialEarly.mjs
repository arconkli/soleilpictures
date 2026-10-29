// trialEarly — the server's twin of the `trial_early` entry in
// boards/src/lib/experiments.js.
//
// Plain ESM JavaScript, no Deno APIs, no imports, so the SAME file runs in the
// Deno edge bundle and under the repo's `node --test` gate. The edge function
// (create-checkout-session) decides the arm itself, from the user id on the
// caller's JWT, with the same hash the client uses — so a client cannot claim
// arm B by saying so. Arm B is offered the Creator trial from the first
// server-counted card (trialCore.creatorTrialEligibility `early`); arm A is
// today's rule.
//
// boards/src/lib/trialEarly.test.mjs holds the two sides equal: the key, the
// arms and weights, the on/off switch, and the pick for thousands of ids.

export const TRIAL_EARLY_KEY = 'trial_early';

// Flip together with EXPERIMENTS.trial_early.enabled; the test enforces it.
export const TRIAL_EARLY_ON = false;

export const TRIAL_EARLY_ARMS = [{ id: 'A', weight: 50 }, { id: 'B', weight: 50 }];

// cyrb53: a fast, well-distributed 53-bit string hash (good arm balance on small
// N, unlike a naive char-sum). Seeded by the key so two experiments don't put the
// same user in correlated arms.
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0); // 0 .. 2^53-1
}

// The pick with no switch: the same math as experiments.js assignArm. Null for
// a missing user id.
export function trialEarlyPick(userId) {
  if (!userId) return null;
  const arms = TRIAL_EARLY_ARMS;
  const total = arms.reduce((s, a) => s + (a.weight || 0), 0);
  if (total <= 0) return null;
  const r = (cyrb53(`${userId}:${TRIAL_EARLY_KEY}`) / 9007199254740992) * total; // /2^53 → [0,total)
  let acc = 0;
  for (const a of arms) { acc += a.weight || 0; if (r < acc) return a.id; }
  return arms[arms.length - 1].id;
}

// The arm the edge acts on: null while the test is off, so nobody is in B.
export function trialEarlyArm(userId) {
  return TRIAL_EARLY_ON && userId ? trialEarlyPick(userId) : null;
}
