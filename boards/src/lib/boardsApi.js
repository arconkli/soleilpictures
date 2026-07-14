// CRUD over the `workspaces`, `workspace_members`, `boards` and `board_state`
// tables. Pure functions over the Supabase client — no React.

import * as Y from 'yjs';
import { supabase } from './supabase.js';
import { bytesToB64, b64ToBytes } from './yhelpers.js';
import * as perf from './perf.js';
import { cardWeight } from './gridCount.js';
import { resolveTagText } from './gridSequence.js';
import { schedItems, schedLegacyRows } from './schedLayout.js';

const PARTYKIT_HOST = import.meta.env?.VITE_PARTYKIT_HOST || 'localhost:1999';

// ── Workspaces ──────────────────────────────────────────────────────────────

// Returns the user's first workspace (created_at asc) or null if none.
// Read-only — useful for "do they have one?" checks. Bootstrap should use
// `getOrCreatePersonalWorkspace` instead so two simultaneous mounts can't
// race-create a duplicate.
export async function getMyFirstWorkspace() {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('workspace_id, workspaces(*)')
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0].workspaces;
}

// Atomic bootstrap — calls a Postgres function that takes a per-user
// advisory lock, returns the user's oldest workspace if one exists, or
// otherwise creates {workspace + member + Studio root} in a single
// transaction. Replaces the prior racy two-step that produced duplicate
// personal workspaces on first sign-in.
// Returns the workspaces row (back-compat shape). Internally the
// RPC also guarantees a root board + empty board_state exist, so
// callers no longer need a JS-side createBoard fallback (which used
// to hit RLS in some sessions).
// NOTE: default name used to be 'Soleil' which made the personal
// workspace look like a brand placeholder. 'Personal Workspace' is
// clearer for first-time users; pre-existing workspaces keep whatever
// name they already have.
export async function getOrCreatePersonalWorkspace({ userId, name = 'Personal Workspace' }) {
  const { data, error } = await supabase
    .rpc('get_or_create_personal_workspace', { p_user_id: userId, p_name: name });
  if (error) throw error;
  return data;
}

// Create a workspace + add the caller as a member, all in two writes.
// Used for explicit user-initiated "new workspace" actions, not for
// bootstrap (use getOrCreatePersonalWorkspace).
// Create a fresh shared workspace + its root board atomically.
//
// Previously this was three sequential REST calls (workspaces insert,
// workspace_members insert, boards insert) which intermittently lost
// the RLS race: the boards INSERT requires is_workspace_member, and
// in some sessions PostgREST evaluated the policy before the
// workspace_members row was visible to the policy's read pass.
//
// The create_workspace_with_root RPC (security definer) does all the
// inserts inside one transaction so there's no half-state and the
// is_workspace_member check sees the new row.
export async function createWorkspace({ name, userId, rootName = 'Studio' }) {
  const { data, error } = await supabase.rpc('create_workspace_with_root', {
    p_name: name || 'Workspace',
    p_root_name: rootName || 'Studio',
  });
  if (error) throw error;
  const wsId = data?.workspace_id;
  if (!wsId) throw new Error('create_workspace_with_root returned no id');
  // Hydrate the workspaces row so callers receive the same shape they
  // got from the old insert().select() flow.
  const ws = await supabase.from('workspaces').select('*').eq('id', wsId).maybeSingle();
  if (ws.error) throw ws.error;
  return ws.data;
}

// Delete a workspace + all its content. Only the workspace owner
// (created_by) can delete; non-owners get a permission error and should
// use leaveWorkspace instead.
export async function deleteWorkspace(workspaceId) {
  const { error } = await supabase
    .rpc('delete_workspace', { p_workspace_id: workspaceId });
  if (error) throw error;
}

// Drop the caller's membership of a shared workspace. Owners can't leave
// (the RPC errors) — they should delete the workspace if they want it gone.
export async function leaveWorkspace(workspaceId) {
  const { error } = await supabase
    .rpc('leave_workspace', { p_workspace_id: workspaceId });
  if (error) throw error;
}

// Rename a workspace. Only the owner can rename (RLS enforces created_by).
export async function renameWorkspace(workspaceId, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Workspace name is required');
  const { error } = await supabase
    .from('workspaces')
    .update({ name: trimmed })
    .eq('id', workspaceId);
  if (error) throw error;
}

// Read the workspace settings jsonb. Returns {} when none set.
// Members can read; the SELECT policy already covers it.
export async function getWorkspaceSettings(workspaceId) {
  if (!workspaceId) return {};
  const { data, error } = await supabase
    .from('workspaces')
    .select('settings')
    .eq('id', workspaceId)
    .maybeSingle();
  if (error) throw error;
  return (data?.settings && typeof data.settings === 'object') ? data.settings : {};
}

// Atomic merge-patch into workspaces.settings. Editors AND owners can
// write — the RPC enforces. `patch` is a top-level object whose keys
// overwrite their counterparts in settings; missing keys preserve.
export async function updateWorkspaceSettings(workspaceId, patch) {
  if (!workspaceId) throw new Error('workspaceId required');
  const { data, error } = await supabase.rpc('merge_workspace_settings', {
    p_workspace_id: workspaceId,
    p_patch: patch || {},
  });
  if (error) throw error;
  return (data && typeof data === 'object') ? data : {};
}

// Caller's role on this workspace. 'editor' | 'owner' | 'viewer' | null
// (null when not a member). Used by the SettingsPanel to gate the
// workspace-defaults editor for viewers.
export async function getMyWorkspaceRole(workspaceId) {
  if (!workspaceId) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  return data?.role || null;
}

// Fetch the caller's own profile (name + color + avatar + settings).
// Returns null if no row exists yet — callers should fall back to
// email-derived defaults and {} settings.
//
// MUST filter by auth.uid() explicitly. The profiles table has TWO
// permissive SELECT policies — `self read profile` (user_id = auth.uid())
// and `ws-mate read profile` (workspace mates can read each other's
// profiles). With no row of your own and a workspace mate who DOES have
// a row, an unfiltered `.maybeSingle()` happily returned the workspace
// mate's row as if it were yours, which then propagated into userInfo
// (name + color) and out through workspace presence — every collaborator
// ended up sharing the same identity in the UI.
export async function getOwnProfile() {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, display_name, color, avatar_url, settings, updated_at')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Referral: mint (or fetch) the caller's personal invite code. The code is a
// short, URL-safe handle that goes in the shareable ?ref=<code> link. The RPC
// is idempotent — first call mints, later calls return the same code.
export async function getOrCreateMyReferralCode() {
  const { data, error } = await supabase.rpc('get_or_create_my_referral_code');
  if (error) throw error;
  return data || null;
}

// Referral: the caller's invite stats for the "Invite & earn" tab. Always
// returns one row (zeros when no referrals yet). friendsPaid/monthsEarned are
// the conversion-gated paid reward (migration 0167): a referee who upgrades to a
// paid plan earns the referrer a free Creator month.
export async function getMyReferralStats() {
  const { data, error } = await supabase.rpc('get_my_referral_stats');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    code:              row?.code || null,
    friendsJoined:     Number(row?.friends_joined ?? 0),
    friendsActivated:  Number(row?.friends_activated ?? 0),
    pending:           Number(row?.pending ?? 0),
    cardsEarned:       Number(row?.cards_earned ?? 0),
    friendsPaid:       Number(row?.friends_paid ?? 0),
    monthsEarned:      Number(row?.months_earned ?? 0),
  };
}

// Atomic merge-patch into the caller's profile.settings. The RPC
// upserts the row if needed, then merges top-level keys.
export async function updateOwnSettings(patch) {
  const { data, error } = await supabase.rpc('merge_profile_settings', {
    p_patch: patch || {},
  });
  if (error) throw error;
  return (data && typeof data === 'object') ? data : {};
}

// Upsert the caller's profile. Pass only the fields you want to write.
export async function saveOwnProfile({ userId, displayName, color, avatarUrl }) {
  if (!userId) throw new Error('userId required');
  const row = { user_id: userId };
  if (displayName !== undefined) row.display_name = displayName?.trim() || null;
  if (color !== undefined)       row.color = color || null;
  if (avatarUrl !== undefined)   row.avatar_url = avatarUrl || null;
  const { error } = await supabase
    .from('profiles')
    .upsert(row, { onConflict: 'user_id' });
  if (error) throw error;
}

