// experiments.js — a minimal, dependency-free A/B harness for onboarding/first-
// card variants. It mirrors the first_source machinery: assignment is a pure,
// SYNCHRONOUS, deterministic hash of (userId, key) so it never delays the seed
// render or needs a server round-trip, and the assigned arm rides every analytics
// event (exp_<key>) and is stamped once into profiles.settings.experiments so the
// server-side retention RPC can GROUP BY arm.
//
// Assignment is deterministic, so the client never needs the server to echo the
// arm back (no get_my_tier change): assignArm always recomputes the same arm for
// a given user while weights are fixed. Disabling an experiment (enabled:false)
// makes assignArm return null everywhere — a clean code-level kill switch.
//
// Variant COPY/LAYOUT lives in the bundle (the variant tables below) because the
// rendering components need it synchronously; the registry only decides WHICH arm
// a user is in. Keep this pure (no React/Supabase imports) so it stays trivially
// testable and safe to import from analytics.js, App.jsx, and admin alike.

// ── Registry ────────────────────────────────────────────────────────────────
// Each experiment: { enabled, arms:[{id, weight}] }. Arm 'A' is ALWAYS the
// control = current production behavior, so a variant table that omits 'A' (or an
// assignArm() of null) renders exactly what shipped before — zero regression.
export const EXPERIMENTS = {
  // v1: does sharper, action-first coachmark copy lift first-card activation?
  coachmark_copy: {
    enabled: true,
    arms: [
      { id: 'A', weight: 50 }, // control — the current copy
      { id: 'B', weight: 50 }, // variant — see COACHMARK_VARIANTS.B
    ],
  },
};

// ── Deterministic assignment ─────────────────────────────────────────────────
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

// Stable per (user, experiment); returns the arm id, or null if the experiment is
// unknown/disabled or no user id is available.
export function assignArm(key, userId) {
  const exp = EXPERIMENTS[key];
  if (!exp || !exp.enabled || !userId) return null;
  const arms = exp.arms || [];
  const total = arms.reduce((s, a) => s + (a.weight || 0), 0);
  if (total <= 0) return null;
  const r = (cyrb53(`${userId}:${key}`) / 9007199254740992) * total; // /2^53 → [0,total)
  let acc = 0;
  for (const a of arms) { acc += a.weight || 0; if (r < acc) return a.id; }
  return arms[arms.length - 1].id;
}

export function getActiveExperiments() {
  return Object.keys(EXPERIMENTS).filter((k) => EXPERIMENTS[k]?.enabled);
}

// { exp_<key>: arm } for every active experiment the user is enrolled in — the
// exact shape analytics.js merges onto every event (mirrors first_source keys).
export function getAssignedArms(userId) {
  const out = {};
  for (const key of getActiveExperiments()) {
    const arm = assignArm(key, userId);
    if (arm) out[`exp_${key}`] = arm;
  }
  return out;
}

// ── Variant content tables ───────────────────────────────────────────────────
// Keyed by arm id. A null/missing entry (e.g. arm 'A' or a disabled experiment)
// means "use the component's existing default copy" — no regression.
export const COACHMARK_VARIANTS = {
  A: null,
  B: {
    title: 'Add your first card',
    // Mirrors the component's three copy branches (tutorial / touch / desktop).
    hasTutorial: 'Drag the note into the “Ideas” board — that’s how you organize ✨',
    touch: 'Tap the + on the left (or long-press the canvas) to drop your first card.',
    desktop: 'Double-click the canvas — or right-click → Add — to drop your first card.',
  },
};
