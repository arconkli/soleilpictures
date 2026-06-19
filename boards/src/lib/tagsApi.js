// Tags API. Workspace-scoped tag namespace; per-card / per-board
// applications now live in the unified `entity_links` table —
// link_kind='applied', source_kind='card'|'board', target_kind='tag'.
//
// The public surface (tagCard / untagCard / tagBoard / untagBoard /
// listCardTags / listBoardTags) is unchanged so existing callers
// don't need updates. Internally these now read/write entity_links.
//
// Tag definitions themselves still live in `tags` — only their
// applications were migrated. Tags also appear in entity_search
// (migration 0036), which is what makes them show up in the
// EntityPicker, the auto-detect trie, hover popovers, etc.

import { supabase } from './supabase.js';

// ── Tag definitions ────────────────────────────────────────────────────

export async function listWorkspaceTags(workspaceId) {
  if (!workspaceId) return [];
  const { data, error } = await supabase
    .from('tags')
    .select('id, workspace_id, name, slug, color, kind, entity_type, description, created_by, created_at')
    .eq('workspace_id', workspaceId)
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function setTagDescription(tagId, description) {
  const trimmed = description == null ? null : String(description).trim().slice(0, 500);
  const { error } = await supabase.from('tags').update({ description: trimmed || null })
    .eq('id', tagId);
  if (error) throw error;
}

// One-shot cleanup: removes auto-applied tag applications where the
// tag's name shares no meaningful token with the source's text. Also
// inserts the (source, tag) into autotag_ignored so the engine
// doesn't re-apply. Returns the count of rows deleted.
export async function purgeBogusAutoappliedTags(workspaceId) {
  if (!workspaceId) throw new Error('purgeBogusAutoappliedTags: workspaceId required');
  const { data, error } = await supabase.rpc('purge_bogus_autoapplied_tags', {
    p_workspace_id: workspaceId,
  });
  if (error) throw error;
  return data || 0;
}

// Find or create a tag by name. Trims + dedupes by slug.
//
// On first creation, fires backfill_tag_applications which scans
// the workspace for existing boards/groups/cards whose text
// word-matches the slug and applies the tag to them as
// source='auto'. Without that, a tag created from the sidebar
// (when no board is mounted to drive the autotag worker) sits
// at zero applications until the user opens each board manually.
export async function ensureTag({ workspaceId, name, color = null, kind = 'user', createdBy = null }) {
  const cleaned = (name || '').trim();
  if (!cleaned) throw new Error('Tag name required');
  const slug = cleaned.toLowerCase();
  const found = await supabase.from('tags').select('*')
    .eq('workspace_id', workspaceId).eq('slug', slug).maybeSingle();
  if (found.error) throw found.error;
  if (found.data) return found.data;
  const { data, error } = await supabase.from('tags').insert({
    workspace_id: workspaceId, name: cleaned, color, kind, created_by: createdBy,
  }).select('*').single();
  if (error) throw error;
  // Best-effort: kick off the workspace-wide backfill in the
  // background. Failure is non-fatal — the per-board autotagger
  // will pick up the tag on the next board open anyway.
  supabase.rpc('backfill_tag_applications', {
    p_tag_id: data.id, p_workspace_id: workspaceId,
  }).then(({ error: bfErr }) => {
    if (bfErr) console.warn('[tags] backfill_tag_applications failed', bfErr);
  });
  return data;
}

export async function deleteTag(tagId) {
  // Cascading delete: drop the tag definition AND every application
  // (entity_links rows). The tag's `id` cascades through entity_links
  // because we don't have a FK from entity_links.target_id back to
  // tags — so we explicitly clean up the applications first.
  await supabase.from('entity_links').delete()
    .eq('target_kind', 'tag').eq('target_id', tagId);
  const { error } = await supabase.from('tags').delete().eq('id', tagId);
  if (error) throw error;
}

export async function recolorTag(tagId, color) {
  const { error } = await supabase.from('tags').update({ color }).eq('id', tagId);
  if (error) throw error;
}

export async function renameTag(tagId, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) throw new Error('Tag name required');
  const { error } = await supabase.from('tags').update({ name: trimmed }).eq('id', tagId);
  if (error) throw error;
}