// Read profiles for the given user ids — workspace-mate RLS lets you read
// any profile of someone in a shared workspace. Returns a Map<uid,row>.
export async function getProfilesByIds(userIds) {
  if (!userIds || userIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, display_name, color, avatar_url')
    .in('user_id', userIds);
  if (error) throw error;
  const m = new Map();
  (data || []).forEach(p => m.set(p.user_id, p));
  return m;
}

// Members of a workspace. Used for the sidebar member-dot stack and the
// "Nx" badge on shared workspaces in the rail. RLS already restricts
// the caller to workspaces they themselves are a member of.
export async function listWorkspaceMembers(workspaceId) {
  if (!workspaceId) return [];
  const { data, error } = await supabase
    .from('workspace_members')
    .select('user_id, role, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Owner-only: remove a workspace member by user id. Self-removal goes
// through leaveWorkspace; this is for kicking someone else.
export async function removeWorkspaceMember({ workspaceId, userId }) {
  const { error } = await supabase
    .rpc('remove_workspace_member', {
      p_workspace_id: workspaceId,
      p_user_id: userId,
    });
  if (error) throw error;
}

// Owner-only: hand off the workspace to another existing member.
// New owner is bumped to role='owner'; previous owner is demoted to
// role='editor'. After this, the previous owner can leaveWorkspace().
export async function transferWorkspaceOwnership({ workspaceId, newOwnerId }) {
  const { error } = await supabase
    .rpc('transfer_workspace_ownership', {
      p_workspace_id: workspaceId,
      p_new_owner: newOwnerId,
    });
  if (error) throw error;
}

// ── Per-board sharing ──────────────────────────────────────────────────
// Workspace members keep full access; per-board shares grant view-only
// or editor access to non-members for one board (and its descendants).

// Owner-only. Looks up the recipient by email + upserts the share row.
// If the email has no account, share_board upserts a pending_invites row
// and returns 'pending' instead of 'granted' (no exception). Callers can
// use the return value to surface a "pending signup" indicator.
export async function shareBoard({ boardId, email, role }) {
  const { data, error } = await supabase
    .rpc('share_board', {
      p_board_id: boardId,
      p_email: email,
      p_role: role,
    });
  if (error) throw error;
  return data || 'granted';  // 'granted' | 'pending'
}

// Owner-only. Same shape as shareBoard but for workspace-level invites.
// Returns 'granted' | 'pending' | 'already_member'. Replaces the prior
// client-side user_id_by_email + workspace_members insert dance.
export async function inviteWorkspaceMember({ workspaceId, email, role = 'editor' }) {
  const { data, error } = await supabase
    .rpc('invite_workspace_member', {
      p_workspace_id: workspaceId,
      p_email: email,
      p_role: role,
    });
  if (error) throw error;
  return data || 'granted';
}

// Pending invites (the rows ShareModal renders as "Pending signup").

export async function listPendingInvitesForBoard(boardId) {
  if (!boardId) return [];
  const { data, error } = await supabase
    .rpc('list_pending_invites_for_board', { p_board_id: boardId });
  if (error) throw error;
  return data || [];
}

export async function listPendingInvitesForWorkspace(workspaceId) {
  if (!workspaceId) return [];
  const { data, error } = await supabase
    .rpc('list_pending_invites_for_workspace', { p_workspace_id: workspaceId });
  if (error) throw error;
  return data || [];
}

export async function revokePendingInvite(id) {
  const { error } = await supabase
    .rpc('revoke_pending_invite', { p_id: id });
  if (error) throw error;
}

// peekPendingInviteEmail + claimPendingInvite moved to ./inviteApi.js (which
// imports only supabase, no yjs) so the signed-out landing can call them
// without dragging this module's `import * as Y from 'yjs'` into the entry
// chunk. Re-exported here so existing/other callers keep working unchanged.
export { peekPendingInviteEmail, claimPendingInvite } from './inviteApi.js';

export async function unshareBoard({ boardId, userId }) {
  const { error } = await supabase
    .rpc('unshare_board', { p_board_id: boardId, p_user_id: userId });
  if (error) throw error;
}

// Owner-only. Returns rows: { user_id, email, role, invited_by, created_at }.
export async function listBoardShares(boardId) {
  if (!boardId) return [];
  const { data, error } = await supabase
    .rpc('list_board_shares', { p_board_id: boardId });
  if (error) throw error;
  return data || [];
}

// Boards the caller has access to via a per-board share where they are
// NOT also a workspace member. Used by the sidebar's "Shared with me"
// section.  Returns rows shaped like:
//   { board_id, board_name, role, source_workspace_id,
//     source_workspace_name, parent_board_id, board_view, board_cover,
//     created_at }
export async function listSharedBoards() {
  const { data, error } = await supabase.rpc('list_shared_boards');
  if (error) throw error;
  return data || [];
}

// ── Public sharable links ────────────────────────────────────────────
// Owner-only. Generate, list, revoke anonymous read-only share tokens.
// Public viewers go through the upload party's /share-bundle route
// which calls get_share_bundle() anonymously and presigns image URLs.

export async function createPublicLink({ boardId, expiresAt = null, includeSubboards = false }) {
  const { data, error } = await supabase
    .rpc('create_public_link', {
      p_board_id: boardId,
      p_expires_at: expiresAt,
      p_include_subboards: includeSubboards,
    });
  if (error) throw error;
  return data;  // uuid token
}

export async function revokePublicLink(token) {
  const { error } = await supabase
    .rpc('revoke_public_link', { p_token: token });
  if (error) throw error;
}

// Owner-only. Flip whether a public link also exposes the board's
// sub-boards to anonymous viewers (server enforces the subtree boundary).
export async function setPublicLinkSubboards({ token, include }) {
  const { error } = await supabase
    .rpc('set_public_link_subboards', { p_token: token, p_include: include });
  if (error) throw error;
}

// Owner-only. Flip whether search engines may index this link's /share page
// (the Worker omits its noindex robots tag when allowed). Default OFF.
export async function setPublicLinkIndexing({ token, allow }) {
  const { error } = await supabase
    .rpc('set_public_link_indexing', { p_token: token, p_allow: allow });
  if (error) throw error;
}

// Mint (or reuse) a role-bearing INVITE link (0189): anyone with it can
// preview the board on /share and claim editor/viewer access after signing
// in. Pass expiresAt explicitly (the ShareModal default is 30 days); omit it
// to take the server's 30-day default. Returns the uuid token.
export async function createCollabLink({ boardId, role = 'editor', expiresAt }) {
  const params = { p_board_id: boardId, p_role: role };
  if (expiresAt !== undefined) params.p_expires_at = expiresAt; // explicit null = never expires
  const { data, error } = await supabase.rpc('create_collab_link', params);
  if (error) throw error;
  return data;  // uuid token
}

export async function listPublicLinks(boardId) {
  if (!boardId) return [];
  const { data, error } = await supabase
    .rpc('list_public_links', { p_board_id: boardId });
  if (error) throw error;
  // rows now carry `kind` ('view' | 'invite') + `joined_count` (0189).
  return data || [];
}

// Reuse-before-mint: return the board's existing active same-scope public link
// or create one. Powers the one-tap "Copy share link" toolbar action (and the
// ShareModal create button), so a board has at most one interchangeable link
// per scope instead of accumulating random tokens. Returns { token, reused }.
// VIEW links only — invite links (kind='invite', 0189) grant access on claim
// and must never be handed out by the anonymous-share path.
export async function ensurePublicLink({ boardId, includeSubboards = false, expiresAt = null }) {
  if (!boardId) throw new Error('ensurePublicLink: boardId required');
  const rows = await listPublicLinks(boardId);
  const active = (rows || []).filter(
    l => (l.kind || 'view') === 'view'
      && !l.revoked_at && (!l.expires_at || new Date(l.expires_at).getTime() > Date.now())
  );
  const existing = active.find(l => !!l.include_subboards === !!includeSubboards);
  if (existing) return { token: existing.token, reused: true };
  const token = await createPublicLink({ boardId, expiresAt, includeSubboards });
  return { token, reused: false };
}

// ── Public marketing boards (admin-only; migration 0136) ────────────────────
// Curate which boards are publicly discoverable at /c/<slug> with their own SEO
// copy. Every RPC is gated on is_admin() server-side; the UI gate is cosmetic.

export async function adminListPublicBoards() {
  const { data, error } = await supabase.rpc('admin_list_public_boards');
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

// Create/update a public board. Identify the board by boardId OR a pasted
// /share/<token> (shareToken). slug + SEO fields are upserted; `published`
// toggles live status. Returns { board_id, slug, published }.
export async function adminSetPublicBoard({
  boardId = null, shareToken = null, slug,
  seoTitle = null, seoDescription = null, seoBody = null,
  targetKeyword = null, ogImageKey = null, priority = 0, published = false,
}) {
  const { data, error } = await supabase.rpc('admin_set_public_board', {
    p_slug: slug,
    p_board_id: boardId,
    p_share_token: shareToken,
    p_seo_title: seoTitle,
    p_seo_description: seoDescription,
    p_seo_body: seoBody,
    p_target_keyword: targetKeyword,
    p_og_image_key: ogImageKey,
    p_priority: priority,
    p_published: published,
  });
  if (error) throw error;
  return data;
}

export async function adminUnpublishBoard(boardId) {
  const { error } = await supabase.rpc('admin_unpublish_board', { p_board_id: boardId });
  if (error) throw error;
}

// GSC measurement loop (migration 0138). Stats reader + CSV importer.
export async function adminPublicBoardStats(days = 90) {
  const { data, error } = await supabase.rpc('admin_public_board_stats', { p_days: days });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}
// rows: [{ page|slug, clicks, impressions, ctr, position }]; asOf: 'YYYY-MM-DD'.
export async function adminImportGscCsv(rows, asOf = null) {
  const { data, error } = await supabase.rpc('admin_import_gsc_csv', { p_rows: rows, p_as_of: asOf });
  if (error) throw error;
  return data; // count imported
}

// SEO measurement (migration 0180). Landing-page views/sessions/signups with a
// referrer-class breakdown (ai/search/social/referral/direct), the top external
// referrer hosts, and the latest SEO-health/deploy-drift run.
export async function adminSeoPageStats(days = 30) {
  const { data, error } = await supabase.rpc('admin_seo_page_stats', { p_days: days });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}
export async function adminSeoReferrers(days = 30) {
  const { data, error } = await supabase.rpc('admin_seo_referrers', { p_days: days });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}
export async function adminSeoHealthLatest() {
  const { data, error } = await supabase.rpc('admin_seo_health_latest');
  if (error) throw error;
  return data || null; // { run, checks } or null when no runs yet
}

// AI SEO tooling (migration 0137) — admin-only worker routes (worker-seo.js),
// gated server-side on tier='admin'. Same same-origin Bearer pattern as
// forceResetBoardRoom. Cloudflare Workers AI drafts copy / writes image alt; both return
// results for the admin to review (draft is NOT auto-saved).
async function seoWorkerPost(path, boardId) {
  let accessToken = '';
  try { const { data } = await supabase.auth.getSession(); accessToken = data?.session?.access_token || ''; } catch (_) {}
  if (!accessToken) throw new Error('not signed in');
  const res = await fetch(path, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ board_id: boardId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `${path} ${res.status}`);
  return data;
}

// Returns { draft: { seo_title, seo_description, seo_body, suggested_keyword }, grounded_on }.
export function aiDraftBoardSeo(boardId) { return seoWorkerPost('/api/seo/draft', boardId); }
// Generates + writes AI alt for image cards lacking it. Returns { generated, written, remaining }.
export function aiGenerateBoardAlts(boardId) { return seoWorkerPost('/api/seo/alt', boardId); }

// Ping IndexNow (Bing/Yandex) for a freshly published slug. Best-effort — never
// throws (Google ignores IndexNow; this is bonus coverage, not the indexing path).
export async function pingIndexNow(slug) {
  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data?.session?.access_token || '';
    if (!accessToken || !slug) return;
    await fetch('/api/seo/indexnow', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ slug }),
    });
  } catch (_) { /* non-fatal */ }
}

