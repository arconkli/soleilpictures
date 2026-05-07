// CRUD over the `workspaces`, `workspace_members`, `boards` and `board_state`
// tables. Pure functions over the Supabase client — no React.

import * as Y from 'yjs';
import { supabase } from './supabase.js';
import { bytesToB64 } from './yhelpers.js';

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
// "Soleil" workspaces on first sign-in.
// Returns the workspaces row (back-compat shape). Internally the
// RPC also guarantees a root board + empty board_state exist, so
// callers no longer need a JS-side createBoard fallback (which used
// to hit RLS in some sessions).
export async function getOrCreatePersonalWorkspace({ userId, name = 'Soleil' }) {
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

// Fetch the caller's own profile (name + color + avatar). Returns null if
// no row exists yet — callers should fall back to email-derived defaults.
export async function getOwnProfile() {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, display_name, color, avatar_url, updated_at')
    .maybeSingle();
  if (error) throw error;
  return data || null;
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
export async function shareBoard({ boardId, email, role }) {
  const { error } = await supabase
    .rpc('share_board', {
      p_board_id: boardId,
      p_email: email,
      p_role: role,
    });
  if (error) throw error;
}

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

export async function createPublicLink({ boardId, expiresAt = null }) {
  const { data, error } = await supabase
    .rpc('create_public_link', { p_board_id: boardId, p_expires_at: expiresAt });
  if (error) throw error;
  return data;  // uuid token
}

export async function revokePublicLink(token) {
  const { error } = await supabase
    .rpc('revoke_public_link', { p_token: token });
  if (error) throw error;
}

export async function listPublicLinks(boardId) {
  if (!boardId) return [];
  const { data, error } = await supabase
    .rpc('list_public_links', { p_board_id: boardId });
  if (error) throw error;
  return data || [];
}

// ── Boards ─────────────────────────────────────────────────────────────────

export async function listBoards(workspaceId) {
  const { data, error } = await supabase
    .from('boards')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getRootBoard(workspaceId) {
  const { data, error } = await supabase
    .from('boards')
    .select('*')
    .eq('workspace_id', workspaceId)
    .is('parent_board_id', null)
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

export async function renameBoard(boardId, name) {
  const { error } = await supabase
    .from('boards')
    .update({ name, updated_at: new Date().toISOString() })
    .eq('id', boardId);
  if (error) throw error;
}

export async function updateBoardMeta(boardId, patch) {
  const { error } = await supabase
    .from('boards')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', boardId);
  if (error) throw error;
}

export async function deleteBoard(boardId) {
  console.log('[delete] deleteBoard request', { boardId });
  const { data, error, count } = await supabase
    .from('boards').delete({ count: 'exact' }).eq('id', boardId).select('id');
  if (error) {
    console.warn('[delete] deleteBoard error', { boardId, error });
    throw error;
  }
  console.log('[delete] deleteBoard ok', { boardId, count, rows: data });
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
  const wsq = await supabase.from('boards').select('workspace_id').eq('id', boardId).maybeSingle();
  if (wsq.error) { console.warn('syncCardIndex resolve workspace', wsq.error); return; }
  const workspaceId = wsq.data?.workspace_id;
  if (!workspaceId) return;
  const cardsMap = ydoc.getMap('cards');
  // Pull the groups list once so we can capture group names per
  // card in card_index.meta. Used by the tag detail view to render
  // group context and aggregate "Groups" rows.
  const groupsArr = ydoc.getArray('groups');
  const groupNameById = new Map();
  try {
    groupsArr.forEach(g => {
      const id = g?.get?.('id') ?? g?.id;
      const name = g?.get?.('name') ?? g?.name;
      if (id) groupNameById.set(String(id), name || '');
    });
  } catch (_) {}
  const rows = [];
  const liveIds = new Set();
  cardsMap.forEach((v, id) => {
    if (!v) return;
    const get = (k) => v?.get?.(k) ?? v?.[k];
    const kind = get('kind') || 'note';
    const title = get('title') || get('name') || get('label') || get('url') || '';
    // Notes carry text in `html`, not `body` — fall through so we
    // index the actual user-visible content. Strip HTML.
    const rawBody = get('body') || get('caption') || '';
    const body = rawBody || htmlToText(get('html') || '');
    const groupId = get('groupId') || null;
    const groupName = groupId ? (groupNameById.get(String(groupId)) || '') : '';
    // Per-kind preview data — drives the universal popover's
    // visual previews (image thumbnails, palette swatches, etc).
    // Migration 0021 added the `meta jsonb` column.
    const baseMeta = buildCardMeta(kind, get) || {};
    const meta = (groupId || groupName)
      ? { ...baseMeta, groupId, groupName }
      : baseMeta;
    rows.push({
      workspace_id: workspaceId,
      board_id: boardId,
      card_id: id,
      kind,
      title: String(title).slice(0, 200),
      body: String(body).slice(0, 500),
      meta,
    });
    liveIds.add(id);
  });

  if (rows.length > 0) {
    // UPSERT on (board_id, card_id). Idempotent — no race if two windows
    // run this concurrently.
    const ups = await supabase.from('card_index').upsert(rows, { onConflict: 'board_id,card_id' });
    if (ups.error) { console.warn('syncCardIndex upsert', ups.error); return; }
  }

  // Clean up any rows for cards that no longer exist on the board.
  // Cheap query because card counts per board are typically small.
  const existing = await supabase.from('card_index').select('card_id').eq('board_id', boardId);
  if (existing.error) return;
  const orphanIds = (existing.data || []).map(r => r.card_id).filter(id => !liveIds.has(id));
  if (orphanIds.length > 0) {
    await supabase.from('card_index').delete().eq('board_id', boardId).in('card_id', orphanIds);
  }
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
      return { pageCount: (get('pages') || []).length || null };
    default:
      return null;
  }
}

// ── Version history ─────────────────────────────────────────────────────────

export async function saveBoardVersion(boardId, ydoc, { label = null, userId = null } = {}) {
  const update = Y.encodeStateAsUpdate(ydoc);
  const b64 = bytesToB64(update);
  const cardCount = ydoc.getMap('cards').size;
  const { error } = await supabase
    .from('board_versions')
    .insert({ board_id: boardId, doc: b64, card_count: cardCount, label, made_by: userId });
  if (error) throw error;
}

export async function listBoardVersions(boardId, limit = 50) {
  const { data, error } = await supabase
    .from('board_versions')
    .select('id, snapshot_at, card_count, label, made_by')
    .eq('board_id', boardId)
    .order('snapshot_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
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

// ── Card group index (mirror of Y.Doc 'groups' map) ───────────────────────
// One row per (board_id, group_id) so groups appear in entity_search and
// the universal linking system can find / hover / link to them.

export async function syncGroupIndex({ boardId, ydoc }) {
  if (!supabase || !boardId || !ydoc) return;
  try {
    const wsq = await supabase.from('boards').select('workspace_id').eq('id', boardId).maybeSingle();
    if (wsq.error) { console.warn('syncGroupIndex resolve workspace', wsq.error); return; }
    const workspaceId = wsq.data?.workspace_id;
    if (!workspaceId) return;

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

  const delNew = await supabase
    .from('entity_links').delete()
    .eq('source_kind', 'doc')
    .eq('source_id', docCardId)
    .eq('source_page_id', pageId);
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