// Atomic merge: rewrite every entity_links row targeting `fromTagId`
// to target `intoTagId` instead, then drop the from-tag. RPC handles
// collision (a source that already has the survivor tag) by dropping
// the collider before the update. Returns the number of rewritten rows.
export async function mergeTags({ fromTagId, intoTagId }) {
  if (!fromTagId || !intoTagId) throw new Error('mergeTags: both ids required');
  if (fromTagId === intoTagId) return 0;
  const { data, error } = await supabase.rpc('merge_tags', {
    p_from_tag_id: fromTagId,
    p_into_tag_id: intoTagId,
  });
  if (error) throw error;
  return data || 0;
}

// Workspace-wide application count per tag. Powers the sidebar count
// badges. RLS scopes the count automatically.
export async function listTagCounts(workspaceId) {
  if (!workspaceId) return new Map();
  const { data, error } = await supabase
    .from('entity_links')
    .select('target_id')
    .eq('source_workspace', workspaceId)
    .eq('target_kind', 'tag')
    .eq('link_kind', 'applied');
  if (error) throw error;
  const counts = new Map();
  for (const row of (data || [])) {
    counts.set(row.target_id, (counts.get(row.target_id) || 0) + 1);
  }
  return counts;
}

// ── Per-source applications (card / board) ─────────────────────────────
// All four functions below resolve to entity_links rows with
// link_kind='applied'. The card_tags / board_tags views are kept as
// a backwards-compat read path; new writes go through entity_links
// so the unique index is honored and realtime fans out.

export async function listCardTags(boardId) {
  if (!boardId) return [];
  const { data, error } = await supabase
    .from('entity_links')
    .select('source_workspace, source_board_id, source_id, target_id, source, created_at')
    .eq('source_kind', 'card')
    .eq('target_kind', 'tag')
    .eq('link_kind', 'applied')
    .eq('source_board_id', boardId);
  if (error) throw error;
  // Project to the legacy card_tags row shape so existing callers
  // (useWorkspaceTags) keep working without changes.
  return (data || []).map(r => ({
    workspace_id: r.source_workspace,
    board_id:     r.source_board_id,
    card_id:      r.source_id,
    tag_id:       r.target_id,
    source:       r.source,
    created_at:   r.created_at,
  }));
}

export async function tagCard({ workspaceId, boardId, cardId, tagId, source = 'user' }) {
  if (!workspaceId || !boardId || !cardId || !tagId) {
    throw new Error('tagCard: missing required field');
  }
  // Idempotent: existing applied row for the same target → no-op.
  const row = {
    source_kind:      'card',
    source_id:        String(cardId),
    source_workspace: workspaceId,
    source_board_id:  boardId,
    target_kind:      'tag',
    target_id:        tagId,
    link_kind:        'applied',
    source,
  };
  const { error } = await supabase.from('entity_links').insert(row);
  if (error && error.code !== '23505') throw error; // 23505 = unique violation = already applied
  // User-applied tag clears any prior dismissal so the user's
  // intent overrides past "Don't suggest again." (Auto-applied
  // tags don't, since the engine doesn't override user dismissals.)
  if (source === 'user') {
    await supabase.from('autotag_ignored').delete()
      .eq('workspace_id', workspaceId).eq('target_kind', 'card')
      .eq('target_id', String(cardId)).eq('tag_id', tagId);
  }
}

export async function untagCard({ boardId, cardId, tagId }) {
  if (!boardId || !cardId || !tagId) return;
  const { error } = await supabase.from('entity_links').delete()
    .eq('source_kind', 'card')
    .eq('source_id', String(cardId))
    .eq('source_board_id', boardId)
    .eq('target_kind', 'tag')
    .eq('target_id', tagId)
    .eq('link_kind', 'applied');
  if (error) throw error;
}

export async function listBoardTags(boardId) {
  if (!boardId) return [];
  const { data, error } = await supabase
    .from('entity_links')
    .select('source_workspace, source_board_id, target_id, source, created_at')
    .eq('source_kind', 'board')
    .eq('target_kind', 'tag')
    .eq('link_kind', 'applied')
    .eq('source_board_id', boardId);
  if (error) throw error;
  return (data || []).map(r => ({
    workspace_id: r.source_workspace,
    board_id:     r.source_board_id,
    tag_id:       r.target_id,
    source:       r.source,
    created_at:   r.created_at,
  }));
}

