// bootPlan — which reads a signed-in open can start before the app is there to
// ask for them, decided from what this device remembers about the account.
// lib/bootPrefetch.js acts on it. Pure over an injected Storage, so it runs in
// node (bootPlan.test.mjs).

import { invitedStartWorkspace } from './startWorkspace.js';
import { membershipWorkspaces } from './bootQueries.js';

// App.jsx's keys: `<prefix><uid>.workspace` holds { activeWorkspaceId },
// `<prefix><uid>.<workspaceId>` holds { stack }, and useWorkspace writes
// `<prefix><uid>.personal` = { workspaceId } once it has resolved one.
export const SESSION_PREFIX = 'soleil.boards.session.';

function readJson(storage, key) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

export function rememberedWorkspaces(storage, uid) {
  return {
    activeWs: readJson(storage, `${SESSION_PREFIX}${uid}.workspace`)?.activeWorkspaceId || null,
    personalWs: readJson(storage, `${SESSION_PREFIX}${uid}.personal`)?.workspaceId || null,
  };
}

export function personalKey(uid) {
  return `${SESSION_PREFIX}${uid}.personal`;
}

// The cluster the stack remembers being in, in that workspace.
export function storedTip(storage, uid, workspaceId) {
  const stack = readJson(storage, `${SESSION_PREFIX}${uid}.${workspaceId}`)?.stack;
  return Array.isArray(stack) && stack.length ? stack[stack.length - 1] : null;
}

// The reads to start at sign-in, beside the tier, the memberships and the
// shared clusters, which every open makes:
//   rpc    the personal-workspace RPC, only for an account this device has
//          opened before. For a new one it would create the workspace, and the
//          held setup creates it at its name step, under the name typed there.
//   roots  the root of each workspace it knows: the one it will open, and the
//          personal one, which useWorkspace resolves before anything mounts.
//   list   the clusters of the workspace it will open.
//   tip    the cluster it will land on, when the stack remembers one.
export function bootPlan(storage, uid) {
  const { activeWs, personalWs } = rememberedWorkspaces(storage, uid);
  const open = activeWs || personalWs;
  return {
    rpc: !!open,
    roots: [...new Set([open, personalWs].filter(Boolean))],
    list: open,
    tip: open ? storedTip(storage, uid, open) : null,
  };
}

// Whether this person opens their personal workspace: true or false, or null
// while that cannot be known yet. App.jsx opens the remembered workspace; with
// none, the one a fresh invite put the account in (lib/startWorkspace.js); and
// otherwise the personal one. `members` is the memberships read as
// peekBootSettled gives it.
export function landsInPersonal(storage, user, personalWsId, members) {
  if (!user?.id || !personalWsId) return false;
  const { activeWs } = rememberedWorkspaces(storage, user.id);
  if (activeWs) return activeWs === personalWsId;
  if (!members || members.error || !members.value || members.value.error) return null;
  return !invitedStartWorkspace(membershipWorkspaces(members.value.data), user);
}
