// Reconnect backoff with jitter — pure + dependency-injected (rng) so it
// unit-tests straight in the Playwright node process (no sockets, no clock).
//
// Why this exists: y-partykit's board provider and partysocket both reconnect
// on a deterministic exponential schedule with NO jitter. So when a worker
// deploy or a board /reset closes EVERY socket at once, all N clients retry in
// lockstep — a synchronized thundering herd, and each retry re-runs
// onBeforeConnect's two Supabase round-trips (party/auth.ts) against the known
// auth-lock contention (perf journey R22). Spreading the retries across a
// window turns the herd into a smear. Window knobs live in presenceTuning.js.

import { PRESENCE_TUNING } from './presenceTuning.js';

// Full-jitter delay (ms) within [minMs, maxMs]. Used to stagger a mass
// simultaneous reconnect (deploy / reset) so attempts don't all land together.
// rng is injectable so the logic spec is deterministic.
export function spreadDelayMs({
  rng = Math.random,
  minMs = PRESENCE_TUNING.RECONNECT_JITTER_MIN_MS,
  maxMs = PRESENCE_TUNING.RECONNECT_JITTER_MAX_MS,
} = {}) {
  const lo = Math.max(0, Math.min(minMs, maxMs));
  const hi = Math.max(lo, maxMs);
  const r = clamp01(rng());
  return Math.round(lo + r * (hi - lo));
}

// Exponential backoff with full jitter for repeated failed attempts.
// `attempt` is 0-based. The uncapped ceiling is baseMs * 2^attempt, clamped to
// capMs; the returned delay is uniformly random in [0, ceiling] (AWS "full
// jitter"). At attempt 0 this is already spread across [0, baseMs], so the very
// first synchronized retry — where the herd hurts most — is de-correlated.
export function backoffWithJitter(attempt, {
  rng = Math.random,
  baseMs = PRESENCE_TUNING.RECONNECT_JITTER_MIN_MS,
  capMs = PRESENCE_TUNING.RECONNECT_JITTER_MAX_MS,
} = {}) {
  const a = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  // 2^a can overflow for absurd a; Math.min collapses Infinity to capMs.
  const ceiling = Math.min(capMs, baseMs * Math.pow(2, a));
  return Math.round(clamp01(rng()) * ceiling);
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
