// trialEarly — the client's side of the `trial_early` test: arm B is offered
// the Creator trial from its first server-counted card instead of from 13.
//
// Pure: no React, no Supabase. The arm is a hash of the user id
// (experiments.js), the server decides the same arm itself at checkout
// (supabase/functions/_shared/trialEarly.mjs), and trialEarly.test.mjs holds
// the two equal.
import { assignArm } from './experiments.js';

export const TRIAL_EARLY_KEY = 'trial_early';

// 'A' | 'B' | null (null while the test is off or without a user id).
export function trialEarlyArm(userId) {
  return assignArm(TRIAL_EARLY_KEY, userId);
}

export function trialEarlyOn(userId) {
  return trialEarlyArm(userId) === 'B';
}

export const TRIAL_EARLY_MARK_PREFIX = 'soleil.trialEarly.enrolled.';

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Same contract as setupGate.stampSetupArm; fold into that helper once it
// takes a mark prefix (the first_board_more task is generalising it).
// The server's record of the arm (set_experiment_arm, absent-only) is stamped
// with three tries, 3,000 ms apart; supabase-js resolves a failed call with
// { error } instead of rejecting, so success is read from the result. The mark
// that stops a second stamp is written only once the server has the arm, and
// the enrollment is logged then, once.
//   rpc: () => the set_experiment_arm call (a thenable resolving { error })
//   → 'already' | 'stamped' | 'failed'
export async function stampTrialEarlyArm({ uid, arm, rpc, storage, log, wait = sleep, tries = 3 } = {}) {
  if (!uid || !arm || typeof rpc !== 'function') return 'failed';
  const mark = `${TRIAL_EARLY_MARK_PREFIX}${uid}`;
  try { if (storage?.getItem(mark) === arm) return 'already'; } catch (_) { /* stamp anyway */ }
  for (let n = 1; n <= tries; n += 1) {
    let ok = false;
    try { ok = !(await rpc())?.error; } catch (_) { ok = false; }
    if (ok) {
      try { storage?.setItem(mark, arm); } catch (_) { /* the server has it either way */ }
      try { log?.(); } catch (_) { /* never in the way */ }
      return 'stamped';
    }
    if (n < tries) await wait(3_000);
  }
  return 'failed';
}
