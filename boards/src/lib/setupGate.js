// setupGate.js — who sees the first-run setup, decided before App mounts.
//
// TierRouter asks once the tier has resolved (hooks/useSetupGate.js). Anyone
// who isn't a candidate (workspaceSetup.js isSetupCandidate: the gate is open,
// the account is newer than SETUP_EPOCH and has never been seeded) goes
// straight to the app with no extra read. A candidate is put in an arm of
// workspace_setup (experiments.js) and stamped whichever arm it lands in, so
// arm A's denominator keeps the people who would have left at a step. Arm B
// then reads how far they got (profiles.settings.welcome) and whom they are
// joining, if anyone.
//
// App reads the outcome synchronously (getSetupOutcome) for the tour, the
// first board's copy and the one re-ask, and never fetches it itself.
//
// Pure and node-testable apart from the module cache: no React, no Supabase,
// no import.meta.env.

import { invitedStartWorkspace } from './startWorkspace.js';

// ?setup=A / ?setup=B, the QA override of the arm: setupRule.js, beside the
// question AuthGate asks at sign-in (setupMayOpenFirst), which reads it too.
export { SETUP_OVERRIDE_PARAM, SETUP_OVERRIDE_KEY, readSetupOverride } from './setupRule.js';

// Whom a new account is joining, if anyone: the workspace the sign-in claims
// pointed it at (an email invite, a workspace link or a cluster link all write
// the session slot), or a membership made alongside the account in someone
// else's workspace (a claim on another device). null for someone starting out
// on their own.
//   memberships: [{ id, name, created_by, _joinedAt, _myRole }]
//   slot: { activeWorkspaceId, boardId } from localStorage, either may be null
//   → { kind: 'workspace', workspace } | { kind: 'board', workspaceId, boardId } | null
export function inviteeTarget({ user, memberships, slot } = {}) {
  const uid = user?.id;
  if (!uid) return null;
  const list = Array.isArray(memberships) ? memberships : [];
  const wsId = slot?.activeWorkspaceId || null;
  if (wsId) {
    const m = list.find((w) => w?.id === wsId);
    if (m) {
      if (m.created_by && m.created_by !== uid) return { kind: 'workspace', workspace: m };
    } else if (slot?.boardId) {
      return { kind: 'board', workspaceId: wsId, boardId: slot.boardId };
    }
  }
  const invited = invitedStartWorkspace(list, user);
  return invited ? { kind: 'workspace', workspace: invited } : null;
}

// What the invitee step says about the people already there. `owner` and
// `others` are display names (first names are enough); `role` is the
// membership's. Board guests only know the cluster's name.
export function inviteeCopy({ name, owner, others = [], role, kind } = {}) {
  const what = (name || '').trim();
  const head = what ? `You’re joining ${what}` : 'You’re in';
  const can = role === 'viewer'
    ? 'You can see everything in it'
    : (kind === 'board' ? 'You can add to it and edit it' : 'You can add to and edit everything in it');
  const people = [owner, ...others].filter(Boolean);
  const withWhom = people.length === 0 ? ''
    : people.length === 1 ? `, with ${people[0]}`
      : `, with ${people.slice(0, -1).join(', ')} and ${people[people.length - 1]}`;
  const lead = owner ? `${owner} invited you. ` : '';
  return { head, sub: `${lead}${can}${withWhom}.` };
}

// ── The stamp ───────────────────────────────────────────────────────────────

export const STAMP_MARK_PREFIX = 'soleil.setup.enrolled.';
export const STAMP_TRIES = 3;
export const STAMP_RETRY_MS = 3_000;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// The test is read from the server's record of the arm (set_experiment_arm,
// absent-only), so a stamp that fails is tried again: three times on this
// load, and on the next load if all three fail. supabase-js resolves a failed
// call with { error } instead of rejecting, so success is read from the
// result. The mark that stops a second stamp is written only once the server
// has the arm, and the enrollment is logged then, once.
//   rpc: () => the set_experiment_arm call (a thenable resolving { error })
//   → 'already' | 'stamped' | 'failed'
export async function stampSetupArm({ uid, arm, rpc, storage, log, wait = sleep, tries = STAMP_TRIES } = {}) {
  if (!uid || !arm || typeof rpc !== 'function') return 'failed';
  const mark = `${STAMP_MARK_PREFIX}${uid}`;
  try { if (storage?.getItem(mark) === arm) return 'already'; } catch (_) { /* stamp anyway */ }
  for (let n = 1; n <= tries; n += 1) {
    let ok = false;
    try { ok = !(await rpc())?.error; } catch (_) { ok = false; }
    if (ok) {
      try { storage?.setItem(mark, arm); } catch (_) { /* the server has it either way */ }
      try { log?.(); } catch (_) { /* never in the way */ }
      return 'stamped';
    }
    if (n < tries) await wait(STAMP_RETRY_MS);
  }
  return 'failed';
}

// ── The outcome, for App ────────────────────────────────────────────────────

const EMPTY = { uid: null, arm: null, welcome: null, override: false };
let outcome = EMPTY;

export function rememberSetup(uid, patch = {}) {
  if (!uid) return;
  if (outcome.uid !== uid) outcome = { ...EMPTY, uid };
  outcome = { ...outcome, ...patch, uid };
}

// { arm, welcome, override } for this user, or null when the gate never
// decided for them this page load (not a candidate, or another account).
// override: the arm came from ?setup= and was never stamped.
export function getSetupOutcome(uid) {
  if (!uid || outcome.uid !== uid) return null;
  return { arm: outcome.arm, welcome: outcome.welcome, override: !!outcome.override };
}

export function resetSetupOutcomeForTests() {
  outcome = EMPTY;
}
