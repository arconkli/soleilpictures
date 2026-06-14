// frictionSignal — detects when a brand-new user is STUCK placing their first
// card, so onboarding can passively escalate the existing hint/coachmark and the
// admin First-Card Friction view gets a `card_create_stuck` signal.
//
// This is the other half of activation instrumentation: card_placed only fires
// on SUCCESS, so a user who tries and fails (the 6+ silent canvas dead-ends, or
// just can't find an affordance) is invisible. recordIntent(method) is called at
// every "I want to make a card" gesture; this module decides — purely — whether
// the pattern of intents-without-a-genuine-card looks stuck (rage-clicks, or a
// timeout with no result) and calls back once.
//
// Kept dependency-light on purpose (only the pure genuine-vs-seed test from
// firstValueTrigger.js, NEVER analytics.js) so the decision core is unit-testable
// in plain node — see frictionSignal.test.mjs. The caller (App.jsx) owns the side
// effects: it provides onStuck, which logs EV.CARD_CREATE_STUCK and flips the
// passive-escalation state. Scoping (only run for onboarding/demo users with no
// genuine card, and stop() the instant the first genuine card lands) lives in the
// App.jsx start/stop call so established/power users are never escalated.

import { hasGenuineCard } from './firstValueTrigger.js';

// Tunable thresholds — see the plan's "Tunable defaults". 12s timeout is well
// under the cited ~44s median bounce; rage = 3 intents inside 1.5s.
export const STUCK_TIMEOUT_MS = 12000;
export const RAGE_WINDOW_MS   = 1500;
export const RAGE_COUNT       = 3;
const MAX_INTENTS = 24;        // bound the buffer; rage will have fired long before this

// Pure decision core. Given the intent timestamps (ms, ascending), the current
// time, and whether a genuine card already exists, decide if the user is stuck
// and why. No clock, no timers, no I/O — exhaustively unit-tested.
//   reason: 'rage'    — >= rageCount intents within a rageWindowMs sliding window
//           'timeout' — the FIRST intent is >= timeoutMs old and still no card
export function evaluateStuck({
  intents = [],
  now,
  hasGenuine = false,
  timeoutMs = STUCK_TIMEOUT_MS,
  rageWindowMs = RAGE_WINDOW_MS,
  rageCount = RAGE_COUNT,
}) {
  if (hasGenuine) return { stuck: false, reason: null };
  if (!Array.isArray(intents) || intents.length === 0) return { stuck: false, reason: null };
  const recent = intents.filter((t) => now - t <= rageWindowMs);
  if (recent.length >= rageCount) return { stuck: true, reason: 'rage' };
  if (now - intents[0] >= timeoutMs) return { stuck: true, reason: 'timeout' };
  return { stuck: false, reason: null };
}

// ── Stateful session layer (one active session at a time) ──────────────────
let S = null;

function defaultClock() { return Date.now(); }

// Begin tracking. getCards()=>live card array; onStuck(payload) fires at most
// once per session. clock is injectable for tests. Calling start() again (or
// stop()) clears any prior session + pending timer.
export function start({
  getCards = null,
  onStuck = null,
  clock = defaultClock,
  timeoutMs = STUCK_TIMEOUT_MS,
  rageWindowMs = RAGE_WINDOW_MS,
  rageCount = RAGE_COUNT,
} = {}) {
  stop();
  S = { getCards, onStuck, clock, timeoutMs, rageWindowMs, rageCount, intents: [], fired: false, timer: null };
}

export function stop() {
  if (S && S.timer) { try { clearTimeout(S.timer); } catch (_) {} }
  S = null;
}

export function isRunning() { return !!S; }

function genuineNow() {
  try { return S && S.getCards ? hasGenuineCard(S.getCards()) : false; } catch (_) { return false; }
}

// Record a "make a card" gesture. No-op unless a session is active and unfired.
export function recordIntent(method) {
  if (!S || S.fired) return;
  if (genuineNow()) { stop(); return; }            // already activated → never escalate
  const now = S.clock();
  S.intents.push({ method, t: now });
  if (S.intents.length > MAX_INTENTS) S.intents.splice(0, S.intents.length - MAX_INTENTS);
  evaluateNow(method);                              // rage can fire synchronously on the 3rd intent
  schedule();                                       // and arm the timeout check
}

// Re-evaluate against the current clock; fires onStuck at most once. Exposed for
// tests; production also calls it from the scheduled timeout timer.
export function evaluateNow(methodLast = null) {
  if (!S || S.fired) return;
  if (genuineNow()) { stop(); return; }
  const now = S.clock();
  const ts = S.intents.map((it) => it.t);
  const { stuck, reason } = evaluateStuck({
    intents: ts, now, hasGenuine: false,
    timeoutMs: S.timeoutMs, rageWindowMs: S.rageWindowMs, rageCount: S.rageCount,
  });
  if (!stuck) return;
  S.fired = true;
  if (S.timer) { try { clearTimeout(S.timer); } catch (_) {} S.timer = null; }
  const oldest = ts.length ? ts[0] : now;
  const last = methodLast || (S.intents.length ? S.intents[S.intents.length - 1].method : null);
  const payload = {
    reason,
    intents: ts.length,
    seconds: Math.round((now - oldest) / 100) / 10,
    method_last: last,
  };
  try { S.onStuck && S.onStuck(payload); } catch (_) {}
}

function schedule() {
  if (!S || S.fired || S.intents.length === 0) return;
  if (S.timer) { try { clearTimeout(S.timer); } catch (_) {} }
  const now = S.clock();
  const oldest = S.intents[0].t;
  const delay = Math.max(0, S.timeoutMs - (now - oldest)) + 25;
  S.timer = setTimeout(() => { if (S) S.timer = null; evaluateNow(); }, delay);
}
