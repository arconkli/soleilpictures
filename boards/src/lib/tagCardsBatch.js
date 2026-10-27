// Tagging several cards at once (the selection's Tag, a tag dropped on a
// selected card). Only TagManyPicker.jsx imports this, so it loads with the
// picker, not with the canvas.

import { supabase } from './supabase.js';
import { TAG_LINKS_CHANGED } from './tagsApi.js';

function announceTagLinksChanged() {
  try { document.dispatchEvent(new CustomEvent(TAG_LINKS_CHANGED)); } catch (_) {}
}

// Several cards at once (the selection's Tag): one insert, and the person's
// tag lifts any "keep it off" rows for those cards, as tagCard does.
export async function tagCards({ workspaceId, boardId, cardIds, tagId }) {
  const ids = [...new Set((cardIds || []).map(String))];
  if (!workspaceId || !boardId || !tagId || ids.length === 0) return [];
  const rows = ids.map(id => ({
    source_kind: 'card', source_id: id, source_workspace: workspaceId, source_board_id: boardId,
    target_kind: 'tag', target_id: tagId, link_kind: 'applied', source: 'user',
  }));
  const { error } = await supabase.from('entity_links').insert(rows);
  if (error && error.code === '23505') {
    for (const row of rows) {
      const { error: one } = await supabase.from('entity_links').insert(row);
      if (one && one.code !== '23505') throw one;
    }
  } else if (error) {
    throw error;
  }
  const { error: lift } = await supabase.from('autotag_ignored').delete()
    .eq('workspace_id', workspaceId).eq('target_kind', 'card').eq('tag_id', tagId).in('target_id', ids);
  if (lift) console.warn('[tags] lifting keep-off rows failed', lift.message);
  announceTagLinksChanged();
  return ids;
}

// Takes a tag off several cards and returns the removed rows (for the undo).
// keepOff writes the "don't put it back" rows a removal writes; an undo of
// an add passes false, since nobody removed anything.
export async function untagCards({ workspaceId, boardId, cardIds, tagId, userId = null, keepOff = true }) {
  const ids = [...new Set((cardIds || []).map(String))];
  if (!workspaceId || !boardId || !tagId || ids.length === 0) return [];
  const { data, error } = await supabase.from('entity_links').delete()
    .eq('source_kind', 'card').eq('source_board_id', boardId).in('source_id', ids)
    .eq('target_kind', 'tag').eq('target_id', tagId).eq('link_kind', 'applied')
    .select();
  if (error) throw error;
  const removedIds = [...new Set((data || []).map(r => r.source_id))];
  if (keepOff && removedIds.length) {
    const { error: ig } = await supabase.from('autotag_ignored').upsert(
      removedIds.map(id => ({ workspace_id: workspaceId, target_kind: 'card', target_id: id, tag_id: tagId, ignored_by: userId })),
      { onConflict: 'workspace_id,target_kind,target_id,tag_id' });
    if (ig) console.warn('[tags] keep-off rows failed', ig.message);
  }
  announceTagLinksChanged();
  return data || [];
}

// Undo for untagCards: lift the keep-off rows, then put the rows back as
// they were.
export async function restoreCardTagRows({ workspaceId, tagId, rows }) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!workspaceId || !tagId || list.length === 0) return;
  await supabase.from('autotag_ignored').delete()
    .eq('workspace_id', workspaceId).eq('target_kind', 'card').eq('tag_id', tagId)
    .in('target_id', [...new Set(list.map(r => r.source_id))]);
  const { error } = await supabase.from('entity_links').insert(list);
  if (error && error.code === '23505') {
    for (const row of list) {
      const { error: one } = await supabase.from('entity_links').insert(row);
      if (one && one.code !== '23505') throw one;
    }
  } else if (error) {
    throw error;
  }
  announceTagLinksChanged();
}