export async function tagBoard({ workspaceId, boardId, tagId, source = 'user' }) {
  if (!workspaceId || !boardId || !tagId) {
    throw new Error('tagBoard: missing required field');
  }
  const row = {
    source_kind:      'board',
    source_id:        String(boardId),
    source_workspace: workspaceId,
    source_board_id:  boardId,
    target_kind:      'tag',
    target_id:        tagId,
    link_kind:        'applied',
    source,
  };
  const { error } = await supabase.from('entity_links').insert(row);
  if (error && error.code !== '23505') throw error;
  if (source === 'user') {
    await supabase.from('autotag_ignored').delete()
      .eq('workspace_id', workspaceId).eq('target_kind', 'board')
      .eq('target_id', String(boardId)).eq('tag_id', tagId);
  }
}

export async function untagBoard({ boardId, tagId }) {
  if (!boardId || !tagId) return;
  const { error } = await supabase.from('entity_links').delete()
    .eq('source_kind', 'board')
    .eq('source_id', String(boardId))
    .eq('target_kind', 'tag')
    .eq('target_id', tagId)
    .eq('link_kind', 'applied');
  if (error) throw error;
}

// Groups are first-class taggable entities. Group ids are NOT uuids
// — they're "g-…" strings — so source_id is text and the "board"
// they live on goes into source_board_id (uuid).
export async function tagGroup({ workspaceId, boardId, groupId, tagId, source = 'user' }) {
  if (!workspaceId || !boardId || !groupId || !tagId) {
    throw new Error('tagGroup: missing required field');
  }
  const row = {
    source_kind:      'group',
    source_id:        String(groupId),
    source_workspace: workspaceId,
    source_board_id:  boardId,
    target_kind:      'tag',
    target_id:        tagId,
    link_kind:        'applied',
    source,
  };
  const { error } = await supabase.from('entity_links').insert(row);
  if (error && error.code !== '23505') throw error;
  if (source === 'user') {
    await supabase.from('autotag_ignored').delete()
      .eq('workspace_id', workspaceId).eq('target_kind', 'group')
      .eq('target_id', String(groupId)).eq('tag_id', tagId);
  }
}

// Doc pages are taggable too. source_kind='doc' + source_page_id pins
// the application to a specific page within a doc card. Used by the
// AI tagger backfill when a page's embedding matches a tag centroid.
export async function tagDocPage({ workspaceId, docCardId, pageId, boardId = null, tagId, source = 'user' }) {
  if (!workspaceId || !docCardId || !pageId || !tagId) {
    throw new Error('tagDocPage: missing required field');
  }
  const row = {
    source_kind:      'doc',
    source_id:        String(docCardId),
    source_workspace: workspaceId,
    source_board_id:  boardId,
    source_page_id:   String(pageId),
    target_kind:      'tag',
    target_id:        tagId,
    link_kind:        'applied',
    source,
  };
  const { error } = await supabase.from('entity_links').insert(row);
  if (error && error.code !== '23505') throw error;
}

// Remove a tag from one specific range inside a doc page. Matched by the
// source_anchor JSON (pHash + startOffset + length) so other ranges of the
// same tag on the same page aren't affected.
export async function untagDocRange({ workspaceId, docCardId, pageId, tagId, sourceAnchor }) {
  if (!workspaceId || !docCardId || !pageId || !tagId || !sourceAnchor?.pHash) return;
  let q = supabase.from('entity_links').delete()
    .eq('source_kind', 'doc')
    .eq('source_id', String(docCardId))
    .eq('source_workspace', workspaceId)
    .eq('source_page_id', String(pageId))
    .eq('target_kind', 'tag')
    .eq('target_id', tagId)
    .eq('link_kind', 'applied')
    .filter('source_anchor->>pHash', 'eq', String(sourceAnchor.pHash));
  if (typeof sourceAnchor.startOffset === 'number') {
    q = q.filter('source_anchor->>startOffset', 'eq', String(sourceAnchor.startOffset));
  }
  if (typeof sourceAnchor.length === 'number') {
    q = q.filter('source_anchor->>length', 'eq', String(sourceAnchor.length));
  }
  const { error } = await q;
  if (error) throw error;
}

