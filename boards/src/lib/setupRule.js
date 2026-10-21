// setupRule.js — who may see the first-run setup, and in which arm, as far as
// a sign-in can tell: the part of the setup's rules the entry chunk needs.
//
// AuthGate asks setupMayOpenFirst before it starts a new account's workspace
// (lib/bootPrefetch.js bootPrefetchPersonal), long before AppShell, which holds
// the rest of the setup, has arrived. workspaceSetup.js and setupGate.js
// re-export these. They live apart because a module goes whole into one chunk:
// imported from either of those, the entry would carry the whole setup.
//
// Pure and node-testable (setupRule.test.mjs): no React, no Supabase, no
// import.meta.env.

import { assignArm } from './experiments.js';

// Accounts created before this never see the steps, wherever the gate is open.
// A user who already has an `onboarding` record has been in the app either way.
// It is the sidebar release's instant, so an account made before the release
// that never opened the app isn't enrolled on its first open after it, with its
// 7-day window long gone. The test's saved read starts at the same instant.
export const SETUP_EPOCH = '2026-10-22T19:00:00Z';

// Who sees the steps at all. Zero queries: the tier read the app already makes
// carries `onboarding`, and only someone who passes this pays for the reads
// that decide where they resume.
export function isSetupCandidate({ allowed, createdAt, onboarding } = {}) {
  if (!allowed) return false;
  const created = Date.parse(createdAt || '');
  if (!Number.isFinite(created) || created < Date.parse(SETUP_EPOCH)) return false;
  if (onboarding && (onboarding.seeded || onboarding.done)) return false;
  return true;
}

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

// Whether the setup may open before the app for this account, asked at sign-in,
// before the tier can say whether it was ever set up: an account new enough for
// it in arm B, the arm the gate opens on (hooks/useSetupGate.js). Its name step
// makes the workspace under the name typed there, so nothing may make it first.
export function setupMayOpenFirst({ user, allowed, override } = {}) {
  if (!user?.id || !isSetupCandidate({ allowed, createdAt: user.created_at })) return false;
  return (override || assignArm('workspace_setup', user.id)) === 'B';
}
