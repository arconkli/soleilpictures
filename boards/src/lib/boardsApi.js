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
export async function getOrCreatePersonalWorkspace({ userId, name = 'Soleil' }) {
  const { data, error } = await supabase
    .rpc('get_or_create_personal_workspace', { p_user_id: userId, p_name: name });
  if (error) throw error;
  return data;
}

// Create a workspace + add the caller as a member, all in two writes.
// Used for explicit user-initiated "new workspace" actions, not for
// bootstrap (use getOrCreatePersonalWorkspace).
export async function createWorkspace({ name, userId }) {
  const ins = await supabase
    .from('workspaces')
    .insert({ name, created_by: userId })
    .select('*')
    .single();
  if (ins.error) throw ins.error;
  const ws = ins.data;
  const member = await supabase
    .from('workspace_members')
    .insert({ workspace_id: ws.id, user_id: userId, role: 'owner' });
  if (member.error) throw member.error;
  return ws;
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
  const ins = await supabase
    .from('boards')
    .insert({
      workspace_id: workspaceId,
      parent_board_id: parentBoardId,
      name, view, cover, meta,
      created_by: userId,
    })
    .select('*')
    .single();
  if (ins.error) throw ins.error;
  // Seed an empty Y.Doc snapshot so the row exists.
  const ydoc = new Y.Doc();
  await saveBoardSnapshot(ins.data.id, ydoc);
  return ins.data;
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
}

// Project the board's Y.Map<'cards'> into Postgres `card_index`. Full-replace
// for the board so deletes propagate. workspace_id is resolved from the
// boards row so callers don't need to thread it through.
export async function syncCardIndex({ boardId, ydoc }) {
  if (!supabase || !boardId || !ydoc) return;
  // Resolve workspace from the boards row.
  const wsq = await supabase.from('boards').select('workspace_id').eq('id', boardId).maybeSingle();
  const workspaceId = wsq.data?.workspace_id;
  if (!workspaceId) return;
  const cardsMap = ydoc.getMap('cards');
  const rows = [];
  cardsMap.forEach((v, id) => {
    if (!v) return;
    const get = (k) => v?.get?.(k) ?? v?.[k];
    const kind = get('kind') || 'note';
    const title = get('title') || get('name') || get('label') || get('url') || '';
    const body = get('body') || get('caption') || '';
    rows.push({
      workspace_id: workspaceId,
      board_id: boardId,
      card_id: id,
      kind,
      title: String(title).slice(0, 200),
      body: String(body).slice(0, 500),
    });
  });
  // Wipe this board's rows then re-insert (full replace).
  await supabase.from('card_index').delete().eq('board_id', boardId);
  if (rows.length === 0) return;
  await supabase.from('card_index').insert(rows);
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

// ── Doc backlinks ───────────────────────────────────────────────────────────

// Full-replace upsert of doc_backlinks for one (source_doc_card_id, source_page_id).
// Caller passes the current link list for the page; we delete-then-insert.
export async function updateBacklinks({ workspaceId, docCardId, pageId, links }) {
  if (!supabase || !workspaceId || !docCardId || !pageId) return { ok: false };
  // 1. Delete existing rows for this source page.
  const del = await supabase
    .from('doc_backlinks')
    .delete()
    .eq('source_doc_card_id', docCardId)
    .eq('source_page_id', pageId);
  if (del.error) {
    console.warn('backlinks delete failed', del.error);
    return { ok: false, error: del.error };
  }
  // 2. Insert one row per (link, target).
  const rows = [];
  for (const l of links || []) {
    for (const t of l.targets || []) {
      rows.push({
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
    }
  }
  if (rows.length === 0) return { ok: true, count: 0 };
  const ins = await supabase.from('doc_backlinks').insert(rows);
  if (ins.error) {
    console.warn('backlinks insert failed', ins.error);
    return { ok: false, error: ins.error };
  }
  return { ok: true, count: rows.length };
}