// ── Self-serve "Publish to Explore" + admin approve-queue (migration 0169) ──
// Any board owner can SUBMIT their board to the public /c/ + /explore SEO
// surface; it sits in a moderation queue (invisible publicly) until an admin
// approves. Approval = SEO/brand self-protection, not heavy moderation.

// USER: submit (or re-submit) my board. Returns { status:'pending'|'already_published', slug }.
export async function submitBoardToExplore({ boardId, slug = null, title = null, description = null, body = null, keyword = null }) {
  const { data, error } = await supabase.rpc('submit_board_to_explore', {
    p_board_id: boardId, p_slug: slug, p_title: title,
    p_description: description, p_body: body, p_keyword: keyword,
  });
  if (error) throw error;
  return data;
}

// USER: my board's submission status, or null if never submitted.
// { slug, review_status, published_at, published_by, review_reason }
export async function getMyExploreSubmission(boardId) {
  const { data, error } = await supabase.rpc('get_my_explore_submission', { p_board_id: boardId });
  if (error) throw error;
  return data || null;
}

// ADMIN: the review queue (default 'pending'; pass 'approved'/'rejected'/null).
export async function adminListPublicBoardSubmissions(status = 'pending') {
  const { data, error } = await supabase.rpc('admin_list_public_board_submissions', { p_status: status });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

// ADMIN: approve (publish) or reject a submission. Returns { status, slug }.
// Also emits a one-shot share_notifications toast to the submitter (migration 0171).
export async function adminReviewPublicBoard({ boardId, approve, reason = null }) {
  const { data, error } = await supabase.rpc('admin_review_public_board', {
    p_board_id: boardId, p_approve: approve, p_reason: reason,
  });
  if (error) throw error;
  return data;
}

// ADMIN: pending/approved/rejected counts for the Approvals nav badge (0171).
export async function adminPublicBoardSubmissionCounts() {
  const { data, error } = await supabase.rpc('admin_public_board_submission_counts');
  if (error) throw error;
  return data || { pending: 0, approved: 0, rejected: 0 };
}

// ADMIN: preview a (possibly still-pending) board's content before approving —
// { board_id, cards:[{card_id,kind,title,body,href,media}], subboards, truncated }
// (0171). Image bytes are streamed by the admin-gated worker route
// /api/admin/preview-img/<board_id>?i=<index>, indexed into this cards array.
export async function adminPreviewPublicBoard(boardId) {
  const { data, error } = await supabase.rpc('admin_public_board_preview', { p_board_id: boardId });
  if (error) throw error;
  return data || { board_id: boardId, cards: [], subboards: [], truncated: false };
}

// ── Boards ─────────────────────────────────────────────────────────────────

export async function listBoards(workspaceId) {
  const { data, error } = await supabase
    .from('boards')
    .select('*')
    .eq('workspace_id', workspaceId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listDeletedBoards(workspaceId) {
  const { data, error } = await supabase
    .from('boards')
    .select('*')
    .eq('workspace_id', workspaceId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getRootBoard(workspaceId) {
  const { data, error } = await supabase
    .from('boards')
    .select('*')
    .eq('workspace_id', workspaceId)
    .is('parent_board_id', null)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  return (data && data[0]) || null;
}

export async function createBoard({ workspaceId, parentBoardId = null, name, view = 'canvas', cover = null, meta = null, userId = null }) {
  // We generate the id client-side so we DON'T have to use INSERT…
  // RETURNING. RETURNING re-runs the boards SELECT policy
  // (can_read_board), which recursively walks the boards table — but
  // the just-inserted row isn't yet visible to that walk inside the
  // same statement, so the SELECT policy returns false and Postgres
  // throws the misleading "new row violates row-level security
  // policy" error even though the INSERT itself was permitted.
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const row = {
    id,
    workspace_id: workspaceId,
    parent_board_id: parentBoardId,
    name, view, cover, meta,
    created_by: userId,
  };
  const ins = await supabase.from('boards').insert(row);
  if (ins.error) throw ins.error;
  // Seed an empty Y.Doc snapshot so the row exists.
  const ydoc = new Y.Doc();
  await saveBoardSnapshot(id, ydoc);
  // Hydrate the row from a fresh statement (snapshot now includes it).
  const sel = await supabase.from('boards').select('*').eq('id', id).maybeSingle();
  if (sel.error) throw sel.error;
  return sel.data || row;
}

// Reparent boards under targetId (null = workspace root) via the validated,
// atomic `move_boards_under` RPC — the SINGLE authoritative write path for
// parent_board_id. The RPC re-checks per child server-side (exists, write
// access, same workspace, not self, not already there, NO CYCLE) and skips
// offenders rather than failing the batch. parent_board_id is the source of
// truth; the CALLER reconciles the derived `kind:'board'` canvas cards.
//
// We snapshot each child's current parent BEFORE the move and log one
// board_meta_history row per moved board (field 'parent_board_id') so the
// reparent stays auditable. (Note: reparent is NOT covered by Cmd+Z — undo
// is the in-session Yjs UndoManager, which tracks canvas edits, not the
// server-side board parent. The history row is for the audit trail only.)
// Returns { moved: string[], skipped: [{id, reason}] }.
export async function moveBoardsUnder(childIds, targetId = null, opts = {}) {
  const ids = [...new Set((childIds || []).filter(Boolean))];
  if (ids.length === 0) return { moved: [], skipped: [] };
  // Capture current parents BEFORE the move for accurate history before_value.
  const beforeById = {};
  try {
    const { data: pre } = await supabase
      .from('boards')
      .select('id, workspace_id, parent_board_id')
      .in('id', ids);
    for (const r of (pre || [])) beforeById[r.id] = r;
  } catch (_) {}
  const { data, error } = await supabase.rpc('move_boards_under', {
    p_child_ids: ids,
    p_target_id: targetId ?? null,
  });
  if (error) throw error;
  const result = data || { moved: [], skipped: [] };
  try {
    const histRows = (result.moved || [])
      .filter(id => beforeById[id])
      .map(id => {
        const prevParent = beforeById[id].parent_board_id ?? null;
        return {
          board_id: id,
          workspace_id: beforeById[id].workspace_id,
          field: 'parent_board_id',
          before_value: prevParent == null ? null : { v: prevParent },
          after_value: targetId == null ? null : { v: targetId },
          changed_by: opts.userId ?? null,
          session_id: opts.sessionId ?? null,
        };
      });
    if (histRows.length) {
      const ins = await supabase.from('board_meta_history').insert(histRows);
      if (ins.error) console.warn('[moveBoardsUnder] history insert failed', ins.error);
    }
  } catch (e) {
    console.warn('[moveBoardsUnder] history threw', e);
  }
  return result;
}

// Set of fields tracked in board_meta_history so Cmd+Z can reverse them.
// Edits to other columns (e.g. updated_at) are not audited. parent_board_id
// is logged separately by moveBoardsUnder (not via updateBoardMeta), so it's
// intentionally NOT listed here.
const META_TRACKED_FIELDS = ['name', 'cover', 'view', 'bg_color', 'meta'];

// Internal: diff current vs patch and write one history row per changed
// field. Caller is responsible for applying the actual UPDATE after.
// Fire-and-forget; never throws upward.
async function logMetaChanges(boardId, patch, { userId = null, sessionId = null } = {}) {
  try {
    const fields = Object.keys(patch).filter(k => META_TRACKED_FIELDS.includes(k));
    if (fields.length === 0) return;
    const sel = await supabase
      .from('boards')
      .select(['workspace_id', ...fields].join(','))
      .eq('id', boardId)
      .maybeSingle();
    if (sel.error || !sel.data) return;
    const workspaceId = sel.data.workspace_id;
    const rows = [];
    for (const f of fields) {
      const before = sel.data[f] ?? null;
      const after = patch[f] ?? null;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      rows.push({
        board_id: boardId,
        workspace_id: workspaceId,
        field: f,
        before_value: before === null ? null : { v: before },
        after_value: after === null ? null : { v: after },
        changed_by: userId,
        session_id: sessionId,
      });
    }
    if (rows.length === 0) return;
    const ins = await supabase.from('board_meta_history').insert(rows);
    if (ins.error) console.warn('[logMetaChanges] insert failed', ins.error);
  } catch (e) {
    console.warn('[logMetaChanges] threw', e);
  }
}

export async function renameBoard(boardId, name, opts = {}) {
  await logMetaChanges(boardId, { name }, opts);
  const { error } = await supabase
    .from('boards')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', boardId);
  if (error) throw error;
}

export async function updateBoardMeta(boardId, patch, opts = {}) {
  await logMetaChanges(boardId, patch, opts);
  const { error } = await supabase
    .from('boards')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', boardId);
  if (error) throw error;
}

// The board's canvas background color, for the thumbnail renderer. The
// regen path in yboard.js only has a boardId (its handle outlives any board
// row it was created with), so it re-reads the live value per regen — one
// tiny indexed select behind an 8s throttle + content-hash gate.
export async function getBoardBgColor(boardId) {
  const { data, error } = await supabase.from('boards').select('bg_color').eq('id', boardId).maybeSingle();
  if (error) return null;
  return data?.bg_color || null;
}

// Direct child boards of a parent, with just the fields the thumbnail
// renderer needs to paint each nested board's stored preview
// (drawBoardInterior reads thumb_key + bg_color; labelForCard reads name).
// Returns a boards-shaped map { [childId]: row } so it can be passed straight
// into renderThumbnailBlob({ boards }). Used by the yboard regen path, which
// has no in-memory boards map. Empty object on error. One indexed select,
// gated upstream by the 8s throttle + content-hash dedup.
export async function getChildBoardThumbs(parentBoardId) {
  if (!parentBoardId) return {};
  const { data, error } = await supabase
    .from('boards')
    .select('id, name, thumb_key, thumb_version, thumb_updated_at, bg_color')
    .eq('parent_board_id', parentBoardId)
    .is('deleted_at', null);
  if (error) { console.warn('[getChildBoardThumbs]', error); return {}; }
  const map = {};
  for (const b of data || []) map[b.id] = b;
  return map;
}

// Stamp a board's stored-preview pointer (thumb_key / card_count) after the
// editing client regenerates its thumbnail. Deliberately does NOT touch
// `updated_at` or log to board_meta_history (unlike updateBoardMeta) so the
// tile's "Updated X ago" stays meaningful and undo/meta-history isn't
// polluted by background preview refreshes. RLS: boards update =
// can_write_workspace, so the editing user is permitted. Fire-and-forget.
export async function updateBoardThumb(boardId, { thumbKey = null, cardCount = null, thumbVersion = null, custom = null } = {}) {
  const patch = { thumb_updated_at: new Date().toISOString() };
  if (thumbKey != null) patch.thumb_key = thumbKey;
  if (cardCount != null) patch.card_count = cardCount;
  if (thumbVersion != null) patch.thumb_version = thumbVersion;
  // `custom` marks the stored preview as a user-uploaded cover (true) or clears
  // that mark on reset (false). While true, all three auto-regen paths skip the
  // board so a canvas edit / nested-child change can't overwrite the user's image.
  if (custom != null) patch.thumb_custom = custom;
  const { error } = await supabase.from('boards').update(patch).eq('id', boardId);
  if (error) console.warn('[updateBoardThumb]', error);
}

// Authoritative "is this board's thumbnail user-set?" check for the yboard regen
// funnel (_renderUploadStampThumb), which has only a boardId and no in-memory
// board row. One indexed PK select behind the same 8s throttle + content-hash
// gate as the other per-regen reads. Defaults to false on any error so a
// transient failure never permanently blocks the auto thumbnail.
export async function isBoardThumbCustom(boardId) {
  if (!boardId) return false;
  const { data, error } = await supabase.from('boards').select('thumb_custom').eq('id', boardId).maybeSingle();
  if (error) return false;
  return !!data?.thumb_custom;
}

// History of metadata changes for a board, newest first.
export async function listBoardMetaHistory(boardId, limit = 200) {
  const { data, error } = await supabase
    .from('board_meta_history')
    .select('id, board_id, field, before_value, after_value, changed_by, changed_at, session_id')
    .eq('board_id', boardId)
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (error) { console.warn('[listBoardMetaHistory]', error); return []; }
  return data || [];
}

// Soft-delete a board so it (and all its content) can be undone for 30
// days. The `boards.deleted_at` filter is applied on every read path
// (listBoards, getRootBoard, fetchBoardById). After 30 days the
// purge_old_deleted_boards() cron sweeps them and FK cascades take care
// of their board_state / board_versions / card_index / etc.
export async function deleteBoard(boardId) {
  console.log('[delete] deleteBoard (soft) request', { boardId });
  const { error } = await supabase.rpc('soft_delete_board', { p_board_id: boardId });
  if (error) {
    // Fall back to direct UPDATE if the RPC isn't deployed yet.
    console.warn('[delete] soft_delete_board RPC failed, falling back to UPDATE', error);
    const upd = await supabase
      .from('boards')
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', boardId)
      .is('deleted_at', null);
    if (upd.error) {
      console.warn('[delete] soft-delete fallback also failed', upd.error);
      throw upd.error;
    }
  }
  console.log('[delete] deleteBoard (soft) ok', { boardId });
}

// Reverse a soft-delete. Used by the time-travel restore path so an
// undone delete fully comes back, and by the Trash UI.
export async function restoreBoard(boardId) {
  const { error } = await supabase.rpc('restore_board', { p_board_id: boardId });
  if (error) {
    console.warn('[restoreBoard] RPC failed, falling back to UPDATE', error);
    const upd = await supabase
      .from('boards')
      .update({ deleted_at: null, updated_at: new Date().toISOString() })
      .eq('id', boardId);
    if (upd.error) throw upd.error;
  }
}

// Hard-delete a board (admin-only path; not wired into the UI yet). Use
// the existing DELETE for cases where the user explicitly wants to purge.
export async function hardDeleteBoard(boardId) {
  const { error } = await supabase.from('boards').delete().eq('id', boardId);
  if (error) throw error;
}

// ── Board state (Y.Doc snapshot, base64-encoded text) ───────────────────────

export async function loadBoardSnapshot(boardId) {
  const { data, error } = await supabase
    .from('board_state')
    .select('doc')
    .eq('board_id', boardId)
    .maybeSingle();
  if (error) throw error;
  return data?.doc || null; // base64 string or null
}

export async function saveBoardSnapshot(boardId, ydoc) {
  const update = Y.encodeStateAsUpdate(ydoc);
  const b64 = bytesToB64(update);
  const { error } = await supabase
    .from('board_state')
    .upsert({ board_id: boardId, doc: b64, updated_at: new Date().toISOString() },
            { onConflict: 'board_id' });
  if (error) throw error;
  // Mirror the board's cards into card_index so the home graph can render
  // every card as a node (not just boards). Best-effort — failures don't
  // block the snapshot save.
  syncCardIndex({ boardId, ydoc }).catch(e => console.warn('card_index sync failed', e));
  // Mirror named card-groups into group_index so they appear in
  // entity_search (linkable / @-mentionable / hover-previewable).
  syncGroupIndex({ boardId, ydoc }).catch(e => console.warn('group_index sync failed', e));
}

// Project the board's Y.Map<'cards'> into Postgres `card_index`.
//
// Throttled and de-duped because saveBoardSnapshot fires every 250ms while
// users are active. Without throttle, two windows on the same board race
// each other (DELETE → DELETE → INSERT(ok) → INSERT(409)) and burn the
// REST API rate budget — which then starves the realtime websocket.
//
// Implementation:
//   - UPSERT instead of DELETE+INSERT (no race; conflicting writes
//     overwrite cleanly via the (board_id, card_id) unique key).
//   - Per-board 10s throttle: subsequent calls within the window are
//     coalesced into one trailing flush.
//   - Orphan rows (cards deleted from the Y.Doc) are cleaned up by a
//     single targeted DELETE only when we detect the row count differs.
//
// Errors are logged but not thrown — this index is derived state; the
// source of truth is the Y.Doc + board_state.

const SYNC_THROTTLE_MS = 10000;
const _syncState = new Map();   // boardId → { last: timestamp, pending: timer, latestYdoc }
// Per-board content fingerprints from the last successful sync. card_index
// is in the realtime publication, so every upserted row fans out as a
// postgres_changes message to every client subscribed to this workspace's
// entity-name trie. Diffing against these signatures lets us upsert ONLY the
// cards that actually changed (instead of re-writing — and re-broadcasting —
// every card on the board every ~10s while editing).
const _cardIndexCache = new Map();   // boardId → { sigs: Map<card_id, sig>, ids: Set<card_id> }
// board_id → workspace_id is immutable for a board's lifetime, but the sync
// fires every ~10s while editing — cache it so each flush is one round-trip,
// not two.
const _boardWsCache = new Map();

export async function syncCardIndex({ boardId, ydoc }) {
  if (!supabase || !boardId || !ydoc) return;
  const state = _syncState.get(boardId) || { last: 0, pending: null };
  state.latestYdoc = ydoc;
  _syncState.set(boardId, state);

  const now = Date.now();
  if (state.pending) return;                       // already scheduled
  const wait = Math.max(0, SYNC_THROTTLE_MS - (now - state.last));
  state.pending = setTimeout(async () => {
    state.pending = null;
    state.last = Date.now();
    await _doSyncCardIndex(boardId, state.latestYdoc);
  }, wait);
}

function htmlToText(html) {
  if (!html) return '';
  // Cheap HTML-strip — drops tags + entities, collapses whitespace.
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function _doSyncCardIndex(boardId, ydoc) {
  if (!supabase || !boardId || !ydoc) return;
  let workspaceId = _boardWsCache.get(boardId);
  if (!workspaceId) {
    const wsq = await supabase.from('boards').select('workspace_id').eq('id', boardId).maybeSingle();
    if (wsq.error) { console.warn('syncCardIndex resolve workspace', wsq.error); return; }
    workspaceId = wsq.data?.workspace_id;
    if (!workspaceId) return;
    _boardWsCache.set(boardId, workspaceId);
  }
  const cardsMap = ydoc.getMap('cards');
  // Pull the groups map once so we can capture group names per
  // card in card_index.meta. Used by the tag detail view to render
  // group context and aggregate "Groups" rows. NOTE: groups is a
  // Y.Map keyed by groupId — calling getArray here used to throw
  // "Type with the name groups has already been defined with a
  // different constructor" because yboard.js gets it as a Map.
  const groupsMap = ydoc.getMap('groups');
  const groupNameById = new Map();
  try {
    groupsMap.forEach((g, id) => {
      const name = g?.get?.('name') ?? g?.name;
      if (id) groupNameById.set(String(id), name || '');
    });
  } catch (_) {}
  const rows = [];
  const liveIds = new Set();
  // Image cards that lack a Y.Doc src — typically because the upload
  // hadn't completed (or wrote its src after the throttled sync ran).
  // We patch their meta.src from the `images` table after the walk.
  const imageCardsNeedingSrc = [];
  const _t0 = perf.isEnabled() ? performance.now() : 0;
  cardsMap.forEach((v, id) => {
    if (!v) return;
    const get = (k) => v?.get?.(k) ?? v?.[k];
    // Onboarding seeds never enter the entity-search index. The seeded "Ideas"
    // board uses a real UUID card id, so an id-prefix test alone is insufficient
    // — also honor the durable seed:true flag. Keeping these rows OUT of
    // card_index stops the server triggers _stamp_first_card /
    // _stamp_first_populated_board (migration 0120, which only exclude
    // card_id like 'onb-%') from falsely stamping activation at seed time. Boards
    // render from the `boards` table, not card_index, so the board stays fully
    // functional; previously-indexed onb- rows are removed by the orphan sweep
    // below once the live id set changes.
    if (get('seed') === true || (id && String(id).startsWith('onb-'))) return;
    const kind = get('kind') || 'note';
    const title = get('title') || get('name') || get('label') || get('url') || '';
    // Notes carry text in `html`, not `body` — fall through so we
    // index the actual user-visible content. Strip HTML.
    const rawBody = get('body') || get('caption') || '';
    let body = rawBody || htmlToText(get('html') || '');
    // Kind-aware bodies so search + the public page RPC see real content
    // (lockstep with scripts/lib/cardEncode.mjs buildCardIndexRows).
    if (kind === 'doc' && Array.isArray(get('lines'))) {
      body = get('lines').map((l) => (l.bullet ? `• ${l.text}` : l.text || '')).join('\n').trim() || body;
    } else if (kind === 'schedule' && get('schedView')) {
      // New-model calendar: index each item as "Jul 15 — title — 9 AM".
      const cellsObj = {};
      const scm = get('gridCells');
      if (scm && typeof scm.forEach === 'function') scm.forEach((cv, ck) => { cellsObj[ck] = (cv && cv.toJSON) ? cv.toJSON() : cv; });
      body = schedLegacyRows(schedItems(cellsObj)).map((r) => [r.day, r.what, r.loc].filter(Boolean).join(' — ')).join('\n') || body;
    } else if (kind === 'schedule' && Array.isArray(get('rows'))) {
      body = get('rows').map((r) => [r.day, r.what, r.loc].filter(Boolean).join(' — ')).join('\n') || body;
    }
    const groupId = get('groupId') || null;
    const groupName = groupId ? (groupNameById.get(String(groupId)) || '') : '';
    // Per-kind preview data — drives the universal popover's
    // visual previews (image thumbnails, palette swatches, etc).
    // Migration 0021 added the `meta jsonb` column.
    const baseMeta = buildCardMeta(kind, get) || {};
    // Layout + section meta for get_public_board_page (0181): spatial article
    // ordering and H2 section grouping on /c/<slug>. Lockstep with the generator.
    const px = get('x'), py = get('y');
    if (Number.isFinite(px) && Number.isFinite(py)) {
      baseMeta.pos = { x: Math.round(px), y: Math.round(py),
                       w: Math.round(get('w') || 0), h: Math.round(get('h') || 0) };
    }
    if (get('sectionHeader')) {
      baseMeta.sectionHeader = true;
      const sub = get('sub');
      if (sub) baseMeta.sub = String(sub).slice(0, 300);
    }
    const meta = (groupId || groupName)
      ? { ...baseMeta, groupId, groupName }
      : baseMeta;
    if (kind === 'image' && !meta.src) imageCardsNeedingSrc.push(id);
    // Weighted card count: a cell container (grid, new-model schedule) weighs
    // its FILLED cells (min 1), so a grid of 25 images counts ~25 toward the
    // demo cap, not 1. Everything else — incl. LEGACY rows schedules — weighs 1.
    let weight = 1;
    if (kind === 'grid' || (kind === 'schedule' && get('schedView'))) {
      const cellsObj = {};
      const gcm = get('gridCells');
      if (gcm && typeof gcm.forEach === 'function') gcm.forEach((cv, ck) => { cellsObj[ck] = (cv && cv.toJSON) ? cv.toJSON() : cv; });
      weight = cardWeight(kind, cellsObj);
    }
    rows.push({
      workspace_id: workspaceId,
      board_id: boardId,
      card_id: id,
      kind,
      title: String(title).slice(0, 200),
      body: String(body).slice(0, 500),
      meta,
      weight,
    });
    liveIds.add(id);
  });
  if (_t0) {
    const ms = performance.now() - _t0;
    perf.mark('syncCardIndex.iterate.ms', ms);
    perf.bump('syncCardIndex.runs');
    perf.gauge('syncCardIndex.lastCount', rows.length);
    if (ms > 100) console.warn('[perf] slow syncCardIndex.iterate', `${ms.toFixed(0)}ms`, `${rows.length} cards`);
  }

  // Recovery: for image cards with no Y.Doc src, look up the images
  // table by (board_id, card_id) and graft storage_path → meta.src.
  // The images row is written by uploadImage at upload-complete time;
  // having card_id stamped there lets us recover even if the Y.Doc
  // never got the updateCard({src}) (e.g. user closed the tab right
  // after dropping).
  if (imageCardsNeedingSrc.length > 0) {
    try {
      const { data: imgRows } = await supabase.from('images')
        .select('card_id, storage_path')
        .eq('board_id', boardId)
        .in('card_id', imageCardsNeedingSrc);
      const byCardId = new Map();
      for (const r of (imgRows || [])) {
        if (r.card_id && r.storage_path) byCardId.set(r.card_id, r.storage_path);
      }
      if (byCardId.size > 0) {
        for (const row of rows) {
          if (row.kind !== 'image' || row.meta?.src) continue;
          const sp = byCardId.get(row.card_id);
          if (!sp) continue;
          row.meta = { ...(row.meta || {}), src: `r2:${sp}` };
        }
      }
    } catch (e) { console.warn('syncCardIndex image-src recovery failed', e?.message || e); }
  }

  // Change-detection: only upsert cards whose indexed content actually
  // changed since our last sync. Without this, the throttled ~10s sync
  // re-writes EVERY card on the board (no-op UPDATEs still produce WAL
  // records → realtime fan-out), which was the dominant avoidable source
  // of Realtime messages during editing. The Y.Doc + board_state remain
  // the source of truth, so a stale signature only ever costs one extra
  // (correct) upsert, never data loss.
  const cache = _cardIndexCache.get(boardId) || { sigs: new Map(), ids: new Set() };
  const sigFor = (r) => `${r.kind}\x00${r.title}\x00${r.body}\x00${r.weight ?? 1}\x00${JSON.stringify(r.meta ?? null)}`;
  const changed = rows.filter(r => cache.sigs.get(r.card_id) !== sigFor(r));

  if (changed.length > 0) {
    // UPSERT on (board_id, card_id). Idempotent — no race if two windows
    // run this concurrently.
    const ups = await supabase.from('card_index').upsert(changed, { onConflict: 'board_id,card_id' });
    if (ups.error) { console.warn('syncCardIndex upsert', ups.error); return; }
    for (const r of changed) cache.sigs.set(r.card_id, sigFor(r));
  }

  // Clean up rows for cards that no longer exist on the board — but only
  // when the set of live cards actually changed (add/remove). When nothing
  // was added or removed there can be no orphans, so we skip the extra
  // round-trip entirely.
  const idsChanged = liveIds.size !== cache.ids.size || [...liveIds].some(id => !cache.ids.has(id));
  if (idsChanged) {
    const existing = await supabase.from('card_index').select('card_id').eq('board_id', boardId);
    if (existing.error) return;
    const orphanIds = (existing.data || []).map(r => r.card_id).filter(id => !liveIds.has(id));
    if (orphanIds.length > 0) {
      await supabase.from('card_index').delete().eq('board_id', boardId).in('card_id', orphanIds);
    }
    for (const id of [...cache.sigs.keys()]) if (!liveIds.has(id)) cache.sigs.delete(id);
  }
  cache.ids = liveIds;
  _cardIndexCache.set(boardId, cache);
}

// Per-kind preview data baked into card_index.meta. Kept compact —
// these rows are read often, and the universal popover only needs
// what it can render without re-fetching from the Y.Doc.
function buildCardMeta(kind, get) {
  switch (kind) {
    case 'image':
      return { src: get('src') || null, alt: get('alt') || null,
               w: get('w') || null, h: get('h') || null };
    case 'palette':
      return { swatches: (get('swatches') || []).slice(0, 12) };
    case 'link':
      return { url: get('link') || get('source') || get('url') || null };
    case 'board':
    case 'boardlink':
      return { boardId: get('id') || get('target') || null };
    case 'doc':
      return { pageCount: (get('pages') || []).length || null,
               lineCount: (get('lines') || []).length || null };
    // The kinds below feed get_public_board_page (migration 0181) — the
    // public /c/<slug> article renders schedules as tables, grids as cell
    // lists, and shapes as labeled lines. MUST stay in lockstep with
    // scripts/lib/cardEncode.mjs buildCardMeta or an in-app edit of a
    // published board silently degrades its public article.
    case 'schedule': {
      // New-model calendar: expose items + synthesized legacy rows so the
      // public /c article's existing table render shows a real summary.
      if (get('schedView')) {
        const cellsObj = {};
        const scm = get('gridCells');
        if (scm && typeof scm.forEach === 'function') scm.forEach((cv, ck) => { cellsObj[ck] = (cv && cv.toJSON) ? cv.toJSON() : cv; });
        const items = schedItems(cellsObj, { max: 30 });
        return { schedView: get('schedView'), anchor: get('anchor') || null, items, rows: schedLegacyRows(items) };
      }
      return { rows: (get('rows') || []).slice(0, 30) };
    }
    case 'grid': {
      const gcm = get('gridCells');
      const fmt = get('seqFormat') || {};
      const out = [];
      let idx = 0;
      if (gcm && typeof gcm.forEach === 'function') {
        gcm.forEach((cv) => {
          const i = idx++;
          const cell = (cv && cv.toJSON) ? cv.toJSON() : cv;
          if (!cell || cell.type === 'empty') { out.push({ type: 'empty' }); return; }
          out.push({
            type: cell.type,
            src: cell.src || null,
            alt: cell.alt || null,
            text: cell.type === 'text'
              ? htmlToText(resolveTagText(cell.html || '', { index: i, format: fmt }))
              : null,
          });
        });
      }
      return { cells: out.slice(0, 60) };
    }
    case 'shape':
      return { shape: get('shape') || 'rect', label: get('label') || null };
    case 'video':
      return { src: get('src') || null, poster: get('poster') || null };
    default:
      return null;
  }
}

// Workspace-wide palette library. Pulls from card_index (synced after every
// board save by syncCardIndex / buildCardMeta), so swatches are queryable
// without decoding every board's Y.Doc. RLS on card_index already restricts
// to workspace members + readable boards.
export async function listWorkspacePalettes(workspaceId) {
  if (!supabase || !workspaceId) return [];
  const { data, error } = await supabase
    .from('card_index')
    .select('board_id, card_id, title, meta, updated_at')
    .eq('workspace_id', workspaceId)
    .eq('kind', 'palette')
    .order('updated_at', { ascending: false });
  if (error) { console.warn('listWorkspacePalettes', error); return []; }
  return (data || [])
    .map(r => {
      const swatches = Array.isArray(r.meta?.swatches)
        ? r.meta.swatches.filter(s => s && s.hex)
        : [];
      if (swatches.length === 0) return null;
      return {
        id: `${r.board_id}:${r.card_id}`,
        boardId: r.board_id,
        cardId: r.card_id,
        name: r.title || 'Palette',
        swatches,
      };
    })
    .filter(Boolean);
}

// ── Version history ─────────────────────────────────────────────────────────

// Snapshot the current Y.Doc into board_versions. Returns the inserted row's
// id (or null on failure). MUST NEVER THROW — callers run this inline before
// risky writes and we don't want to block the actual operation if the
// snapshot insert hits a network blip.
export async function saveBoardVersion(boardId, ydoc, {
  label = null,
  userId = null,
  sessionId = null,
  triggerKind = null,
  opSummary = null,
  parentVersionId = null,
} = {}) {
  try {
    const update = Y.encodeStateAsUpdate(ydoc);
    const b64 = bytesToB64(update);
    const cardCount = ydoc.getMap('cards').size;
    const row = {
      board_id: boardId,
      doc: b64,
      card_count: cardCount,
      label,
      made_by: userId,
    };
    if (sessionId) row.session_id = sessionId;
    if (triggerKind) row.trigger_kind = triggerKind;
    if (opSummary) row.op_summary = opSummary;
    if (parentVersionId) row.parent_version_id = parentVersionId;
    const { data, error } = await supabase
      .from('board_versions')
      .insert(row)
      .select('id')
      .single();
    if (error) {
      console.warn('[saveBoardVersion] insert failed', error);
      return null;
    }
    // Fire-and-forget retention prune; never block on it.
    supabase.rpc('prune_board_versions', { p_board_id: boardId }).then(
      () => {},
      (e) => console.warn('[saveBoardVersion] prune failed', e),
    );
    return data?.id || null;
  } catch (e) {
    console.warn('[saveBoardVersion] threw', e);
    return null;
  }
}

export async function listBoardVersions(boardId, limit = 200) {
  const { data, error } = await supabase
    .from('board_versions')
    .select('id, snapshot_at, card_count, label, made_by, session_id, trigger_kind, op_summary, parent_version_id')
    .eq('board_id', boardId)
    .order('snapshot_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Follow-up 1: workspace-wide rewind preview. Returns per-board rows
// showing what each board would look like if rewound to target_ts.
export async function previewWorkspaceRewind(workspaceId, targetTs) {
  const session = await supabase.auth.getSession();
  const accessToken = session?.data?.session?.access_token;
  if (!accessToken) throw new Error('not signed in');
  const res = await fetch(`${supabase.supabaseUrl}/functions/v1/workspace-rewind`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'preview', workspace_id: workspaceId, target_ts: targetTs }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error || `preview failed (${res.status})`);
  return json.rows || [];
}

// Follow-up 1: execute workspace-wide rewind. targets is [{board_id, snapshot_id}]
export async function performWorkspaceRewind(workspaceId, targets, { reason = null, clientRequestId = null } = {}) {
  const session = await supabase.auth.getSession();
  const accessToken = session?.data?.session?.access_token;
  if (!accessToken) throw new Error('not signed in');
  const res = await fetch(`${supabase.supabaseUrl}/functions/v1/workspace-rewind`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'rewind',
      workspace_id: workspaceId,
      targets,
      reason,
      client_request_id: clientRequestId,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error || `rewind failed (${res.status})`);
  return json;
}

// Follow-up 1: list open + recent anomaly alerts for a workspace.
export async function listWorkspaceAlerts(workspaceId, { limit = 50, onlyOpen = false } = {}) {
  let q = supabase.from('workspace_anomaly_alerts')
    .select('id, detected_at, kind, severity, payload, acknowledged_at, acknowledged_by, board_ids, auto_paused')
    .eq('workspace_id', workspaceId)
    .order('detected_at', { ascending: false })
    .limit(limit);
  if (onlyOpen) q = q.is('acknowledged_at', null);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Acknowledge an open alert (set acknowledged_at = now()).
export async function acknowledgeAlert(alertId) {
  const { data: u } = await supabase.auth.getUser();
  const userId = u?.user?.id || null;
  const { error } = await supabase
    .from('workspace_anomaly_alerts')
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: userId })
    .eq('id', alertId);
  if (error) throw error;
}

export async function loadBoardVersionDoc(versionId) {
  const { data, error } = await supabase
    .from('board_versions')
    .select('doc')
    .eq('id', versionId)
    .single();
  if (error) throw error;
  return data?.doc || null;
}

// Fetch the most recent version row STRICTLY OLDER than `currentSnapshotAt`
// (or the latest one when currentSnapshotAt is null). Used by the Cmd+Z
// fallthrough to walk back through history one step at a time.
export async function fetchPrevVersion(boardId, currentSnapshotAt = null) {
  let q = supabase
    .from('board_versions')
    .select('id, snapshot_at, card_count, label, made_by, session_id, trigger_kind, op_summary')
    .eq('board_id', boardId)
    .order('snapshot_at', { ascending: false })
    .limit(1);
  if (currentSnapshotAt) q = q.lt('snapshot_at', currentSnapshotAt);
  const { data, error } = await q;
  if (error) { console.warn('[fetchPrevVersion]', error); return null; }
  return (data && data[0]) || null;
}

// Fetch the next version row STRICTLY NEWER than `currentSnapshotAt`.
// Used by Cmd+Shift+Z to walk forward through history when no in-memory
// forward stack is available (e.g. after page reload).
export async function fetchNextVersion(boardId, currentSnapshotAt) {
  if (!currentSnapshotAt) return null;
  const { data, error } = await supabase
    .from('board_versions')
    .select('id, snapshot_at, card_count, label, made_by, session_id, trigger_kind, op_summary')
    .eq('board_id', boardId)
    .gt('snapshot_at', currentSnapshotAt)
    .order('snapshot_at', { ascending: true })
    .limit(1);
  if (error) { console.warn('[fetchNextVersion]', error); return null; }
  return (data && data[0]) || null;
}

// ── Bulletproof restore ────────────────────────────────────────────────────
// The naive restoreVersionInto() approach (clear local Y.Doc, applyUpdate
// snapshot bytes) is BROKEN for Yjs: the clear-ops record new lamport
// clocks, then the snapshot's set-ops merge in but lose to the newer
// deletes. Net result: doc gets emptied, not restored. Confirmed in
// production — see commit a91563e fallout.
//
// The bulletproof flow:
//   1) Write the restored bytes to board_state (Supabase) — cold-load source of truth.
//   2) POST /reset to the board's PartyKit room — wipes the DO's stale
//      y-partykit snapshot and force-disconnects every connected client
//      so they can't broadcast their stale Y.Doc state back into the
//      now-empty room.
//   3) Caller (useYBoard / consumer) bumps its restoreEpoch so it
//      destroys the current Y.Doc handle and re-runs loadYBoard, which
//      cold-loads from board_state (restored) and reconnects to the
//      empty room. The fresh state becomes authoritative.

// POST /reset to the board room. Returns { ok, kicked } or throws.
// Goes through the same-origin Pages worker (boards/src/worker.js) so
// browsers don't CORS-block the call. The worker forwards server-to-
// server to PartyKit's /reset, preserving the Bearer-token auth.
export async function forceResetBoardRoom(boardId) {
  if (!boardId) throw new Error('forceResetBoardRoom: missing boardId');
  let accessToken = '';
  try {
    const { data } = await supabase.auth.getSession();
    accessToken = data?.session?.access_token || '';
  } catch (_) {}
  if (!accessToken) throw new Error('not signed in');
  // Same-origin path → no CORS preflight. The Pages worker proxies to
  // PartyKit's /parties/main/{boardId}/reset server-to-server.
  const url = `/api/board/${encodeURIComponent(boardId)}/reset`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/reset ${res.status}: ${text.slice(0, 200)}`);
  }
  return await res.json().catch(() => ({ ok: true }));
}

// Decode a base64-encoded Y update into a fresh Y.Doc and return it.
// Caller is responsible for destroy(). Used both to validate snapshot
// bytes BEFORE writing to board_state and as the seed for the new
// post-restore Y.Doc.
export function decodeSnapshotBytes(b64) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, b64ToBytes(b64), 'restore');
  return doc;
}

// Restore a board's Y.Doc from snapshot bytes (base64). Used by the
// drag-into-board safety net to auto-roll-back when the source-delete
// invariant is violated. Writes the bytes to board_state, wipes the
// PartyKit room, records an audit version, and fires the reset event so
// every mounted useYBoard tears down + re-cold-loads the restored state.
//
// Throws on any failure — UI should catch and surface a toast.
export async function bulletproofRestore(boardId, b64) {
  if (!boardId || !b64) throw new Error('bulletproofRestore: missing args');
  // Sanity-check the bytes BEFORE writing. An empty or corrupt snapshot
  // would silently wipe the board if we proceeded — refuse instead.
  try {
    const raw = b64ToBytes(b64);
    if (!raw || raw.length < 32) {
      throw new Error('Version snapshot is empty or corrupt; refusing to restore.');
    }
  } catch (e) {
    throw new Error('Version snapshot could not be decoded: ' + (e?.message || e));
  }
  // 1) Save restored bytes to board_state. Use a fresh Y.Doc so the
  //    written update is a clean snapshot (no merge artifacts). Verify
  //    the snapshot actually contains something — if the decoded Y.Doc
  //    has zero cards, the user almost certainly didn't mean to restore
  //    an empty board. Surface that as a hard error.
  const tmp = decodeSnapshotBytes(b64);
  try {
    const cardCount = tmp.getMap('cards')?.size || 0;
    if (cardCount === 0) {
      const totalKeys = ['cards', 'arrows', 'strokes', 'groups', 'docPages']
        .reduce((sum, k) => sum + (tmp.getMap(k)?.size || 0), 0);
      if (totalKeys === 0) {
        throw new Error('Snapshot has 0 cards / arrows / strokes — restore would empty the board.');
      }
    }
    await saveBoardSnapshot(boardId, tmp);
  } finally {
    tmp.destroy();
  }
  // 2) Wipe the PartyKit room + kick every client. Best-effort: if the
  //    party isn't deployed yet (or this returns 4xx), proceed anyway.
  //    Without the wipe, the room's DO storage will eventually re-merge
  //    its stale state and undo the restore for live connections — so
  //    surface the failure to the caller so they can warn the user.
  try {
    await forceResetBoardRoom(boardId);
  } catch (e) {
    console.warn('[bulletproofRestore] room reset failed (continuing)', e);
  }
  // 3) Audit row (board_versions) recording the bulletproof restore.
  try {
    const userId = (await supabase.auth.getUser())?.data?.user?.id || null;
    const seed = decodeSnapshotBytes(b64);
    await saveBoardVersion(boardId, seed, {
      label: 'bulletproof-restore',
      userId,
      triggerKind: 'manual',
      opSummary: { action: 'bulletproof-restore' },
    });
    seed.destroy();
  } catch (e) {
    console.warn('[bulletproofRestore] audit row failed', e);
  }
  // 4) Fire the reset event so every mounted useYBoard for this board
  //    tears down + re-cold-loads, picking up the restored state.
  try {
    if (typeof window !== 'undefined' && typeof window.__soleilEmitBoardReset === 'function') {
      window.__soleilEmitBoardReset(boardId);
    }
  } catch (_) {}
}

// ── Card group index (mirror of Y.Doc 'groups' map) ───────────────────────
// One row per (board_id, group_id) so groups appear in entity_search and
// the universal linking system can find / hover / link to them.

// Throttled + fingerprinted like syncCardIndex above: saveBoardSnapshot
// fires every 250ms while editing, and group membership changes far less
// often than card content. Without this, every save paid two round-trips
// (workspace resolve + orphan SELECT) plus an unconditional upsert that
// re-broadcast every group row over realtime.
const _groupSyncState = new Map();   // boardId → { last, pending, latestYdoc }
const _groupSigCache = new Map();    // boardId → fingerprint of last successful sync

export async function syncGroupIndex({ boardId, ydoc }) {
  if (!supabase || !boardId || !ydoc) return;
  const state = _groupSyncState.get(boardId) || { last: 0, pending: null };
  state.latestYdoc = ydoc;
  _groupSyncState.set(boardId, state);
  if (state.pending) return;                       // already scheduled
  const wait = Math.max(0, SYNC_THROTTLE_MS - (Date.now() - state.last));
  state.pending = setTimeout(async () => {
    state.pending = null;
    state.last = Date.now();
    await _doSyncGroupIndex(boardId, state.latestYdoc);
  }, wait);
}

async function _doSyncGroupIndex(boardId, ydoc) {
  if (!supabase || !boardId || !ydoc) return;
  try {
    let workspaceId = _boardWsCache.get(boardId);
    if (!workspaceId) {
      const wsq = await supabase.from('boards').select('workspace_id').eq('id', boardId).maybeSingle();
      if (wsq.error) { console.warn('syncGroupIndex resolve workspace', wsq.error); return; }
      workspaceId = wsq.data?.workspace_id;
      if (!workspaceId) return;
      _boardWsCache.set(boardId, workspaceId);
    }

    const groupsMap = ydoc.getMap('groups');
    const cardsMap = ydoc.getMap('cards');
    // Per-group member counts from cards.groupId
    const counts = new Map();
    cardsMap.forEach((ym) => {
      const gid = ym?.get?.('groupId');
      if (!gid) return;
      counts.set(gid, (counts.get(gid) || 0) + 1);
    });

    const liveIds = new Set();
    const rows = [];
    groupsMap.forEach((g, id) => {
      liveIds.add(id);
      rows.push({
        workspace_id: workspaceId,
        board_id: boardId,
        group_id: id,
        name: (g?.get?.('name') || '').slice(0, 200),
        member_count: counts.get(id) || 0,
        outline: !!g?.get?.('outline'),
        color: g?.get?.('color') || null,
        updated_at: new Date().toISOString(),
      });
    });

    // Skip the write + orphan check entirely when nothing group-related
    // changed since the last successful sync (updated_at excluded — it
    // changes every call by construction).
    const sig = JSON.stringify(
      rows.map(r => [r.group_id, r.name, r.member_count, r.outline, r.color]).sort(),
    );
    if (_groupSigCache.get(boardId) === sig) return;

    if (rows.length > 0) {
      const ups = await supabase.from('group_index').upsert(rows, { onConflict: 'board_id,group_id' });
      if (ups.error) { console.warn('group_index upsert', ups.error); return; }
    }

    // Drop rows for groups deleted from the Y.Doc.
    const existing = await supabase.from('group_index').select('group_id').eq('board_id', boardId);
    if (existing.error) return;
    const orphans = (existing.data || []).map(r => r.group_id).filter(id => !liveIds.has(id));
    if (orphans.length > 0) {
      await supabase.from('group_index').delete().eq('board_id', boardId).in('group_id', orphans);
    }
    _groupSigCache.set(boardId, sig);
  } catch (e) {
    console.warn('syncGroupIndex failed', e);
  }
}

// ── Doc page index ──────────────────────────────────────────────────────────

// Project the text of every page of one doc card into the doc_page_index
// table so the universal hover popover can list "Appears in" doc rows
// (driven by get_entity_mentions). Caller passes { docCardId, workspaceId,
// pages: [{ id, name, text }] }.
//
// Idempotent UPSERT keyed on (doc_card_id, page_id). Empty/whitespace-only
// pages are deleted instead of stored. Pages no longer present are also
// deleted so the index never carries orphaned rows.
export async function syncDocPageIndex({ workspaceId, docCardId, pages }) {
  if (!supabase || !workspaceId || !docCardId) return { ok: false };
  const livePageIds = new Set();
  const upsertRows = [];
  for (const p of pages || []) {
    if (!p?.id) continue;
    const text = (p.text || '').slice(0, 20000);   // cap to keep rows bounded
    if (!text.trim()) continue;
    livePageIds.add(p.id);
    upsertRows.push({
      doc_card_id: docCardId,
      page_id:     p.id,
      workspace_id: workspaceId,
      page_title:  (p.name || '').slice(0, 200),
      page_text:   text,
      updated_at:  new Date().toISOString(),
    });
  }
  if (upsertRows.length > 0) {
    const ups = await supabase.from('doc_page_index').upsert(upsertRows, { onConflict: 'doc_card_id,page_id' });
    if (ups.error) console.warn('doc_page_index upsert failed', ups.error);
  }

  // Clean up rows for pages that no longer exist (or are now empty).
  const existing = await supabase.from('doc_page_index').select('page_id').eq('doc_card_id', docCardId);
  if (existing.error) return { ok: true };
  const orphans = (existing.data || []).map(r => r.page_id).filter(id => !livePageIds.has(id));
  if (orphans.length > 0) {
    await supabase.from('doc_page_index').delete().eq('doc_card_id', docCardId).in('page_id', orphans);
  }
  return { ok: true };
}

// ── Doc backlinks ───────────────────────────────────────────────────────────

// Full-replace upsert for one (source_doc_card_id, source_page_id).
// Writes to the universal `entity_links` table (Phase 2). The legacy
// `doc_backlinks` mirror keeps existing readers working until their
// next migration; the rows are kept consistent because both tables
// share the source pointer.
export async function updateBacklinks({ workspaceId, docCardId, pageId, links }) {
  if (!supabase || !workspaceId || !docCardId || !pageId) return { ok: false };

  // 1. Delete existing rows for this source page in BOTH indexes.
  const delLegacy = await supabase
    .from('doc_backlinks').delete()
    .eq('source_doc_card_id', docCardId)
    .eq('source_page_id', pageId);
  if (delLegacy.error) console.warn('doc_backlinks delete failed', delLegacy.error);

  // Scope to source='user' so auto-detected mentions (which we write
  // with source='auto') aren't wiped on a manual-link save.
  const delNew = await supabase
    .from('entity_links').delete()
    .eq('source_kind', 'doc')
    .eq('source_id', docCardId)
    .eq('source_page_id', pageId)
    .eq('source', 'user');
  if (delNew.error) console.warn('entity_links delete failed', delNew.error);

  // 2. Insert one row per (link, target) into both tables. We keep
  //    doc_backlinks rows in sync so the home graph + existing
  //    "Referenced by" readers don't break.
  const legacyRows = [];
  const newRows = [];
  for (const l of links || []) {
    for (const t of l.targets || []) {
      legacyRows.push({
        source_workspace_id: workspaceId,
        source_doc_card_id:  docCardId,
        source_page_id:      pageId,
        source_link_id:      l.id,
        target_kind:         t.kind,
        target_workspace_id: workspaceId,
        target_board_id:     t.kind === 'board' ? t.id : (t.boardId || null),
        target_card_id:      t.kind === 'card' ? t.cardId : null,
        target_doc_card_id:  (t.kind === 'doc' || t.kind === 'docPos') ? t.docCardId : null,
        target_page_id:      t.kind === 'docPos' ? t.pageId : (t.kind === 'doc' ? (t.pageId || null) : null),
        target_url:          t.kind === 'url' ? t.href : null,
        source_text:         (l.name || '').slice(0, 200),
      });
      newRows.push({
        source_kind:         'doc',
        source_id:           docCardId,
        source_workspace:    workspaceId,
        source_page_id:      pageId,
        source_link_id:      l.id,
        context_text:        (l.name || '').slice(0, 500),
        target_kind:         t.kind,
        target_id:           t.kind === 'board' ? t.id : (t.kind === 'user' ? t.id : (t.kind === 'message' ? t.id : null)),
        target_board_id:     t.kind === 'board' ? t.id : (t.boardId || null),
        target_card_id:      t.kind === 'card' ? t.cardId : null,
        target_doc_card_id:  (t.kind === 'doc' || t.kind === 'docPos') ? t.docCardId : null,
        target_page_id:      t.kind === 'docPos' ? t.pageId : null,
        target_anchor:       t.kind === 'docPos' ? (t.anchor || null) : null,
        target_url:          t.kind === 'url' ? t.href : null,
      });
    }
  }
  if (legacyRows.length === 0) return { ok: true, count: 0 };
  const ins = await supabase.from('doc_backlinks').insert(legacyRows);
  if (ins.error) console.warn('doc_backlinks insert failed', ins.error);
  const ins2 = await supabase.from('entity_links').insert(newRows);
  if (ins2.error && ins2.error.code !== '23505') {
    console.warn('entity_links insert failed', ins2.error);
  }
  return { ok: true, count: legacyRows.length };
}

// Delete the derived-index rows a doc card authored (its page text + outgoing
// backlinks/entity-links) when the doc card itself is deleted — otherwise the
// universal "Appears in" hover, backlinks, and home graph keep surfacing a doc
// that no longer exists. Source rows only (undo-safe: reopening a restored doc
// re-syncs them via syncDocPageIndex/updateBacklinks). Fire-and-forget.
export async function cleanupDocCards(docCardIds) {
  if (!supabase || !docCardIds?.length) return;
  for (const id of docCardIds) {
    try {
      await supabase.from('doc_page_index').delete().eq('doc_card_id', id);
      await supabase.from('doc_backlinks').delete().eq('source_doc_card_id', id);
      await supabase.from('entity_links').delete().eq('source_kind', 'doc').eq('source_id', id);
    } catch (e) { console.warn('cleanupDocCards failed for', id, e); }
  }
}
