// bootPrefetch — start the reads a signed-in open needs the moment there is a
// session, instead of one after another as each part of the app mounts.
//
// An open used to run: session → AppShell downloads → get_my_tier → the
// personal-workspace RPC → its root → (Workspace mounts) the cluster list and
// the landing cluster's snapshot. AuthGate now calls startBootPrefetch()
// beside setSession, so all of those that this device can name start at once
// while AppShell is still arriving, and each hook takes its answer from
// lib/bootStore.js on its first call. What it cannot name yet starts as soon as
// it can: useWorkspace calls bootPrefetchLanding() once the RPC and the root
// answer, App.jsx does for a team workspace's root, and the first-run setup's
// last step starts the lot for the workspace it had them name
// (bootPrefetchSetupDone).
//
// The landing snapshot goes through prefetch.js under `board:<id>`, the key
// yboard's cold open already shares an in-flight read on, so the canvas picks
// it up with no code of its own.
//
// A new account's workspace is not in the plan (see bootPlan.js): AuthGate
// starts it straight after, where the first-run setup cannot be the one to
// make it (bootPrefetchPersonal). Every promise here carries a rejection
// handler, so a read that fails costs a head start and never becomes a
// client_errors row; the app makes the read again itself.
//
// Entry-light on purpose: AuthGate imports this, so it reaches only the
// Supabase client and the import-free helpers, never boardsApi (yjs) or r2.

import { supabase } from './supabase.js';
import { prefetch, invalidate } from './prefetch.js';
import {
  tierQuery, personalWorkspaceQuery, membershipsQuery, rootBoardQuery,
  boardListQuery, sharedBoardsQuery, boardStateQuery,
} from './bootQueries.js';
import { putBoot, hasBoot, takeBoot, peekBootSettled, clearBoot } from './bootStore.js';
import { bootPlan, storedTip, landsInPersonal, personalKey } from './bootPlan.js';

let startedFor = null;
let personalFor = null;     // bootPrefetchPersonal's account, once per page like startedFor
const warmed = new Set();   // snapshots put in prefetch.js's cache, dropped on sign-out

function storage() {
  try { return window.localStorage; } catch (_) { return null; }
}

function start(key, uid, build) {
  const promise = Promise.resolve(build());
  promise.then(undefined, () => {});
  putBoot(key, uid, promise);
  return promise;
}

function warmSnapshot(boardId) {
  if (!boardId) return;
  warmed.add(boardId);
  prefetch(`board:${boardId}`, async () => {
    const { data, error } = await boardStateQuery(supabase, boardId);
    if (error) throw error;
    return data?.doc || null;
  }, { lane: 'high', cacheTtl: 30_000 }).then(undefined, () => {});
}

// Once per account per page: the hourly TOKEN_REFRESHED never starts it again.
export function startBootPrefetch(uid) {
  if (!supabase || !uid || startedFor === uid) return;
  startedFor = uid;
  const plan = bootPlan(storage(), uid);
  start('tier', uid, () => tierQuery(supabase));
  start('members', uid, () => membershipsQuery(supabase, uid));
  start('shared', uid, () => sharedBoardsQuery(supabase));
  if (plan.rpc) start('personal', uid, () => personalWorkspaceQuery(supabase, uid));
  for (const ws of plan.roots) start(`root:${ws}`, uid, () => rootBoardQuery(supabase, ws));
  if (plan.list) start(`list:${plan.list}`, uid, () => boardListQuery(supabase, plan.list));
  if (plan.tip) warmSnapshot(plan.tip);
}

export function clearBootPrefetch() {
  startedFor = null;
  personalFor = null;
  clearBoot();
  for (const id of warmed) invalidate(`board:${id}`);
  warmed.clear();
}

// The personal-workspace RPC's answer, when it was started at sign-in:
// { data } (the workspace row) or undefined, and then the caller asks itself.
export async function takeBootPersonal(uid) {
  const t = takeBoot('personal', uid);
  if (!t) return undefined;
  const { data, error } = await t.promise;
  return error || !data?.id ? undefined : data;
}

// A workspace's root, when it was started: the row, null for a workspace with
// no live root (the caller repairs it), or undefined when there is nothing to
// take and the caller should ask. Shared: see takeBoot.
export async function takeBootRoot(uid, workspaceId) {
  const t = takeBoot(`root:${workspaceId}`, uid, Date.now(), { share: true });
  if (!t) return undefined;
  const { data, error } = await t.promise;
  return error ? undefined : ((data && data[0]) || null);
}

// The first answer of a read started under `key`, as a Supabase response
// ({ data, error }), or null.
export function takeBootResponse(key, uid) {
  return takeBoot(key, uid)?.promise || null;
}

