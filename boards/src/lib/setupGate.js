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

export const SETUP_OVERRIDE_PARAM = 'setup';
export const SETUP_OVERRIDE_KEY = 'soleil.setup.override';

// ?setup=A or ?setup=B picks the arm for QA on dev and the preview deploy
// (the caller says whether it may), and is remembered for the tab so a reload
// mid-setup stays in it. An override is never stamped: it is not the test.
export function readSetupOverride({ search, storage, allowed } = {}) {
  if (!allowed) return null;
  let v = null;
  try { v = new URLSearchParams(search || '').get(SETUP_OVERRIDE_PARAM); } catch (_) { v = null; }
  v = typeof v === 'string' ? v.trim().toUpperCase() : null;
  if (v === 'A' || v === 'B') {
    try { storage?.setItem(SETUP_OVERRIDE_KEY, v); } catch (_) { /* ignore */ }
    return v;
  }
  try {
    const kept = storage?.getItem(SETUP_OVERRIDE_KEY);
    return kept === 'A' || kept === 'B' ? kept : null;
  } catch (_) { return null; }
}

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