export async function untagDocPage({ workspaceId, docCardId, pageId, tagId }) {
  if (!workspaceId || !docCardId || !pageId || !tagId) return;
  const { error } = await supabase.from('entity_links').delete()
    .eq('source_kind', 'doc')
    .eq('source_id', String(docCardId))
    .eq('source_workspace', workspaceId)
    .eq('source_page_id', String(pageId))
    .eq('target_kind', 'tag')
    .eq('target_id', tagId)
    .eq('link_kind', 'applied');
  if (error) throw error;
}

// Range-anchored doc apply: a tag scoped to a paragraph (or smaller
// span). source_anchor carries { pHash, startOffset, length } —
// pHash is the FNV-1a of the paragraph text so the renderer can
// re-locate the span after the user edits unrelated paragraphs.
// contextText is an optional snippet (~150 chars around the anchor)
// that the tag detail view can show as a preview in "Mentioned in".
export async function tagDocRange({ workspaceId, docCardId, pageId, boardId = null, tagId, source = 'auto-paragraph', sourceAnchor, contextText = null }) {
  if (!workspaceId || !docCardId || !pageId || !tagId || !sourceAnchor?.pHash) {
    throw new Error('tagDocRange: missing required field');
  }
  const row = {
    source_kind:      'doc',
    source_id:        String(docCardId),
    source_workspace: workspaceId,
    source_board_id:  boardId,
    source_page_id:   String(pageId),
    source_anchor:    sourceAnchor,
    context_text:     contextText ? String(contextText).slice(0, 300) : null,
    target_kind:      'tag',
    target_id:        tagId,
    link_kind:        'applied',
    source,
  };
  const { error } = await supabase.from('entity_links').insert(row);
  if (error && error.code !== '23505') throw error;
}

export async function untagGroup({ boardId, groupId, tagId }) {
  if (!boardId || !groupId || !tagId) return;
  const { error } = await supabase.from('entity_links').delete()
    .eq('source_kind', 'group')
    .eq('source_id', String(groupId))
    .eq('source_board_id', boardId)
    .eq('target_kind', 'tag')
    .eq('target_id', tagId)
    .eq('link_kind', 'applied');
  if (error) throw error;
}

// Promote an auto/ai applied tag to user-confirmed. Updates the
// source attribution on the entity_link row in place.
export async function confirmAppliedTag({ sourceKind, sourceId, sourceBoardId, tagId }) {
  const q = supabase.from('entity_links').update({ source: 'user' })
    .eq('source_kind', sourceKind)
    .eq('source_id', String(sourceId))
    .eq('target_kind', 'tag')
    .eq('target_id', tagId)
    .eq('link_kind', 'applied');
  const { error } = sourceBoardId
    ? await q.eq('source_board_id', sourceBoardId)
    : await q;
  if (error) throw error;
}

// (Substring autotagger removed in Phase D — replaced by the
// homegrown TF-IDF + alias + exact-name engine in autotagEngine.js,
// hosted off-thread in autotagWorker.js. The exact-name path in the
// engine subsumes the legacy substring behavior with proper
// tokenization, while TF-IDF adds rich-context scoring once the
// workspace has training data.)

// "Don't suggest again" — write a per-target row to autotag_ignored
// so the worker filters this (target, tag) pair from future scoring
// runs. Realtime fans the change out to all clients.
export async function dismissAutotagSuggestion({ workspaceId, targetKind, targetId, tagId, userId }) {
  if (!workspaceId || !targetKind || !targetId || !tagId) {
    throw new Error('dismissAutotagSuggestion: missing required field');
  }
  const { error } = await supabase.from('autotag_ignored').upsert({
    workspace_id: workspaceId,
    target_kind:  targetKind,
    target_id:    String(targetId),
    tag_id:       tagId,
    ignored_by:   userId || null,
  }, { onConflict: 'workspace_id,target_kind,target_id,tag_id' });
  if (error) throw error;
}