// The settled rows of a read under `key` without taking it, for a hook that
// wants its first render to already hold them; null otherwise.
export function peekBootRows(key, uid) {
  const s = peekBootSettled(key, uid);
  if (!s || s.error || !s.value || s.value.error) return null;
  return s.value.data || [];
}

// useWorkspace, once the RPC answered: the list beside the root, when the
// personal workspace is where this person lands and nothing has asked yet.
export function bootPrefetchPersonalList(user, workspaceId) {
  const uid = user?.id;
  if (!supabase || !uid || startedFor !== uid || !workspaceId) return;
  if (hasBoot(`list:${workspaceId}`, uid)) return;
  if (landsInPersonal(storage(), user, workspaceId, peekBootSettled('members', uid)) !== true) return;
  start(`list:${workspaceId}`, uid, () => boardListQuery(supabase, workspaceId));
}

// Once a workspace's root is known: the snapshot of the cluster the person
// lands on, which is the root unless the stack remembers another (and that one
// was warmed at sign-in). `personal` asks whether the personal workspace is
// where they land at all; App.jsx knows it for the workspace it is opening.
export function bootPrefetchLanding(user, workspaceId, rootId, { personal = false } = {}) {
  const uid = user?.id;
  if (!supabase || !uid || startedFor !== uid || !workspaceId || !rootId) return;
  if (personal && landsInPersonal(storage(), user, workspaceId, peekBootSettled('members', uid)) !== true) return;
  const tip = storedTip(storage(), uid, workspaceId);
  if (tip && tip !== rootId) return;
  warmSnapshot(rootId);
}

// AuthGate, straight after startBootPrefetch, for an account this device has
// not opened before (bootPlan left its RPC out) where the first-run setup will
// not open first: the personal-workspace RPC beside get_my_tier rather than
// once the app's code has arrived and mounted, which for a new account makes
// the workspace and its root. Then, as each answer lands, that root, the
// cluster list and the root's snapshot, so useWorkspace and the canvas find
// them all started, or done, when App mounts. The list and the snapshot only
// where the personal workspace is where this person lands. Once per account
// per page: AuthGate's listener hears the hourly token refresh too, long after
// the RPC it started was taken and dropped from the store.
export function bootPrefetchPersonal(user) {
  const uid = user?.id;
  if (!supabase || !uid || startedFor !== uid || personalFor === uid) return;
  personalFor = uid;
  if (hasBoot('personal', uid)) return;
  start('personal', uid, () => personalWorkspaceQuery(supabase, uid)).then(({ data: ws, error }) => {
    if (error || !ws?.id || startedFor !== uid) return;
    bootPrefetchPersonalList(user, ws.id);
    if (hasBoot(`root:${ws.id}`, uid)) return;
    start(`root:${ws.id}`, uid, () => rootBoardQuery(supabase, ws.id)).then(({ data, error: rootError }) => {
      const root = !rootError && data && data[0];
      if (root?.id) bootPrefetchLanding(user, ws.id, root.id, { personal: true });
    }, () => {});
  }, () => {});
}

// The first-run setup's last step (components/setup/WorkspaceSetup.jsx), for
// someone who lands in the workspace it had them name: what the app opens
// with, so "Open {ws}" lands on a painted canvas rather than on one read after
// another. The name step made the workspace, so the RPC is a read by now. The
// memberships go too: App waits on them for an account with no workspace
// remembered. Fresh reads, not the sign-in's, which the steps outlast; called
// again at "Open", it starts only what has gone stale since.
export function bootPrefetchSetupDone(user, workspaceId) {
  const uid = user?.id;
  if (!supabase || !uid || startedFor !== uid || !workspaceId) return;
  const fresh = (key, build) => { if (!hasBoot(key, uid)) start(key, uid, build); };
  fresh('personal', () => personalWorkspaceQuery(supabase, uid));
  fresh('members', () => membershipsQuery(supabase, uid));
  fresh(`list:${workspaceId}`, () => boardListQuery(supabase, workspaceId));
  const rootId = peekBootSettled(`root:${workspaceId}`, uid)?.value?.data?.[0]?.id;
  if (rootId) bootPrefetchLanding(user, workspaceId, rootId);
  else if (!hasBoot(`root:${workspaceId}`, uid)) {
    start(`root:${workspaceId}`, uid, () => rootBoardQuery(supabase, workspaceId)).then(({ data, error }) => {
      const root = !error && data && data[0];
      if (root?.id) bootPrefetchLanding(user, workspaceId, root.id);
    }, () => {});
  }
}

// useWorkspace's note of which workspace is this account's own, so the next
// open on this device can start the RPC and that root at sign-in.
export function rememberPersonalWorkspace(uid, workspaceId) {
  if (!uid || !workspaceId) return;
  try { storage()?.setItem(personalKey(uid), JSON.stringify({ workspaceId })); } catch (_) {}
}
