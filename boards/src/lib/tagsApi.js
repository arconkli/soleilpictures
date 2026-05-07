// Tags API. Workspace-scoped tag namespace with per-card and per-board
// associations. `kind` distinguishes user-added tags from auto-detected
// (name match) and AI-suggested tags.

import { supabase } from './supabase.js';

export async function listWorkspaceTags(workspaceId) {
  if (!workspaceId) return [];
  const { data, error } = await supabase
    .from('tags')
    .select('id, workspace_id, name, slug, color, kind, created_by, created_at')
    .eq('workspace_id', workspaceId)
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

// Find or create a tag by name. Trims + dedupes by slug.
export async function ensureTag({ workspaceId, name, color = null, kind = 'user', createdBy = null }) {
  const cleaned = (name || '').trim();
  if (!cleaned) throw new Error('Tag name required');
  const slug = cleaned.toLowerCase();
  // Try select first — avoids spamming inserts that fail unique-constraint.
  const found = await supabase.from('tags').select('*')
    .eq('workspace_id', workspaceId).eq('slug', slug).maybeSingle();
  if (found.error) throw found.error;
  if (found.data) return found.data;
  const { data, error } = await supabase.from('tags').insert({
    workspace_id: workspaceId, name: cleaned, color, kind, created_by: createdBy,
  }).select('*').single();
  if (error) throw error;
  return data;
}

export async function deleteTag(tagId) {
  const { error } = await supabase.from('tags').delete().eq('id', tagId);
  if (error) throw error;
}

// ── Card tags ────────────────────────────────────────────────────────────

export async function listCardTags(boardId) {
  if (!boardId) return [];
  const { data, error } = await supabase
    .from('card_tags')
    .select('workspace_id, board_id, card_id, tag_id, source, created_at')
    .eq('board_id', boardId);
  if (error) throw error;
  return data || [];
}

export async function tagCard({ workspaceId, boardId, cardId, tagId, source = 'user' }) {
  const { error } = await supabase.from('card_tags').upsert({
    workspace_id: workspaceId, board_id: boardId, card_id: cardId,
    tag_id: tagId, source,
  }, { onConflict: 'board_id,card_id,tag_id' });
  if (error) throw error;
}

export async function untagCard({ boardId, cardId, tagId }) {
  const { error } = await supabase.from('card_tags').delete()
    .eq('board_id', boardId).eq('card_id', cardId).eq('tag_id', tagId);
  if (error) throw error;
}

// ── Board tags ───────────────────────────────────────────────────────────

export async function listBoardTags(boardId) {
  if (!boardId) return [];
  const { data, error } = await supabase
    .from('board_tags')
    .select('workspace_id, board_id, tag_id, source, created_at')
    .eq('board_id', boardId);
  if (error) throw error;
  return data || [];
}

export async function tagBoard({ workspaceId, boardId, tagId, source = 'user' }) {
  const { error } = await supabase.from('board_tags').upsert({
    workspace_id: workspaceId, board_id: boardId, tag_id: tagId, source,
  }, { onConflict: 'board_id,tag_id' });
  if (error) throw error;
}

export async function untagBoard({ boardId, tagId }) {
  const { error } = await supabase.from('board_tags').delete()
    .eq('board_id', boardId).eq('tag_id', tagId);
  if (error) throw error;
}

// Auto-tag: when an existing tag's name matches the new card's title (case-
// insensitive substring), attach it with source='auto'. Best-effort —
// failures are logged not thrown so card creation isn't blocked.
export async function autoTagCardByTitle({ workspaceId, boardId, cardId, title }) {
  const t = (title || '').toString().trim();
  if (!workspaceId || !boardId || !cardId || t.length < 2) return;
  try {
    const tags = await listWorkspaceTags(workspaceId);
    const matches = tags.filter(tag => {
      const slug = tag.slug;
      return slug && t.toLowerCase().includes(slug);
    });
    if (matches.length === 0) return;
    const rows = matches.map(tag => ({
      workspace_id: workspaceId, board_id: boardId, card_id: cardId,
      tag_id: tag.id, source: 'auto',
    }));
    await supabase.from('card_tags').upsert(rows, { onConflict: 'board_id,card_id,tag_id' });
  } catch (err) {
    console.warn('[tags] autoTagCardByTitle failed', err);
  }
}
